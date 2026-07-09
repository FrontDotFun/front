// ──────────────────────────────────────────────
// FRONT PROTOCOL — Wallet Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import {
  getEthBalance,
  loadCustodialWallet,
  transferEth,
} from '@front-protocol/evm';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';

const router = Router();

// Base58 character set for address validation
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * GET /wallet/balance
 *
 * Returns the authenticated user's custodial wallet ETH balance.
 */
router.get('/balance', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const balanceLamports = await getEthBalance(walletAddress);
    const balanceSol = (Number(balanceLamports) / 1e18).toFixed(9);

    sendSuccess(res, {
      address: walletAddress,
      balanceLamports: balanceLamports.toString(),
      balanceSol,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /wallet/withdraw
 *
 * Withdraw ETH from the user's custodial wallet to an external address.
 * Requires JWT auth. Validates destination, amount, and sufficient balance
 * (keeping a 0.005 ETH reserve for transaction fees).
 */
router.post('/withdraw', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const { destinationAddress, amountLamports } = req.body;

    // ── Validate required fields ──
    if (!destinationAddress || amountLamports === undefined) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(amountLamports === undefined ? ['amountLamports is required'] : []),
      ]);
    }

    // ── Validate destination address format ──
    if (
      typeof destinationAddress !== 'string' ||
      !BASE58_REGEX.test(destinationAddress)
    ) {
      throw new ValidationError('Invalid destination address — must be 32-44 base58 characters');
    }

    // ── Validate amount ──
    let amount: bigint;
    try {
      amount = BigInt(amountLamports);
    } catch {
      throw new ValidationError('Invalid amount — must be a numeric string');
    }
    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // ── Check balance (keep a small gas reserve — L2 gas is cheap but not free) ──
    const TX_FEE_RESERVE = 50_000_000_000_000n; // 0.00005 ETH
    const currentBalance = await getEthBalance(walletAddress);

    if (currentBalance < amount + TX_FEE_RESERVE) {
      throw new InsufficientFundsError(
        `Not enough ETH to withdraw. Your balance is ${(Number(currentBalance) / 1e18).toFixed(4)} ETH ` +
        `but you need ${(Number(amount) / 1e18).toFixed(4)} ETH plus a small fee reserve. ` +
        `Deposit more ETH or reduce the withdrawal amount.`,
      );
    }

    // ── Load user's custodial wallet keypair ──
    const user = await prisma.user.findFirst({
      where: { walletAddress },
      select: { encryptedKey: true },
    });
    if (!user) {
      throw new NotFoundError('User wallet');
    }

    const userAccount = loadCustodialWallet(user.encryptedKey);

    // ── Execute transfer ──
    const txSignature = await transferEth(userAccount, destinationAddress, amount);

    sendSuccess(res, {
      txSignature,
      amountLamports: amount.toString(),
      destination: destinationAddress,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
