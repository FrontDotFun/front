// ──────────────────────────────────────────────
// SCALE PROTOCOL — Token Discovery Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// On Solana this scanned protocol-wallet transactions for pump.fun fee
// distributions to auto-register tokens. On Robinhood Chain the fee
// source is Noxa (fun.noxa.fi), whose fee distributor contracts aren't
// published yet — so there is no on-chain signal to discover from, and
// this worker stays an honest no-op rather than inventing listings.
//
// Listing paths that DO work today:
//   • POST /tokens/list (API) — env-allowlist gated
//   • listing-scanner — sweeps SCALE_VERIFIED_TOKENS every 5 minutes
//
// When Noxa publishes their contracts, this worker should watch the
// protocol wallet's incoming WETH fee distributions on Blockscout and
// auto-register the originating tokens (the Fission approach, on EVM).
//

import { Worker, type Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[token-discovery]';

interface DiscoveryJobData {
  /** empty = full scan */
}

let loggedOnce = false;

async function processDiscovery(_job: Job<DiscoveryJobData>): Promise<void> {
  if (!loggedOnce) {
    console.log(
      `${PREFIX} Auto-discovery idle — Noxa fee-distributor contracts not published yet; ` +
      `tokens list via SCALE_VERIFIED_TOKENS allowlist (listing-scanner) or POST /tokens/list`,
    );
    loggedOnce = true;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const tokenDiscoveryWorker = new Worker<DiscoveryJobData>(
  QUEUE_NAMES.TOKEN_DISCOVERY,
  processDiscovery,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

tokenDiscoveryWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

tokenDiscoveryWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});
