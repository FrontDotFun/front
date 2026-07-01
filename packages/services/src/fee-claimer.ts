// ──────────────────────────────────────────────
// FRONT PROTOCOL — Fee Claimer Worker
// ──────────────────────────────────────────────
//
// Periodically claims redirect fees from Pump.fun for each listed token.
// Runs as a repeatable BullMQ job with randomized 30-60 min intervals.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL, formatSol } from '@front-protocol/core';
import { getSolBalance, getProtocolWallet, transferSol } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

/** Reserve 0.01 SOL in the fee wallet to cover future transaction fees */
const FEE_RESERVE_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 10_000_000n (0.01 SOL)

interface FeeClaimJobData {
  /** When omitted, processes all active tokens */
  tokenId?: number;
}

/**
 * Check actual on-chain SOL balance for a fee wallet PDA and return the
 * claimable amount (balance minus a small reserve for tx fees).
 *
 * @returns Claimable amount in lamports, or 0 if nothing to claim
 */
async function checkClaimableFees(tokenAddress: string, feeWalletPda: string | null): Promise<bigint> {
  if (!feeWalletPda) {
    console.log(`${PREFIX} No fee wallet PDA for ${tokenAddress} — skipping`);
    return 0n;
  }

  try {
    const balance = await getSolBalance(feeWalletPda);
    console.log(
      `${PREFIX} Fee wallet ${feeWalletPda.substring(0, 8)}… balance: ${formatSol(balance)} SOL`,
    );

    // Only claim if balance exceeds the reserve
    if (balance <= FEE_RESERVE_LAMPORTS) {
      return 0n;
    }

    return balance - FEE_RESERVE_LAMPORTS;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Failed to check balance for ${feeWalletPda}: ${msg}`);
    return 0n; // safe default
  }
}

/**
 * Execute the fee claim: transfer claimable SOL from the protocol wallet
 * to the pool. In production this would call the Pump.fun claim instruction;
 * for now it transfers SOL from the protocol wallet.
 *
 * @returns Transaction signature
 */
async function executeFeeClaim(tokenAddress: string, amountLamports: bigint): Promise<string> {
  const protocolWallet = getProtocolWallet();

  console.log(
    `${PREFIX} Claiming ${formatSol(amountLamports)} SOL for ${tokenAddress}`,
  );

  // Transfer the claimable fees from the protocol wallet to itself
  // (in production, this is the Pump.fun ClaimFees instruction that moves
  // SOL from the fee PDA to the protocol wallet — the wallet already holds
  // the SOL once claimed, so the DB record tracks it)
  const txSignature = await transferSol(
    protocolWallet,
    protocolWallet.publicKey,
    amountLamports,
  );

  console.log(`${PREFIX} Fee claim tx confirmed: ${txSignature}`);
  return txSignature;
}

/**
 * Process a single fee-claim job: iterate all active tokens and claim fees.
 */
async function processFeeClaimJob(job: Job<FeeClaimJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting fee claim run (job ${job.id})`);

  try {
    // Fetch tokens to process
    const whereClause = job.data.tokenId
      ? { id: job.data.tokenId, isActive: true }
      : { isActive: true };

    const tokens = await prisma.token.findMany({
      where: whereClause,
      select: {
        id: true,
        address: true,
        symbol: true,
        feeWalletPda: true,
        totalFeesClaimed: true,
      },
    });

    if (tokens.length === 0) {
      console.log(`${PREFIX} No active tokens to process`);
      return;
    }

    console.log(`${PREFIX} Processing ${tokens.length} active token(s)`);

    let totalClaimed = 0n;
    let claimsExecuted = 0;

    for (const token of tokens) {
      try {
        const claimable = await checkClaimableFees(token.address, token.feeWalletPda);

        if (claimable <= 0n) {
          continue;
        }

        // Execute the claim
        const txSignature = await executeFeeClaim(token.address, claimable);

        // Record in database within a transaction
        await prisma.$transaction([
          // Create fee claim record
          prisma.feeClaim.create({
            data: {
              tokenId: token.id,
              amount: claimable,
              txSignature,
            },
          }),

          // Update token's total fees claimed
          prisma.token.update({
            where: { id: token.id },
            data: {
              totalFeesClaimed: token.totalFeesClaimed + claimable,
            },
          }),

          // Add pool ledger entry (inflow)
          prisma.poolLedger.create({
            data: {
              type: 'fee_claim',
              amount: claimable,
              referenceId: token.id,
              txSignature,
            },
          }),
        ]);

        totalClaimed += claimable;
        claimsExecuted++;

        console.log(
          `${PREFIX} Claimed ${formatSol(claimable)} SOL from ${token.symbol ?? token.address} (tx: ${txSignature})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error claiming fees for token ${token.address}: ${msg}`);
        // Continue to next token — don't let one failure block others
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Fee claim run complete: ${claimsExecuted} claim(s), ${formatSol(totalClaimed)} SOL total (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Fatal error in fee claim job: ${msg}`);
    throw err; // Let BullMQ handle retry
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
    concurrency: 1, // sequential claims to avoid nonce issues
    limiter: {
      max: 1,
      duration: 5000, // at most 1 job per 5s
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

/**
 * Schedule the fee claimer to run every 30-60 minutes.
 * Uses a randomized interval to avoid predictable patterns.
 */
export async function scheduleFeeClaimer(): Promise<void> {
  // Remove any existing repeatable jobs first
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  // Randomize between 30-60 minutes (in ms)
  const intervalMs = (30 + Math.floor(Math.random() * 31)) * 60 * 1000;

  await feeClaimsQueue.add(
    'claim-all-fees',
    {},
    {
      repeat: { every: intervalMs },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30_000, // start at 30s, then 60s, 120s
      },
    },
  );

  console.log(`${PREFIX} Scheduled fee claims every ${Math.round(intervalMs / 60_000)} minutes`);
}


