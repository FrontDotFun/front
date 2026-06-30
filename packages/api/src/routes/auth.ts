// ──────────────────────────────────────────────
// FRONT PROTOCOL — Auth Routes (Email/Password)
// ──────────────────────────────────────────────

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '@front-protocol/database';
import { generateBotWallet } from '@front-protocol/solana';
import { issueToken, verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, AuthError } from '../lib/errors';

const router = Router();

/**
 * Validate email format (basic check).
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /auth/register
 *
 * Create a new custodial account with email + password.
 * Generates a Solana wallet address and encrypts the private key.
 *
 * Body: { email: string, password: string }
 * Returns: { token, user: { id, email, walletAddress } }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate inputs
    const errors: string[] = [];
    if (!email) errors.push('email is required');
    if (!password) errors.push('password is required');
    if (errors.length > 0) {
      throw new ValidationError('Missing required fields', errors);
    }

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email format');
    }

    if (typeof password !== 'string' || password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationError('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate real Solana wallet
    const { publicKey: walletAddress, encryptedPrivateKey: encryptedKey } = generateBotWallet();

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        walletAddress,
        encryptedKey,
      },
    });

    // Issue JWT
    const token = issueToken(user.id, user.walletAddress);

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
      },
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /auth/login
 *
 * Authenticate with email + password.
 *
 * Body: { email: string, password: string }
 * Returns: { token, user: { id, email, walletAddress } }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError('Missing required fields', [
        ...(!email ? ['email is required'] : []),
        ...(!password ? ['password is required'] : []),
      ]);
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AuthError('Invalid email or password');
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new AuthError('Invalid email or password');
    }

    // Issue JWT
    const token = issueToken(user.id, user.walletAddress);

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /auth/me
 *
 * Return the authenticated user's profile.
 * Requires a valid JWT.
 */
router.get('/me', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AuthError('User not found');
    }

    sendSuccess(res, user);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /auth/wallet
 *
 * Return the authenticated user's wallet address and balance.
 * In dev mode, returns a mock balance.
 */
router.get('/wallet', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true },
    });

    if (!user) {
      throw new AuthError('User not found');
    }

    sendSuccess(res, {
      walletAddress: user.walletAddress,
      balanceLamports: '0',
      balanceSol: '0.000',
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
