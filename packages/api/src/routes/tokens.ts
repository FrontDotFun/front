import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { getTierConfig, determineTier, type Tier } from '@front-protocol/core';
import { erc20TotalSupply } from '@front-protocol/evm';
import { fetchToken as gtFetchToken } from '../lib/geckoterminal';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError } from '../lib/errors';

const PROTOCOL_WALLET = (process.env.PROTOCOL_WALLET || '').trim();

/** Tokens whose Noxa creator-fee redirect to the protocol wallet has been
 *  verified manually (comma-separated env). Noxa doesn't expose a public
 *  fee-config read yet, so we don't pretend to verify it on-chain. */
const VERIFIED_FEE_TOKENS = new Set(
  (process.env.SCALE_VERIFIED_TOKENS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

const router = Router();

/**
 * GET /tokens/listed
 *
 * Return all active listed tokens with tier info, paginated.
 * Query params: limit (default 20, max 100), offset (default 0), tier (optional filter)
 */
router.get('/listed', publicLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const tierFilter = req.query.tier as string | undefined;

    const where: Record<string, unknown> = { isActive: true };
    if (tierFilter && ['bonded', 'rising', 'degen'].includes(tierFilter)) {
      where.tier = tierFilter;
    }

    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        orderBy: { totalTradingVolume: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.token.count({ where }),
    ]);

    const data = tokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        id: token.id,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        creatorWallet: token.creatorWallet,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        flatFeePct: config.flatFeeBps / 100,
        exitThresholdPct: config.exitThresholdBps / 100,
        listedAt: token.listedAt,
        isActive: token.isActive,
        totalTradingVolume: String(token.totalTradingVolume),
        totalCreatorPayouts: String(token.totalCreatorPayouts),
      };
    });

    sendPaginated(res, data, total, limit, offset);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/trending
 *
 * Return top 10 tokens by recent trading volume (last 24h based on positions).
 * Falls back to most recently listed active tokens if no recent trading activity.
 */
router.get('/trending', publicLimiter, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Aggregate recent volume from positions opened in the last 24h
    const recentPositions = await prisma.position.groupBy({
      by: ['tokenId'],
      where: {
        openedAt: { gte: twentyFourHoursAgo },
      },
      _sum: {
        userCapital: true,
        protocolCapital: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          userCapital: 'desc',
        },
      },
      take: 10,
    });

    // If we have recent activity, return volume-based trending
    if (recentPositions.length > 0) {
      const tokenIds = recentPositions.map((rp) => rp.tokenId);
      const tokens = await prisma.token.findMany({
        where: { id: { in: tokenIds }, isActive: true },
      });

      const tokenMap = new Map(tokens.map((t) => [t.id, t]));

      const data = recentPositions
        .map((rp) => {
          const token = tokenMap.get(rp.tokenId);
          if (!token) return null;
          const config = getTierConfig(token.tier as Tier);
          const volume24h = (rp._sum.userCapital ?? 0n) + (rp._sum.protocolCapital ?? 0n);
          return {
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            imageUri: token.imageUri,
            tier: token.tier,
            tierLabel: config.label,
            maxLeverage: config.maxLeverage,
            volume24h: String(volume24h),
            trades24h: rp._count,
            totalTradingVolume: String(token.totalTradingVolume),
          };
        })
        .filter(Boolean);

      return sendSuccess(res, data);
    }

    // Fallback: return listed active tokens ordered by total volume
    const fallbackTokens = await prisma.token.findMany({
      where: { isActive: true },
      orderBy: [{ totalTradingVolume: 'desc' }, { listedAt: 'desc' }],
      take: 10,
    });

    const data = fallbackTokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        volume24h: '0',
        trades24h: 0,
        totalTradingVolume: String(token.totalTradingVolume),
      };
    });

    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/search?q=...
 *
 * Search listed tokens by name, symbol, or address prefix.
 * Returns up to 20 results ordered by total trading volume.
 */
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (q.length < 1) {
      sendSuccess(res, []);
      return;
    }

    const tokens = await prisma.token.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { symbol: { contains: q, mode: 'insensitive' } },
          { address: { startsWith: q } },
        ],
      },
      take: 20,
      orderBy: { totalTradingVolume: 'desc' },
    });

    const data = tokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        totalTradingVolume: String(token.totalTradingVolume),
      };
    });

    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/:address
 *
 * Return a single token's details including tier config, stats, and creator info.
 */
router.get('/:address', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;

    const token = await prisma.token.findUnique({
      where: { address },
    });

    if (!token) {
      throw new NotFoundError('Token', address);
    }

    const config = getTierConfig(token.tier as Tier);

    // Count active positions for this token
    const activePositions = await prisma.position.count({
      where: { tokenId: token.id, status: 'open' },
    });

    // Recent 24h volume
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentVolume = await prisma.position.aggregate({
      where: {
        tokenId: token.id,
        openedAt: { gte: twentyFourHoursAgo },
      },
      _sum: {
        userCapital: true,
        protocolCapital: true,
      },
      _count: true,
    });

    const volume24h = (recentVolume._sum.userCapital ?? 0n) + (recentVolume._sum.protocolCapital ?? 0n);

    sendSuccess(res, {
      id: token.id,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      imageUri: token.imageUri,
      creatorWallet: token.creatorWallet,
      tier: token.tier,
      tierLabel: config.label,
      maxLeverage: config.maxLeverage,
      flatFeePct: config.flatFeeBps / 100,
      exitThresholdPct: config.exitThresholdBps / 100,
      feeWalletPda: token.feeWalletPda,
      listedAt: token.listedAt,
      isActive: token.isActive,
      totalFeesClaimed: String(token.totalFeesClaimed),
      totalTradingVolume: String(token.totalTradingVolume),
      totalCreatorPayouts: String(token.totalCreatorPayouts),
      activePositions,
      volume24h: String(volume24h),
      trades24h: recentVolume._count,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /tokens/list
 *
 * A creator lists their Noxa-launched token on SCALE.
 * Verifies the token is a real ERC-20 on Robinhood Chain with a live
 * Uniswap V3 pool, fetches metadata from GeckoTerminal, and gates on
 * the Noxa creator-fee redirect (manual verification for now).
 */
router.post('/list', async (req, res) => {
  try {
    const { tokenAddress } = req.body;

    if (!tokenAddress) {
      throw new ValidationError('tokenAddress is required');
    }

    // Validate token address format (Robinhood Chain — EVM)
    if (typeof tokenAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      throw new ValidationError('Invalid token address — must be a Robinhood Chain (0x…) address');
    }

    // Check if token already listed
    const existing = await prisma.token.findUnique({
      where: { address: tokenAddress },
    });
    if (existing) {
      throw new ValidationError('Token is already listed');
    }

    // ── On-chain existence check ──
    // The token must be a real ERC-20 on Robinhood Chain.
    try {
      await erc20TotalSupply(tokenAddress);
    } catch {
      throw new ValidationError(
        'Token contract not found on Robinhood Chain. Launch it via Noxa (fun.noxa.fi/robinhood/launch) first.',
      );
    }

    // ── Fee verification ──
    // Skip verification for the protocol's own $SCALE token.
    const SCALE_MINT = (process.env.FRONT_TOKEN_MINT || '').toLowerCase();
    const addrLower = tokenAddress.toLowerCase();
    let feeVerified =
      (addrLower === SCALE_MINT && SCALE_MINT.length > 0) ||
      VERIFIED_FEE_TOKENS.has(addrLower);

    if (!feeVerified) {
      throw new ValidationError(
        'Creator-fee redirect not verified yet. On Noxa (fun.noxa.fi), redirect your ' +
        "token's creator fees to the protocol wallet" +
        (PROTOCOL_WALLET ? `: ${PROTOCOL_WALLET}` : '') +
        ', then contact the team to activate listing. Automatic verification is coming.',
      );
    }

    // ── Metadata + tier from GeckoTerminal (Robinhood Chain) ──
    let resolvedName: string | null = null;
    let resolvedSymbol: string | null = null;
    let resolvedImage: string | null = null;
    let marketCapUsd = 0;
    let liquidityUsd = 0;
    let isBonded = false;

    try {
      const gt = await gtFetchToken(tokenAddress);
      resolvedName = gt.name !== 'Unknown' ? gt.name : null;
      resolvedSymbol = gt.symbol !== '???' ? gt.symbol : null;
      resolvedImage = gt.logoURI;
      marketCapUsd = gt.marketCap;
      liquidityUsd = gt.liquidity;
      // Noxa launches straight into a locked Uniswap V3 pool —
      // a live pool with real liquidity counts as bonded.
      isBonded = liquidityUsd > 0;
    } catch {
      // GeckoTerminal has no data yet (brand-new launch) — defaults apply
    }

    // Determine tier from market data
    const tierConfig = determineTier(marketCapUsd, liquidityUsd, isBonded);
    const resolvedTier: Tier = tierConfig ? tierConfig.tier as Tier : 'degen';

    // Create token record
    const token = await prisma.token.create({
      data: {
        address: tokenAddress,
        name: resolvedName,
        symbol: resolvedSymbol,
        imageUri: resolvedImage,
        creatorWallet: PROTOCOL_WALLET,
        tier: resolvedTier,
        isActive: true,
      },
    });

    const config = getTierConfig(resolvedTier);

    sendSuccess(res, {
      id: token.id,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      imageUri: token.imageUri,
      creatorWallet: token.creatorWallet,
      tier: token.tier,
      tierLabel: config.label,
      maxLeverage: config.maxLeverage,
      feeVerified,
      marketCapUsd,
      liquidityUsd,
      listedAt: token.listedAt,
      message: 'Token listed successfully',
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;

