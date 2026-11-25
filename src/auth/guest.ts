import type { PrismaClient } from '../generated/prisma/client.js';
import { issueTokenPair } from './jwt.js';
import type { JwtSecrets, TokenPair } from './jwt.js';

export interface GuestSession {
  userId: string;
  tokens: TokenPair;
}

/** First contact: a brand new guest identity, no email/password required to start playing. */
export async function createGuestSession(
  prisma: PrismaClient,
  secrets: JwtSecrets,
): Promise<GuestSession> {
  const user = await prisma.user.create({ data: {} });
  const tokens = await issueTokenPair(user.id, secrets, user.tokenVersion);
  return { userId: user.id, tokens };
}
