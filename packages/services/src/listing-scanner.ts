// ──────────────────────────────────────────────
// SCALE PROTOCOL — Listing Scanner Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// On Solana this decoded pump.fun fee-sharing configs on-chain to
// auto-list tokens. Noxa (fun.noxa.fi) doesn't publish its fee-config
// contracts yet, so automatic fee-redirect verification isn't possible
// on Robinhood Chain — we don't pretend otherwise.
//
// What runs today:
//   • checkAndListToken(mint): verifies the token is a real ERC-20 on
//     Robinhood Chain with a live Uniswap V3 pool (GeckoTerminal), and
//     lists it if it's on the manually-verified allowlist
//     (SCALE_VERIFIED_TOKENS env) — same gate the API uses.
//   • Periodic scan: sweeps the allowlist so newly-added env entries
//     get listed without a manual API call.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { determineTier } from '@front-protocol/core';
import { erc20TotalSupply } from '@front-protocol/evm';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';
const PROTOCOL_WALLET = (process.env.PROTOCOL_WALLET || '').trim();

const GT = 'https://api.geckoterminal.com/api/v2';
const GT_NETWORK = 'robinhood';

/** Manually-verified Noxa fee redirects (comma-separated 0x addresses). */
function verifiedTokens(): string[] {
  return (process.env.SCALE_VERIFIED_TOKENS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
}

interface ListingScanJobData {
  /** When set, only scan a specific token address */
  mint?: string;
}

/**
 * Verify a token exists on Robinhood Chain + fetch metadata from
 * GeckoTerminal. Fee-redirect verification is the env allowlist —
 * Noxa exposes no programmatic check yet.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  const addr = mint.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    console.warn(`${PREFIX} Skipping ${mint} — not a Robinhood Chain (0x…) address`);
    return false;
  }

  const existing = await prisma.token.findUnique({ where: { address: addr } });
  if (existing) {
    if (!existing.isActive) {
      await prisma.token.update({ where: { id: existing.id }, data: { isActive: true } });
      console.log(`${PREFIX} Reactivated ${existing.symbol ?? addr}`);
      return true;
    }
    return false; // already listed and active
  }

  if (!verifiedTokens().includes(addr)) {
    console.log(`${PREFIX} ${addr} not on the verified allowlist — skipping`);
    return false;
  }

  // Must be a real ERC-20 on Robinhood Chain
  try {
    await erc20TotalSupply(addr);
  } catch {
    console.warn(`${PREFIX} ${addr} is not readable as an ERC-20 on Robinhood Chain — skipping`);
    return false;
  }

  // Metadata + market data from GeckoTerminal
  let name: string | null = null;
  let symbol: string | null = null;
  let imageUri: string | null = null;
  let marketCapUsd = 0;
  let liquidityUsd = 0;
  try {
    const res = await fetch(`${GT}/networks/${GT_NETWORK}/tokens/${addr}?include=top_pools`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const a = json.data?.attributes ?? {};
      const pool = (json.included ?? [])[0]?.attributes ?? {};
      name = a.name ?? null;
      symbol = a.symbol ?? null;
      imageUri = a.image_url && a.image_url !== 'missing.png' ? a.image_url : null;
      marketCapUsd = parseFloat(a.market_cap_usd ?? a.fdv_usd ?? '0') || 0;
      liquidityUsd = parseFloat(a.total_reserve_in_usd ?? pool.reserve_in_usd ?? '0') || 0;
    }
  } catch {
    // GT down or token too new — list with defaults
  }

  const tierConfig = determineTier(marketCapUsd, liquidityUsd, liquidityUsd > 0);
  if (!tierConfig) {
    console.warn(`${PREFIX} ${addr} liquidity too low to list safely ($${liquidityUsd.toFixed(0)}) — skipping`);
    return false;
  }

  await prisma.token.create({
    data: {
      address: addr,
      name,
      symbol,
      imageUri,
      creatorWallet: PROTOCOL_WALLET || addr, // creator unknown until Noxa exposes it
      tier: tierConfig.tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Listed ${symbol ?? addr} (tier: ${tierConfig.tier}, liq: $${liquidityUsd.toFixed(0)})`,
  );
  return true;
}

/**
 * Periodic scan: sweep the verified allowlist for anything not yet listed.
 */
async function processScan(job: Job<ListingScanJobData>): Promise<void> {
  if (job.data.mint) {
    await checkAndListToken(job.data.mint);
    return;
  }

  const allow = verifiedTokens();
  if (allow.length === 0) {
    return; // nothing verified yet — quiet no-op
  }

  let listed = 0;
  for (const addr of allow) {
    try {
      if (await checkAndListToken(addr)) listed++;
    } catch (err) {
      console.error(`${PREFIX} Error listing ${addr}:`, err instanceof Error ? err.message : err);
    }
  }
  if (listed > 0) console.log(`${PREFIX} Scan complete — ${listed} new listing(s)`);
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const listingScannerWorker = new Worker<ListingScanJobData>(
  QUEUE_NAMES.LISTING_SCAN,
  processScan,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

listingScannerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

listingScannerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

export { checkAndListToken };
