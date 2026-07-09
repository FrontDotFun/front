// ──────────────────────────────────────────────
// FRONT PROTOCOL — On-chain truth for public stats
//
// The DB ledger is protocol accounting; the chain is reality.
// Public stats must report reality, so we read the pool wallet
// balance and the locked $FRONT supply directly from RPC and
// cache briefly to stay gentle on the endpoint.
// ──────────────────────────────────────────────

import { PublicKey, getConnection, getProtocolWallet } from '@front-protocol/solana';

const FRONT_MINT = process.env.FRONT_TOKEN_MINT ?? 'f2LZJzFYi1DScywiKUanLpMuWoDKSgqvink82sxpump';

/**
 * Wallets whose $FRONT holdings count as "locked supply".
 * Comma-separated overrides via FRONT_LOCKED_WALLETS; defaults to the
 * protocol lock wallet holding the 6.6% supply lock.
 */
const LOCKED_WALLETS: string[] = (
  process.env.FRONT_LOCKED_WALLETS ??
  'D5Zdm8yKH3xCDMrseRirw8ULC2sEu3XwZiaX3dozQ3ZZ'
).split(',').map((s) => s.trim()).filter(Boolean);

export interface OnchainStats {
  /** Real SOL balance of the protocol pool wallet, in lamports */
  poolWalletLamports: string;
  /** Pool wallet address (transparency — let users verify on Solscan) */
  poolWalletAddress: string;
  /** $FRONT held by lock wallets (ui amount) */
  frontLockedTokens: number;
  /** Total $FRONT supply (ui amount) */
  frontTotalSupply: number;
  /** frontLockedTokens / frontTotalSupply * 100 */
  frontLockedPct: number;
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
    const mint = new PublicKey(FRONT_MINT);

    const [balance, supply, ...lockedAccounts] = await Promise.all([
      connection.getBalance(wallet),
      connection.getTokenSupply(mint),
      ...LOCKED_WALLETS.map(async (w) => {
        try {
          const accs = await connection.getParsedTokenAccountsByOwner(
            new PublicKey(w),
            { mint },
          );
          return accs.value.reduce(
            (sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
            0,
          );
        } catch {
          return 0;
        }
      }),
    ]);

    const frontLockedTokens = lockedAccounts.reduce((a, b) => a + b, 0);
    const frontTotalSupply = supply.value.uiAmount ?? 0;

    return {
      poolWalletLamports: String(balance),
      poolWalletAddress: wallet.toBase58(),
      frontLockedTokens,
      frontTotalSupply,
      frontLockedPct: frontTotalSupply > 0
        ? (frontLockedTokens / frontTotalSupply) * 100
        : 0,
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
