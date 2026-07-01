// ──────────────────────────────────────────────
// FRONT PROTOCOL — Listing Scanner Worker
// ──────────────────────────────────────────────
//
// Automatically discovers and lists tokens whose creators have directed
// their pump.fun fee-sharing config to the Front Protocol wallet.
//
// Strategy:
//   1. Periodic scan: fetch latest pump.fun tokens, check fee_recipient
//   2. Re-verify existing listed tokens to deactivate any that removed fees
//   3. Only list tokens where fee_recipient === PROTOCOL_WALLET
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { determineTier } from '@front-protocol/core';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';
const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

interface ListingScanJobData {
  /** When set, only scan a specific mint address */
  mint?: string;
}

/**
 * Verify a token's fee_recipient via pump.fun API.
 * Returns the full token data if fees are redirected to protocol, null otherwise.
 */
async function verifyFeeRedirect(mint: string): Promise<{
  verified: boolean;
  name: string;
  symbol: string;
  creator: string;
  imageUri: string;
  marketCap: number;
  complete: boolean;
  feeRecipient: string | null;
} | null> {
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;
    const feeRecipient = (data.fee_recipient as string) || (data.creator_fee_wallet as string) || null;

    return {
      verified: feeRecipient === PROTOCOL_WALLET,
      name: (data.name as string) || 'Unknown',
      symbol: (data.symbol as string) || '???',
      creator: (data.creator as string) || '',
      imageUri: (data.image_uri as string) || '',
      marketCap: (data.usdMarketCap as number) || (data.market_cap as number) || 0,
      complete: (data.complete as boolean) || false,
      feeRecipient,
    };
  } catch {
    return null;
  }
}

/**
 * Process a listing scan job.
 * 1. Scans latest pump.fun tokens for new fee-verified listings
 * 2. Re-verifies existing listed tokens
 */
async function processListingScan(job: Job<ListingScanJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting listing scan (job ${job.id})`);

  try {
    // If a specific mint is provided, only check that one
    if (job.data.mint) {
      await checkAndListToken(job.data.mint);
      return;
    }

    // ── Part 1: Scan for new tokens ──
    console.log(`${PREFIX} Scanning latest pump.fun tokens...`);
    let newListings = 0;

    try {
      const response = await fetch('https://frontend-api-v3.pump.fun/coins/latest', {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const data = await response.json() as Array<Record<string, unknown>>;
        if (Array.isArray(data)) {
          const mints = data
            .map((t) => (t.mint as string) || '')
            .filter((m) => m.length > 0);

          console.log(`${PREFIX} Fetched ${mints.length} latest token(s)`);

          const MAX_NEW_PER_SCAN = 10;
          for (const mint of mints) {
            if (newListings >= MAX_NEW_PER_SCAN) break;
            try {
              const listed = await checkAndListToken(mint);
              if (listed) newListings++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`${PREFIX} Error checking ${mint.substring(0, 8)}…: ${msg}`);
            }
          }
        }
      } else {
        console.warn(`${PREFIX} Pump.fun API returned ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${PREFIX} Failed to fetch latest tokens: ${msg}`);
    }

    // ── Part 2: Re-verify existing listed tokens ──
    console.log(`${PREFIX} Re-verifying existing listed tokens...`);
    let deactivated = 0;
    let reactivated = 0;

    const existingTokens = await prisma.token.findMany({
      where: {},
      select: { id: true, address: true, symbol: true, isActive: true },
    });

    for (const token of existingTokens) {
      try {
        const result = await verifyFeeRedirect(token.address);
        if (!result) {
          console.warn(`${PREFIX} Could not verify ${token.symbol} (${token.address.substring(0, 8)}…) — API unavailable`);
          continue;
        }

        if (!result.verified && token.isActive) {
          // Fee no longer points to protocol — deactivate
          await prisma.token.update({
            where: { id: token.id },
            data: { isActive: false },
          });
          deactivated++;
          console.log(
            `${PREFIX} ❌ Deactivated ${token.symbol} — fee_recipient is "${result.feeRecipient}", not protocol wallet`,
          );
        } else if (result.verified && !token.isActive) {
          // Fee was re-pointed to protocol — reactivate
          await prisma.token.update({
            where: { id: token.id },
            data: { isActive: true },
          });
          reactivated++;
          console.log(`${PREFIX} ♻️ Reactivated ${token.symbol} — fees now redirected to protocol`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Re-verify error for ${token.symbol}: ${msg}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Scan complete: ${newListings} new, ${deactivated} deactivated, ${reactivated} reactivated (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Listing scan error: ${msg}`);
    throw err;
  }
}

/**
 * Check a specific token's fee redirect and auto-list if verified.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  // Check if already listed
  const existing = await prisma.token.findUnique({
    where: { address: mint },
    select: { id: true, isActive: true },
  });

  if (existing) return false;

  // Verify fee redirect on pump.fun
  const result = await verifyFeeRedirect(mint);
  if (!result) {
    return false;
  }

  if (!result.verified) {
    // Fee not redirected to protocol — skip silently
    return false;
  }

  // ✅ Fee verified — auto-list the token
  // Determine tier from market cap
  const tierConfig = determineTier(result.marketCap, result.marketCap * 0.1, result.complete);
  const tier = tierConfig ? tierConfig.tier : 'degen';

  // Fetch DexScreener for better liquidity data
  let imageUri = result.imageUri;
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (dexRes.ok) {
      const dexData = await dexRes.json() as any;
      const pairs = dexData.pairs || [];
      if (pairs.length > 0) {
        const bestPair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        imageUri = bestPair.info?.imageUrl || imageUri;
      }
    }
  } catch {
    // Use pump.fun image as fallback
  }

  await prisma.token.create({
    data: {
      address: mint,
      name: result.name,
      symbol: result.symbol,
      imageUri,
      creatorWallet: result.creator,
      tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Auto-listed ${result.symbol} (${result.name}) | ` +
    `tier=${tier} | fee_recipient=${PROTOCOL_WALLET.substring(0, 8)}… | ` +
    `mcap=$${result.marketCap.toLocaleString()}`,
  );

  return true;
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const listingScannerWorker = new Worker<ListingScanJobData>(
  QUEUE_NAMES.LISTING_SCAN,
  processListingScan,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

listingScannerWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

listingScannerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

listingScannerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Exports for manual listing check
// ──────────────────────────────────────────────

export { checkAndListToken };
