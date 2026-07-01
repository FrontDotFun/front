// ──────────────────────────────────────────────
// FRONT PROTOCOL — Lock Engine Worker
// ──────────────────────────────────────────────
//
// Handles $FRONT profit locks: buys $FRONT with 30% of trading profit,
// locks it for 7 days, and processes unlock checks hourly.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL, PROFIT_LOCK_DURATION_MS, formatSol } from '@front-protocol/core';
import { getProtocolWallet, swapSolToToken } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES, lockQueue } from './queues.js';

const PREFIX = '[lock-engine]';

/** $FRONT token mint — used as output mint for Jupiter swap */
const FRONT_TOKEN_MINT = process.env.FRONT_TOKEN_MINT ?? '';

/** Default slippage tolerance for Jupiter swaps (300 bps = 3%) */
const LOCK_SLIPPAGE_BPS = 300;

interface LockJobData {
  userWallet: string;
  solAmountLamports: string; // bigint serialized as string
  positionId: number;
}

interface UnlockCheckJobData {
  /** Marker to differentiate from lock jobs */
  type: 'check-unlocks';
}

type LockEngineJobData = LockJobData | UnlockCheckJobData;

/**
 * Execute a Jupiter swap: SOL → $FRONT for the lock.
 *
 * @returns Transaction signature and number of $FRONT tokens purchased
 */
async function executeFrontBuy(solAmountLamports: bigint): Promise<{
  buyTx: string;
  tokensPurchased: bigint;
}> {
  // Simulation mode — FRONT_TOKEN_MINT not configured
  if (!FRONT_TOKEN_MINT) {
    console.warn(`${PREFIX} ⚠️  FRONT_TOKEN_MINT not set — running in simulation mode`);
    const estimatedTokens = solAmountLamports * 500n;
    return {
      buyTx: `sim_front_buy_${Date.now()}`,
      tokensPurchased: estimatedTokens,
    };
  }

  const protocolWallet = getProtocolWallet();

  console.log(
    `${PREFIX} Buying $FRONT (${FRONT_TOKEN_MINT.substring(0, 8)}…) with ${formatSol(solAmountLamports)} SOL via Jupiter`,
  );

  const { txSignature, tokensReceived } = await swapSolToToken(
    solAmountLamports,
    FRONT_TOKEN_MINT,
    LOCK_SLIPPAGE_BPS,
    protocolWallet,
  );

  console.log(
    `${PREFIX} Buy complete: received ${tokensReceived} $FRONT (tx: ${txSignature})`,
  );

  return {
    buyTx: txSignature,
    tokensPurchased: tokensReceived,
  };
}

/**
 * Lock the purchased $FRONT tokens in a token account.
 *
 * NOTE: Placeholder — requires a custom Solana lock program (PDA escrow).
 * Currently returns a simulated tx signature. Replace once the on-chain
 * lock program is deployed.
 *
 * @returns Lock transaction signature
 */
async function executeLock(
  userWallet: string,
  tokenAmount: bigint,
): Promise<string> {
  console.warn(
    `${PREFIX} ⚠️  executeLock is a placeholder — custom Solana lock program not yet deployed. ` +
    `Would lock ${tokenAmount} $FRONT for wallet ${userWallet}`,
  );
  return `sim_lock_${userWallet}_${Date.now()}`;
}

/**
 * Release unlocked $FRONT tokens back to the user's wallet.
 *
 * NOTE: Placeholder — requires a custom Solana lock program (PDA escrow).
 * Currently returns a simulated tx signature. Replace once the on-chain
 * lock program is deployed.
 *
 * @returns Unlock transaction signature
 */
async function executeUnlock(
  userWallet: string,
  tokenAmount: bigint,
): Promise<string> {
  console.warn(
    `${PREFIX} ⚠️  executeUnlock is a placeholder — custom Solana lock program not yet deployed. ` +
    `Would unlock ${tokenAmount} $FRONT to wallet ${userWallet}`,
  );
  return `sim_unlock_${userWallet}_${Date.now()}`;
}

/**
 * Process a lock job: buy $FRONT and lock it for 7 days.
 */
async function processLockJob(job: Job<LockJobData>): Promise<void> {
  const { userWallet, solAmountLamports: solAmountStr, positionId } = job.data;
  const solAmount = BigInt(solAmountStr);

  console.log(
    `${PREFIX} Processing lock: ${formatSol(solAmount)} SOL → $FRONT for wallet ${userWallet} (position #${positionId})`,
  );

  try {
    // Step 1: Buy $FRONT with the SOL amount
    const { buyTx, tokensPurchased } = await executeFrontBuy(solAmount);

    // Step 2: Lock the tokens
    const lockTx = await executeLock(userWallet, tokensPurchased);

    // Step 3: Record in database
    const unlocksAt = new Date(Date.now() + PROFIT_LOCK_DURATION_MS);

    await prisma.profitLock.create({
      data: {
        userWallet,
        solAmount: solAmount,
        tokenAmount: tokensPurchased,
        positionId,
        buyTx,
        lockTx,
        unlocksAt,
        isUnlocked: false,
      },
    });

    console.log(
      `${PREFIX} 🔒 Locked ${tokensPurchased} $FRONT for ${userWallet} until ${unlocksAt.toISOString()} (buy: ${buyTx}, lock: ${lockTx})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error processing lock for position #${positionId}: ${msg}`);
    throw err;
  }
}

/**
 * Check for locks that are ready to be unlocked (unlocks_at <= now).
 */
async function processUnlockCheck(_job: Job<UnlockCheckJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Checking for expired locks...`);

  try {
    const expiredLocks = await prisma.profitLock.findMany({
      where: {
        isUnlocked: false,
        unlocksAt: { lte: new Date() },
      },
      orderBy: { unlocksAt: 'asc' },
      take: 100, // process in batches
    });

    if (expiredLocks.length === 0) {
      console.log(`${PREFIX} No expired locks found`);
      return;
    }

    console.log(`${PREFIX} Found ${expiredLocks.length} expired lock(s) to unlock`);

    let unlockedCount = 0;

    for (const lock of expiredLocks) {
      try {
        // Execute on-chain unlock
        const unlockTx = await executeUnlock(lock.userWallet, lock.tokenAmount);

        // Update database
        await prisma.profitLock.update({
          where: { id: lock.id },
          data: {
            isUnlocked: true,
            unlockTx,
          },
        });

        unlockedCount++;
        console.log(
          `${PREFIX} 🔓 Unlocked ${lock.tokenAmount} $FRONT for ${lock.userWallet} (lock #${lock.id}, tx: ${unlockTx})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error unlocking lock #${lock.id}: ${msg}`);
        // Continue to next lock
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Unlock check complete: ${unlockedCount}/${expiredLocks.length} unlocked (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error in unlock check: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker — routes jobs based on name
// ──────────────────────────────────────────────

export const lockEngineWorker = new Worker<LockEngineJobData>(
  QUEUE_NAMES.LOCK_QUEUE,
  async (job: Job<LockEngineJobData>) => {
    if (job.name === 'check-unlocks') {
      return processUnlockCheck(job as Job<UnlockCheckJobData>);
    }
    return processLockJob(job as Job<LockJobData>);
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

lockEngineWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} (${job.name}) completed`);
});

lockEngineWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} (${job?.name}) failed: ${err.message}`);
});

lockEngineWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

/**
 * Schedule the hourly unlock check as a repeatable job.
 */
export async function scheduleLockUnlockChecker(): Promise<void> {
  // Remove any existing repeatable unlock-check jobs
  const existing = await lockQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'check-unlocks') {
      await lockQueue.removeRepeatableByKey(job.key);
    }
  }

  await lockQueue.add(
    'check-unlocks',
    { type: 'check-unlocks' as const },
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );

  console.log(`${PREFIX} Scheduled unlock checks every hour`);
}


