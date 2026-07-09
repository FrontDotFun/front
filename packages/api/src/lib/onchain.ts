// ──────────────────────────────────────────────
// FRONT PROTOCOL — On-chain truth for public stats
//
// The DB ledger is protocol accounting; the chain is reality.
// Public stats must report reality, so we read the pool wallet
// balance and the locked $FRONT supply directly from RPC and
// cache briefly to stay gentle on the endpoint.
// ──────────────────────────────────────────────

import { PublicKey, getConnection, getProtocolWallet } from '@front-protocol/solana';

// No hardcoded token — the protocol token is configured per-launch via
// FRONT_TOKEN_MINT. Until it's set, locked-supply stats are honestly
// null rather than reporting a previous launch's numbers.
const FRONT_MINT = (process.env.FRONT_TOKEN_MINT ?? '').trim();

/** Wallets whose protocol-token holdings count as "locked supply". */
const LOCKED_WALLETS: string[] = (process.env.FRONT_LOCKED_WALLETS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export interface OnchainStats {
  /** Real SOL balance of the protocol pool wallet, in lamports */
  poolWalletLamports: string;
  /** Pool wallet address (transparency — let users verify on Solscan) */
  poolWalletAddress: string;
  /** Protocol token held by lock wallets (ui amount); null if no token configured */
  frontLockedTokens: number | null;
  /** Total protocol-token supply (ui amount); null if no token configured */
  frontTotalSupply: number | null;
  /** frontLockedTokens / frontTotalSupply * 100; null if no token configured */
  frontLockedPct: number | null;
  /** Unix ms when this snapshot was taken */
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: OnchainStats | null = null;
let inFlight: Promise<OnchainStats | null> | null = null;

async function fetchSnapshot(): Promise<OnchainStats | null> {
  try {
    const connection = getConnection();
    const wallet = getProtocolWallet().publicKey;

    // Pool balance is always real; locked-supply only when a token is configured
    const balance = await connection.getBalance(wallet);

    let frontLockedTokens: number | null = null;
    let frontTotalSupply: number | null = null;
    let frontLockedPct: number | null = null;

    if (FRONT_MINT) {
      const mint = new PublicKey(FRONT_MINT);
      const [supply, ...lockedAccounts] = await Promise.all([
        connection.getTokenSupply(mint),
        ...LOCKED_WALLETS.map(async (w) => {
          try {
            const accs = await connection.getParsedTokenAccountsByOwner(new PublicKey(w), { mint });
            return accs.value.reduce(
              (sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
              0,
            );
          } catch {
            return 0;
          }
        }),
      ]);
      frontTotalSupply = supply.value.uiAmount ?? 0;
      frontLockedTokens = lockedAccounts.reduce((a, b) => a + b, 0);
      frontLockedPct = frontTotalSupply > 0 ? (frontLockedTokens / frontTotalSupply) * 100 : 0;
    }

    return {
      poolWalletLamports: String(balance),
      poolWalletAddress: wallet.toBase58(),
      frontLockedTokens,
      frontTotalSupply,
      frontLockedPct,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[onchain] snapshot failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Cached on-chain snapshot. Returns null only if RPC fails and no
 * previous snapshot exists — callers must degrade honestly, never
 * invent numbers.
 */
export async function getOnchainStats(): Promise<OnchainStats | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchSnapshot().finally(() => { inFlight = null; });
  }
  const fresh = await inFlight;
  if (fresh) cache = fresh;
  return cache; // stale-if-error: last good snapshot beats nothing
}
