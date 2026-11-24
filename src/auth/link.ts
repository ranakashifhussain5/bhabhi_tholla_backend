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

/** Upgrades an existing (guest) user in place with an email/password - no new row, no lost history. */
export async function linkEmailPassword(
  prisma: PrismaClient,
  userId: string,
  email: string,
  password: string,
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== userId) {
    throw new AuthError('email-already-in-use');
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { email, passwordHash } });
}

/** Lets a player who linked email/password on one device get back into the same account from another. */
export async function loginWithEmailPassword(
  prisma: PrismaClient,
  secrets: JwtSecrets,
  email: string,
  password: string,
): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError('invalid-credentials');
  }

  return issueTokenPair(user.id, secrets);
}
