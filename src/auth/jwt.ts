import { jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

export type TokenType = 'access' | 'refresh';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtSecrets {
  accessSecret: string;
  refreshSecret: string;
}

export async function issueTokenPair(userId: string, secrets: JwtSecrets): Promise<TokenPair> {
  const accessToken = await signToken(userId, secrets.accessSecret, ACCESS_TOKEN_TTL, 'access');
  const refreshToken = await signToken(userId, secrets.refreshSecret, REFRESH_TOKEN_TTL, 'refresh');
  return { accessToken, refreshToken };
}

export async function verifyToken(token: string, secret: string, expectedType: TokenType): Promise<string> {
  const { payload } = await jwtVerify(token, toKey(secret));
  if (payload.typ !== expectedType) {
    throw new Error(`Invalid token type: expected "${expectedType}"`);
  }
  return requireSub(payload);
}

/** Verifies a refresh token and rotates both tokens for the same user. */
export async function refreshTokenPair(refreshToken: string, secrets: JwtSecrets): Promise<TokenPair> {
  const userId = await verifyToken(refreshToken, secrets.refreshSecret, 'refresh');
  return issueTokenPair(userId, secrets);
}

async function signToken(userId: string, secret: string, ttl: string, typ: TokenType): Promise<string> {
  return new SignJWT({ sub: userId, typ })
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
