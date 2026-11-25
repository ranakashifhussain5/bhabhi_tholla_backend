import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthError } from './link.js';
import { issueTokenPair, verifyRefreshToken } from './jwt.js';
import type { JwtSecrets, TokenPair } from './jwt.js';

/**
 * Rotates a refresh token for a new pair, but only if the version embedded
 * in it still matches the user's current tokenVersion - a password change
 * (or any future "log out everywhere" action) bumps that version, so a
 * refresh token issued before the bump is rejected here even though its
 * signature and expiry are still perfectly valid.
 */
export async function refreshSession(
  prisma: PrismaClient,
  refreshToken: string,
  secrets: JwtSecrets,
): Promise<TokenPair> {
  const { userId, tokenVersion } = await verifyRefreshToken(refreshToken, secrets.refreshSecret);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tokenVersion !== tokenVersion) {
    throw new AuthError('token-revoked');
  }

  return issueTokenPair(userId, secrets, user.tokenVersion);
}
