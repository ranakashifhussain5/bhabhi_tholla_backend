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

export interface RefreshTokenPayload {
  userId: string;
  tokenVersion: number;
}

/**
 * The refresh token carries the account's tokenVersion at issuance (the
 * access token does not - it's short-lived enough that a stale one is a
 * non-issue). A caller with database access compares this against the
 * user's current version to reject tokens issued before a security event
 * like a password change.
 */
export async function issueTokenPair(userId: string, secrets: JwtSecrets, tokenVersion: number): Promise<TokenPair> {
  const accessToken = await signToken(userId, secrets.accessSecret, ACCESS_TOKEN_TTL, 'access');
  const refreshToken = await signToken(userId, secrets.refreshSecret, REFRESH_TOKEN_TTL, 'refresh', {
    ver: tokenVersion,
  });
  return { accessToken, refreshToken };
}

export async function verifyToken(token: string, secret: string, expectedType: TokenType): Promise<string> {
  const { payload } = await jwtVerify(token, toKey(secret));
  if (payload.typ !== expectedType) {
    throw new Error(`Invalid token type: expected "${expectedType}"`);
  }
  return requireSub(payload);
}

/** Verifies a refresh token's signature/type/expiry and returns its claims - the caller is responsible for checking tokenVersion against the database. */
export async function verifyRefreshToken(token: string, secret: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, toKey(secret));
  if (payload.typ !== 'refresh') {
    throw new Error('Invalid token type: expected "refresh"');
  }
  if (typeof payload.ver !== 'number') {
    throw new Error('Invariant violated: refresh token payload is missing ver');
  }
  return { userId: requireSub(payload), tokenVersion: payload.ver };
}

async function signToken(
  userId: string,
  secret: string,
  ttl: string,
  typ: TokenType,
  extraClaims: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({ sub: userId, typ, ...extraClaims })
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
