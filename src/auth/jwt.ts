import { jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtSecrets {
  accessSecret: string;
  refreshSecret: string;
}

export async function issueTokenPair(userId: string, secrets: JwtSecrets): Promise<TokenPair> {
  const accessToken = await signToken(userId, secrets.accessSecret, ACCESS_TOKEN_TTL);
  const refreshToken = await signToken(userId, secrets.refreshSecret, REFRESH_TOKEN_TTL);
  return { accessToken, refreshToken };
}

export async function verifyToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, toKey(secret));
  return requireSub(payload);
}

/** Verifies a refresh token and rotates both tokens for the same user. */
export async function refreshTokenPair(refreshToken: string, secrets: JwtSecrets): Promise<TokenPair> {
  const userId = await verifyToken(refreshToken, secrets.refreshSecret);
  return issueTokenPair(userId, secrets);
}

async function signToken(userId: string, secret: string, ttl: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(toKey(secret));
}

function requireSub(payload: JWTPayload): string {
  if (typeof payload.sub !== 'string') {
    throw new Error('Invariant violated: token payload is missing sub');
  }
  return payload.sub;
}

function toKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
