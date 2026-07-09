// ──────────────────────────────────────────────
// FRONT PROTOCOL — Token Discovery Worker
// ──────────────────────────────────────────────
//
// Ported from Fission's token-discovery.js
// Scans recent transactions on the protocol wallet for pump.fun fee
// distributions. Auto-registers any new tokens found.
//
// This is how Fission detected tokens: it doesn't rely on pump.fun API
// exposing fee_recipient. Instead, it watches the protocol wallet for
// incoming pump.fun fee distribution transactions and extracts the
// token mint addresses from them.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { determineTier } from '@front-protocol/core';
import { getConnection, PublicKey } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[token-discovery]';
const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || 'DAcjYqJzSHXqYfGzgEwfd2HVcxYPXemnLXc27fHwaLq4';

// Pump.fun program IDs to look for in transaction logs
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

interface DiscoveryJobData {
  /** empty = full scan */
}

/**
 * Discover tokens by scanning protocol wallet transactions.
 * This is the Fission approach: look for pump.fun fee distribution
 * transactions that sent SOL to our protocol wallet.
 */
async function processDiscovery(job: Job<DiscoveryJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Running token auto-discovery (job ${job.id})`);

  try {
    const connection = getConnection();
    const walletPubkey = new PublicKey(PROTOCOL_WALLET);

    // Get existing tokens
    const existingTokens = await prisma.token.findMany({
      select: { address: true },
    });
    const existingMints = new Set(existingTokens.map((t) => t.address));

    // Scan last 100 transactions on the protocol wallet
    const sigs = await connection.getSignaturesForAddress(walletPubkey, { limit: 100 });
    const newMints = new Set<string>();

    console.log(`${PREFIX} Scanning ${sigs.length} recent transactions...`);

    for (const sig of sigs) {
      if (sig.err) continue; // Skip failed txs

      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) continue;

        const logs = tx.meta.logMessages?.join(' ') || '';

        // Only look at pump.fun related transactions
        const isPumpTx =
          logs.includes('distribute') ||
          logs.includes(PUMP_PROGRAM) ||
          logs.includes(PUMP_AMM_PROGRAM) ||
          logs.includes(PUMP_FEE_PROGRAM);

        if (!isPumpTx) continue;

        // Extract account keys from the transaction
        const accountKeys = tx.transaction.message.staticAccountKeys ||
          (tx.transaction.message as any).accountKeys || [];

        for (const acc of accountKeys) {
          const pk = typeof acc === 'string' ? acc : acc.toBase58();
          // Pump.fun token mints end with 'pump'
          if (pk.endsWith('pump') && !existingMints.has(pk) && !newMints.has(pk)) {
            newMints.add(pk);
          }
        }
      } catch {
        // Skip failed tx parsing
      }
    }

    if (newMints.size === 0) {
      console.log(`${PREFIX} No new tokens discovered`);
      const elapsed = Date.now() - startTime;
      console.log(`${PREFIX} Discovery complete (${elapsed}ms)`);
      return;
    }

    console.log(`${PREFIX} Found ${newMints.size} new token(s) to register`);

    let registered = 0;
    for (const mint of newMints) {
      try {
        // Fetch metadata from pump.fun
        const resp = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          console.warn(`${PREFIX} Pump.fun API failed for ${mint.substring(0, 16)}…: ${resp.status}`);
          continue;
        }
        const data = await resp.json() as Record<string, unknown>;

        const name = (data.name as string) || 'Unknown';
        const symbol = (data.symbol as string) || '???';
        const imageUri = (data.image_uri as string) || '';
        const creator = (data.creator as string) || '';
        const marketCap = (data.usdMarketCap as number) || (data.usd_market_cap as number) || 0;
        const complete = (data.complete as boolean) || false;

        // Determine tier
        const tierConfig = determineTier(marketCap, marketCap * 0.1, complete);
        const tier = tierConfig ? tierConfig.tier : 'degen';

        await prisma.token.create({
          data: {
            address: mint,
            name,
            symbol,
            imageUri,
            creatorWallet: creator,
            tier,
            isActive: true,
            isAutoListed: true,
          },
        });

        registered++;
        console.log(
          `${PREFIX} ✅ Auto-registered ${symbol} (${name}) | tier=${tier} | mint=${mint.substring(0, 16)}…`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${PREFIX} Failed to register ${mint.substring(0, 16)}…: ${msg}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Discovery complete: ${newMints.size} found, ${registered} registered (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Discovery error: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const tokenDiscoveryWorker = new Worker<DiscoveryJobData>(
  QUEUE_NAMES.TOKEN_DISCOVERY || 'token-discovery',
  processDiscovery,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

tokenDiscoveryWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

tokenDiscoveryWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

tokenDiscoveryWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});
