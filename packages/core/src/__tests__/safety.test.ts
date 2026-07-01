import { describe, it, expect } from 'vitest';
import {
  estimateSlippageRisk,
  validatePositionSafety,
  calculateSafeExitThreshold,
  maxSafePositionSize,
  calculateInsuranceFundTarget,
  calculateInsuranceDeposit,
} from '../safety.js';
import { LAMPORTS_PER_SOL, SAFETY_BUFFER_BPS, BPS } from '../types.js';
import { TIER_CONFIGS } from '../pricing.js';

const ONE_SOL = LAMPORTS_PER_SOL;

// ──────────────────────────────────────────────
// estimateSlippageRisk
// ──────────────────────────────────────────────

describe('estimateSlippageRisk', () => {
  const solPrice = 150; // $150/SOL

  it('returns low risk (0-20) for <1% of liquidity', () => {
    // 0.1 SOL = $15, liquidity = $100K → 0.015% impact
    const risk = estimateSlippageRisk(ONE_SOL / 10n, 100_000, solPrice);
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThan(20);
  });

  it('returns medium risk (20-50) for 1-5% of liquidity', () => {
    // 20 SOL = $3000, liquidity = $100K → 3% impact
    const risk = estimateSlippageRisk(ONE_SOL * 20n, 100_000, solPrice);
    expect(risk).toBeGreaterThanOrEqual(20);
    expect(risk).toBeLessThan(50);
  });

  it('returns high risk (50-80) for 5-20% of liquidity', () => {
    // 50 SOL = $7500, liquidity = $100K → 7.5% impact
    const risk = estimateSlippageRisk(ONE_SOL * 50n, 100_000, solPrice);
    expect(risk).toBeGreaterThanOrEqual(50);
    expect(risk).toBeLessThan(80);
  });

  it('returns extreme risk (80-100) for >20% of liquidity', () => {
    // 200 SOL = $30K, liquidity = $100K → 30% impact
    const risk = estimateSlippageRisk(ONE_SOL * 200n, 100_000, solPrice);
    expect(risk).toBeGreaterThanOrEqual(80);
    expect(risk).toBeLessThanOrEqual(100);
  });

  it('returns 100 for zero liquidity', () => {
    expect(estimateSlippageRisk(ONE_SOL, 0, solPrice)).toBe(100);
  });

  it('returns 100 for negative liquidity', () => {
    expect(estimateSlippageRisk(ONE_SOL, -1000, solPrice)).toBe(100);
  });

  it('returns 100 for zero SOL price', () => {
    expect(estimateSlippageRisk(ONE_SOL, 100_000, 0)).toBe(100);
  });

  it('caps at 100 for enormous positions', () => {
    const risk = estimateSlippageRisk(ONE_SOL * 100_000n, 10_000, solPrice);
    expect(risk).toBeLessThanOrEqual(100);
  });

  it('returns 0 for zero position size', () => {
    const risk = estimateSlippageRisk(0n, 100_000, solPrice);
    expect(risk).toBe(0);
  });
});

// ──────────────────────────────────────────────
// validatePositionSafety (replaces checkPositionSafety)
// ──────────────────────────────────────────────

describe('validatePositionSafety', () => {
  const solPrice = 150;
  const bigPool = ONE_SOL * 10_000n;
  const goodLiquidity = 1_000_000; // $1M

  it('passes for a small, well-collateralized position', () => {
    const result = validatePositionSafety(
      ONE_SOL,       // 1 SOL user capital
      3,             // 3x leverage
      bigPool,       // huge pool
      goodLiquidity, // $1M liquidity
      solPrice,
      'bonded',
    );
    expect(result.safe).toBe(true);
    expect(result.slippageRisk).toBeDefined();
    expect(result.slippageRisk!).toBeLessThan(80);
  });

  it('fails when pool has insufficient capital', () => {
    const tinyPool = ONE_SOL; // 1 SOL pool
    const result = validatePositionSafety(
      ONE_SOL * 5n,  // 5 SOL user capital
      7,             // 7x → needs 30 SOL from pool
      tinyPool,
      goodLiquidity,
      solPrice,
      'bonded',
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('insufficient capital');
  });

  it('fails when position is too large relative to liquidity', () => {
    const thinLiquidity = 5_000; // $5K liquidity
    const result = validatePositionSafety(
      ONE_SOL * 10n, // 10 SOL at $150 = $1500
      7,             // 70 SOL total = $10500 → way over 5% of $5K
      bigPool,
      thinLiquidity,
      solPrice,
      'bonded',
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('liquidity');
  });

  it('fails when slippage risk exceeds 80', () => {
    // Position that's enormous relative to liquidity
    const result = validatePositionSafety(
      ONE_SOL * 100n,
      3,
      bigPool,
      20_000, // $20K liquidity, position = 300 SOL * $150 = $45K → >100% of liquidity
      solPrice,
      'degen',
    );
    expect(result.safe).toBe(false);
  });

  it('returns slippage risk score when safe', () => {
    const result = validatePositionSafety(
      ONE_SOL / 10n, // 0.1 SOL
      2,             // 2x
      bigPool,
      goodLiquidity,
      solPrice,
      'rising',
    );
    expect(result.safe).toBe(true);
    expect(typeof result.slippageRisk).toBe('number');
  });

  it('validates at 1x leverage (no protocol capital needed)', () => {
    const result = validatePositionSafety(
      ONE_SOL,
      1,
      0n, // empty pool — doesn't matter at 1x
      goodLiquidity,
      solPrice,
      'degen',
    );
    expect(result.safe).toBe(true);
  });
});

// ──────────────────────────────────────────────
// calculateSafeExitThreshold
// ──────────────────────────────────────────────

describe('calculateSafeExitThreshold', () => {
  it('applies safety buffer to bonded threshold', () => {
    const threshold = calculateSafeExitThreshold('bonded');
    // -1500 + 500 = -1000 bps
    expect(threshold).toBe(TIER_CONFIGS.bonded.exitThresholdBps + SAFETY_BUFFER_BPS);
    expect(threshold).toBe(-1000);
  });

  it('applies safety buffer to degen threshold', () => {
    const threshold = calculateSafeExitThreshold('degen');
    // -3000 + 500 = -2500 bps
    expect(threshold).toBe(-2500);
  });

  it('safe threshold is less negative (triggers sooner) than raw threshold', () => {
    for (const tier of ['bonded', 'rising', 'degen'] as const) {
      const safe = calculateSafeExitThreshold(tier);
      const raw = TIER_CONFIGS[tier].exitThresholdBps;
      expect(safe).toBeGreaterThan(raw);
    }
  });
});

// ──────────────────────────────────────────────
// maxSafePositionSize
// ──────────────────────────────────────────────

describe('maxSafePositionSize', () => {
  const solPrice = 150;

  it('returns larger max for bonded (5%) vs degen (2%)', () => {
    const bondedMax = maxSafePositionSize(100_000, solPrice, 'bonded');
    const degenMax = maxSafePositionSize(100_000, solPrice, 'degen');
    expect(bondedMax).toBeGreaterThan(degenMax);
  });

  it('returns 0 for zero liquidity', () => {
    expect(maxSafePositionSize(0, solPrice, 'bonded')).toBe(0n);
  });

  it('returns 0 for zero SOL price', () => {
    expect(maxSafePositionSize(100_000, 0, 'bonded')).toBe(0n);
  });

  it('scales linearly with liquidity', () => {
    const size1 = maxSafePositionSize(100_000, solPrice, 'bonded');
    const size2 = maxSafePositionSize(200_000, solPrice, 'bonded');
    // Should be roughly 2x (within BigInt floor rounding)
    expect(Number(size2)).toBeCloseTo(Number(size1) * 2, -5);
  });
});

// ──────────────────────────────────────────────
// calculateInsuranceFundTarget
// ──────────────────────────────────────────────

describe('calculateInsuranceFundTarget', () => {
  it('returns 2% of pool balance', () => {
    const pool = ONE_SOL * 1000n;
    const target = calculateInsuranceFundTarget(pool);
    // 200 bps = 2%
    expect(target).toBe((pool * 200n) / 10_000n);
    expect(target).toBe(ONE_SOL * 20n);
  });

  it('returns 0 for empty pool', () => {
    expect(calculateInsuranceFundTarget(0n)).toBe(0n);
  });
});

// ──────────────────────────────────────────────
// calculateInsuranceDeposit
// ──────────────────────────────────────────────

describe('calculateInsuranceDeposit', () => {
  it('deposits 10% of flat fee when fund is below target', () => {
    const fee = ONE_SOL;
    const currentFund = 0n;
    const target = ONE_SOL * 100n;
    const deposit = calculateInsuranceDeposit(fee, currentFund, target);
    // 10% of 1 SOL = 0.1 SOL
    expect(deposit).toBe(ONE_SOL / 10n);
  });

  it('returns 0 when fund has reached target', () => {
    const deposit = calculateInsuranceDeposit(ONE_SOL, ONE_SOL * 100n, ONE_SOL * 100n);
    expect(deposit).toBe(0n);
  });

  it('returns 0 when fund exceeds target', () => {
    const deposit = calculateInsuranceDeposit(ONE_SOL, ONE_SOL * 200n, ONE_SOL * 100n);
    expect(deposit).toBe(0n);
  });

  it('caps deposit at the remaining needed amount', () => {
    // Fund needs just 0.05 SOL more, but 10% of fee = 0.1 SOL
    const fee = ONE_SOL;
    const needed = ONE_SOL / 20n; // 0.05 SOL
    const target = ONE_SOL * 10n;
    const current = target - needed;
    const deposit = calculateInsuranceDeposit(fee, current, target);
    expect(deposit).toBe(needed);
  });
});
