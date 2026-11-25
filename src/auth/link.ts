import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { issueTokenPair } from './jwt.js';
import type { JwtSecrets, TokenPair } from './jwt.js';
import { hashPassword, verifyPassword } from './password.js';

export class AuthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'AuthError';
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Upgrades an existing (guest) user in place with an email/password - no new
 * row, no lost history. Setting/changing a password bumps tokenVersion,
 * which immediately invalidates every refresh token issued before this call
 * (any other signed-in device has to log in again) - the fresh pair returned
 * here is this device's replacement so it isn't logged out by its own
 * action.
 */
export async function linkEmailPassword(
  prisma: PrismaClient,
  secrets: JwtSecrets,
  userId: string,
  email: string,
  password: string,
): Promise<TokenPair> {
  const normalizedEmail = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing && existing.id !== userId) {
    throw new AuthError('email-already-in-use');
  }

  const passwordHash = await hashPassword(password);
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { email: normalizedEmail, passwordHash, tokenVersion: { increment: 1 } },
    });
    return issueTokenPair(userId, secrets, updated.tokenVersion);
  } catch (err) {
    // The findUnique check above can't see a concurrent link racing it to
    // the same email; the DB's unique constraint is the real guard, so
    // translate its violation into the same clean error as the check.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AuthError('email-already-in-use');
    }
    throw err;
  }
}

/** Lets a player who linked email/password on one device get back into the same account from another. */
export async function loginWithEmailPassword(
  prisma: PrismaClient,
  secrets: JwtSecrets,
  email: string,
  password: string,
): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError('invalid-credentials');
  }

  return issueTokenPair(user.id, secrets, user.tokenVersion);
}
