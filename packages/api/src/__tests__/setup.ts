// ──────────────────────────────────────────────
// FRONT PROTOCOL — Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @pump-fun/pump-sdk (before route imports) ────
vi.mock('@pump-fun/pump-sdk', () => ({
  feeSharingConfigPda: vi.fn(() => 'mock-pda'),
  PumpSdk: vi.fn(() => ({
    decodeSharingConfig: vi.fn(() => ({ shareholders: [] })),
  })),
}));

// ─── Mock @front-protocol/database (Prisma) ────
vi.mock('@front-protocol/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    position: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    token: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    burn: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    lock: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $disconnect: vi.fn(),
    $connect: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// ─── Mock @front-protocol/evm ──────────────
vi.mock('@front-protocol/evm', () => ({
  robinhoodChain: { id: 4663 },
  CONTRACTS: {
    WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    UNIV3_FACTORY: '0x1f7D7550B1B028f7571e69A784071F0205fd2EfA',
    SWAP_ROUTER_02: '0xCaf681a66D020601342297493863E78C959E5cb2',
  },
  NOXA_FEE_TIER: 10_000,
  explorerTxUrl: vi.fn((h: string) => `https://robinhoodchain.blockscout.com/tx/${h}`),
  explorerAddressUrl: vi.fn((a: string) => `https://robinhoodchain.blockscout.com/address/${a}`),
  getPublicClient: vi.fn(() => ({})),
  generateCustodialWallet: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111',
    encryptedPrivateKey: 'iv:tag:cipher',
  })),
  loadCustodialWallet: vi.fn(() => ({ address: '0x1111111111111111111111111111111111111111' })),
  getProtocolAccount: vi.fn(() => ({ address: '0x2222222222222222222222222222222222222222' })),
  hasEvmProtocolKey: vi.fn(() => false),
  getEthBalance: vi.fn(() => Promise.resolve(0n)),
  transferEth: vi.fn(() => Promise.resolve('0xmock-tx')),
  erc20Balance: vi.fn(() => Promise.resolve(0n)),
  erc20Decimals: vi.fn(() => Promise.resolve(18)),
  erc20TotalSupply: vi.fn(() => Promise.resolve(0n)),
  swapEthForToken: vi.fn(() => Promise.resolve({ txHash: '0xmock-tx', amountOut: 0n })),
  swapTokenForEth: vi.fn(() => Promise.resolve({ txHash: '0xmock-tx', amountOut: 0n })),
  encryptPrivateKey: vi.fn(() => 'iv:tag:cipher'),
  decryptPrivateKey: vi.fn(() => '0x' + '11'.repeat(32)),
}));

// ─── Mock @front-protocol/services ─────────────
vi.mock('@front-protocol/services', () => ({
  default: {},
}));

// ─── Mock @front-protocol/core ──────────────────
vi.mock('@front-protocol/core', () => ({
  LAMPORTS_PER_SOL: BigInt(1_000_000_000),
  getTierConfig: vi.fn(() => ({
    name: 'Bronze',
    minBurned: 0,
    feePercent: 1,
    leverageCap: 10,
  })),
  validatePositionOpen: vi.fn(() => ({ valid: true })),
  validatePositionSafety: vi.fn(() => ({ safe: true })),
  generatePositionPreview: vi.fn(() => ({})),
  calculateProtocolCapital: vi.fn(() => BigInt(0)),
  calculatePositionSize: vi.fn(() => BigInt(0)),
  calculateFlatFee: vi.fn(() => BigInt(0)),
  getExitThresholdPercent: vi.fn(() => 5),
}));

import { createApp } from '../app';
import supertest from 'supertest';
import type { Express } from 'express';

/**
 * Create a fresh Express app instance wired up with all routes and middleware,
 * without starting the HTTP server.
 *
 * Returns both the Express app and a supertest agent.
 */
export function createTestApp() {
  const app: Express = createApp();
  const agent = supertest(app);
  return { app, agent };
}
