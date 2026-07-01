// ──────────────────────────────────────────────
// FRONT PROTOCOL — Fee Claimer Worker
// ──────────────────────────────────────────────
//
// Tracks incoming creator fees from pump.fun tokens whose fee sharing
// is directed to the protocol wallet. Pump.fun sends fees directly as
// SOL to the protocol wallet — no "claim" instruction needed.
//
// This worker:
//   1. Checks recent transactions on the protocol wallet
//   2. Identifies fee deposits (incoming SOL transfers)
//   3. Records them in the database (FeeClaim + PoolLedger)
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL, formatSol } from '@front-protocol/core';
import { getSolBalance, getProtocolWallet, getConnection, PublicKey } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';
const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

interface FeeClaimJobData {
  /** When omitted, processes all active tokens */
  tokenId?: number;
}

/**
 * Process fee tracking job: check protocol wallet for recent incoming
 * transactions and record any new fee income.
 */
async function processFeeClaimJob(job: Job<FeeClaimJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting fee tracking run (job ${job.id})`);

  try {
    // Get current protocol wallet balance
    const currentBalance = await getSolBalance(PROTOCOL_WALLET);
    console.log(`${PREFIX} Protocol wallet balance: ${formatSol(currentBalance)} SOL`);

    // Get the last recorded balance from the database
    const lastRecord = await prisma.poolLedger.findFirst({
      where: { type: 'fee_balance_snapshot' },
      orderBy: { createdAt: 'desc' },
      select: { amount: true, createdAt: true },
    });

    const lastBalance = lastRecord ? BigInt(lastRecord.amount.toString()) : BigInt(0);

    // Check recent transactions on the protocol wallet for incoming transfers
    const connection = getConnection();
    const walletPubkey = new PublicKey(PROTOCOL_WALLET);

    // Get recent signatures (last 20 transactions)
    const signatures = await connection.getSignaturesForAddress(walletPubkey, {
      limit: 20,
    });

    // Find the last processed transaction signature
    const lastProcessedTx = await prisma.feeClaim.findFirst({
      orderBy: { claimedAt: 'desc' },
      select: { txSignature: true },
    });
    const lastProcessedSig = lastProcessedTx?.txSignature;

    let newFeesRecorded = 0;
    let totalNewFees = BigInt(0);

    // Get active tokens for attribution
    const activeTokens = await prisma.token.findMany({
      where: { isActive: true },
      select: { id: true, address: true, symbol: true, totalFeesClaimed: true },
    });

    for (const sig of signatures) {
      // Stop if we hit an already-processed transaction
      if (sig.signature === lastProcessedSig) break;

      // Skip failed transactions
      if (sig.err) continue;

      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) continue;

        // Check if protocol wallet received SOL in this transaction
        const accountKeys = tx.transaction.message.accountKeys;
        const walletIndex = accountKeys.findIndex(
          (key) => key.pubkey.toBase58() === PROTOCOL_WALLET
        );

        if (walletIndex === -1) continue;

        const preBalance = tx.meta.preBalances[walletIndex] ?? 0;
        const postBalance = tx.meta.postBalances[walletIndex] ?? 0;
        const balanceChange = postBalance - preBalance;

        // Only track incoming SOL (positive balance change)
        if (balanceChange <= 0) continue;

        const incomingLamports = BigInt(balanceChange);

        // Skip very small amounts (dust, rent)
        if (incomingLamports < BigInt(LAMPORTS_PER_SOL) / BigInt(10000)) continue;

        // Check if we already recorded this transaction
        const existing = await prisma.feeClaim.findFirst({
          where: { txSignature: sig.signature },
        });
        if (existing) continue;

        // Attribute to the first active token (simplified — in production
        // you'd parse the transaction to determine which token's trade generated the fee)
        const targetToken = activeTokens.length > 0 ? activeTokens[0] : null;

        // Record the fee
        await prisma.$transaction([
          prisma.feeClaim.create({
            data: {
              tokenId: targetToken?.id ?? 0,
              amount: incomingLamports,
              txSignature: sig.signature,
            },
          }),
          // Update token's total fees if attributable
          ...(targetToken ? [
            prisma.token.update({
              where: { id: targetToken.id },
              data: {
                totalFeesClaimed: targetToken.totalFeesClaimed + incomingLamports,
              },
            }),
          ] : []),
          // Add pool ledger entry
          prisma.poolLedger.create({
            data: {
              type: 'fee_claim',
              amount: incomingLamports,
              referenceId: targetToken?.id ?? 0,
              txSignature: sig.signature,
            },
          }),
        ]);

        totalNewFees += incomingLamports;
        newFeesRecorded++;

        console.log(
          `${PREFIX} ✅ Recorded fee: ${formatSol(incomingLamports)} SOL ` +
          `(tx: ${sig.signature.substring(0, 16)}…) ` +
          `${targetToken ? `→ ${targetToken.symbol}` : ''}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error processing tx ${sig.signature.substring(0, 16)}…: ${msg}`);
        continue;
      }
    }

    // Save a balance snapshot for tracking
    await prisma.poolLedger.create({
      data: {
        type: 'fee_balance_snapshot',
        amount: currentBalance,
        referenceId: 0,
        txSignature: `snapshot-${Date.now()}`,
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Fee tracking complete: ${newFeesRecorded} new fee(s), ` +
      `${formatSol(totalNewFees)} SOL recorded, ` +
      `wallet balance: ${formatSol(currentBalance)} SOL (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Fatal error in fee tracking job: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const feeClaimerWorker = new Worker<FeeClaimJobData>(
  QUEUE_NAMES.FEE_CLAIMS,
  processFeeClaimJob,
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: {
      max: 1,
      duration: 5000,
    },
  },
);

feeClaimerWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

feeClaimerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

feeClaimerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

export async function scheduleFeeClaimer(): Promise<void> {
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  // Run every 15 minutes to track incoming fees
  const intervalMs = 15 * 60 * 1000;

  await feeClaimsQueue.add(
    'track-fees',
    {},
    {
      repeat: { every: intervalMs },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30_000,
      },
    },
  );

  console.log(`${PREFIX} Scheduled fee tracking every 15 minutes`);
}
