// ──────────────────────────────────────────────
// FRONT PROTOCOL — Burn Engine Worker
// ──────────────────────────────────────────────
//
// Accumulates SOL for $FRONT buyback-and-burn operations.
// Once the pending balance exceeds 1 SOL, executes the burn batch.
// Pending balance is persisted in Redis to survive process restarts.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL, formatSol } from '@front-protocol/core';
import { getProtocolWallet, swapSolToToken, burnToken, PublicKey } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[burn-engine]';

/** Minimum SOL to accumulate before executing a burn (1 SOL) */
const BURN_THRESHOLD_LAMPORTS = LAMPORTS_PER_SOL; // 1_000_000_000n

/** Redis key for the persistent burn accumulator */
const REDIS_PENDING_BURN_KEY = 'front:burn:pending_lamports';

/** $FRONT token mint — read from env; empty triggers simulation mode */
const FRONT_TOKEN_MINT = process.env.FRONT_TOKEN_MINT ?? '';

/** Default slippage tolerance for Jupiter swaps (300 bps = 3%) */
const BURN_SLIPPAGE_BPS = 300;

interface BurnJobData {
  positionId: number;
  solAmountLamports: string; // bigint serialized as string
}

/**
 * Get the current pending burn balance from Redis.
 */
async function getPendingFromRedis(): Promise<bigint> {
  const val = await redisConnection.get(REDIS_PENDING_BURN_KEY);
  return val ? BigInt(val) : 0n;
}

/**
 * Atomically increment the pending burn balance in Redis.
 */
async function addPendingToRedis(amount: bigint): Promise<bigint> {
  const newVal = await redisConnection.call('INCRBY', REDIS_PENDING_BURN_KEY, amount.toString());
  return BigInt(newVal as string | number);
}

/**
 * Reset the pending burn balance in Redis (after executing a burn).
 */
async function resetPendingInRedis(): Promise<void> {
  await redisConnection.set(REDIS_PENDING_BURN_KEY, '0');
}

/**
 * Execute a buyback-and-burn: swap SOL → $FRONT via Jupiter, then burn the tokens.
 *
 * @returns Transaction signature and number of $FRONT tokens burned
 */
async function executeBurn(solAmountLamports: bigint): Promise<{
  txSignature: string;
  tokensBurned: bigint;
}> {
  // Simulation mode — FRONT_TOKEN_MINT not configured
  if (!FRONT_TOKEN_MINT) {
    console.warn(`${PREFIX} ⚠️  FRONT_TOKEN_MINT not set — running in simulation mode`);
    const estimatedTokens = solAmountLamports * 1000n;
    return {
      txSignature: `sim_burn_${Date.now()}`,
      tokensBurned: estimatedTokens,
    };
  }

  const protocolWallet = getProtocolWallet();
  const frontMint = new PublicKey(FRONT_TOKEN_MINT);

  // Step 1: Jupiter swap SOL → $FRONT
  console.log(
    `${PREFIX} Executing Jupiter swap ${formatSol(solAmountLamports)} SOL → $FRONT (${FRONT_TOKEN_MINT.substring(0, 8)}…)`,
  );

  const { txSignature: swapTx, tokensReceived } = await swapSolToToken(
    solAmountLamports,
    FRONT_TOKEN_MINT,
    BURN_SLIPPAGE_BPS,
    protocolWallet,
  );

  console.log(
    `${PREFIX} Swap complete: received ${tokensReceived} $FRONT (tx: ${swapTx})`,
  );

  // Step 2: Burn the purchased $FRONT tokens
  console.log(`${PREFIX} Burning ${tokensReceived} $FRONT tokens…`);

  const burnTx = await burnToken(frontMint, tokensReceived, protocolWallet);

  console.log(`${PREFIX} 🔥 Burn tx confirmed: ${burnTx}`);

  return {
    txSignature: burnTx,
    tokensBurned: tokensReceived,
  };
}

/**
 * Process a burn job: accumulate SOL in Redis, execute when threshold is met.
 */
async function processBurnJob(job: Job<BurnJobData>): Promise<void> {
  const { positionId, solAmountLamports: solAmountStr } = job.data;
  const solAmount = BigInt(solAmountStr);

  console.log(
    `${PREFIX} Received burn request: ${formatSol(solAmount)} SOL from position #${positionId}`,
  );

  try {
    // Atomically accumulate in Redis
    const newPending = await addPendingToRedis(solAmount);
    console.log(`${PREFIX} Pending burn total: ${formatSol(newPending)} SOL`);

    // Check if we've hit the threshold
    if (newPending < BURN_THRESHOLD_LAMPORTS) {
      console.log(
        `${PREFIX} Below threshold (${formatSol(BURN_THRESHOLD_LAMPORTS)} SOL), accumulating...`,
      );
      return;
    }

    // Execute burn with accumulated amount
    const burnAmount = newPending;

    console.log(`${PREFIX} Threshold reached! Executing burn of ${formatSol(burnAmount)} SOL`);

    const { txSignature, tokensBurned } = await executeBurn(burnAmount);

    // Only reset Redis AFTER successful burn — if burn fails, amount stays for next attempt
    await resetPendingInRedis();

    // Record burn in database
    await prisma.$transaction([
      // Create burn record
      prisma.burn.create({
        data: {
          solAmount: burnAmount,
          tokenAmount: tokensBurned,
          txSignature,
          positionId,
        },
      }),

      // Pool ledger entry (outflow — SOL leaves the pool for burn)
      prisma.poolLedger.create({
        data: {
          type: 'burn',
          amount: -burnAmount, // negative = outflow
          referenceId: positionId,
          txSignature,
        },
      }),
    ]);

    console.log(
      `${PREFIX} 🔥 Burned ${formatSol(burnAmount)} SOL → ${tokensBurned} $FRONT tokens (tx: ${txSignature})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${PREFIX} Error processing burn for position #${positionId}: ${msg}`,
    );
    throw err; // Let BullMQ retry — Redis still holds the accumulated amount
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const burnEngineWorker = new Worker<BurnJobData>(
  QUEUE_NAMES.BURN_QUEUE,
  processBurnJob,
  {
    connection: redisConnection,
    concurrency: 1, // sequential to maintain accurate pending balance
  },
);

burnEngineWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

burnEngineWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

burnEngineWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Accessors (for testing / monitoring)
// ──────────────────────────────────────────────

/** Get the current pending burn amount from Redis (for monitoring) */
export async function getPendingBurnLamports(): Promise<bigint> {
  return getPendingFromRedis();
}

/** Reset pending burns in Redis (for testing) */
export async function resetPendingBurns(): Promise<void> {
  await resetPendingInRedis();
}


