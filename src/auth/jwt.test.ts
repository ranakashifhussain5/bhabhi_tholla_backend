import { describe, expect, it } from 'vitest';
import { issueTokenPair, verifyToken } from './jwt.js';

const secrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

describe('issueTokenPair / verifyToken', () => {
  it('issues tokens that verify back to the same user id', async () => {
    const { accessToken, refreshToken } = await issueTokenPair('user-1', secrets);

    expect(await verifyToken(accessToken, secrets.accessSecret, 'access')).toBe('user-1');
    expect(await verifyToken(refreshToken, secrets.refreshSecret, 'refresh')).toBe('user-1');
  });

  it('rejects an access token verified against the refresh secret', async () => {
    const { accessToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(accessToken, secrets.refreshSecret, 'access')).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const { accessToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(`${accessToken}x`, secrets.accessSecret, 'access')).rejects.toThrow();
  });

  it('rejects a refresh token verified as an access token, even with the correct secret', async () => {
    const { refreshToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(refreshToken, secrets.refreshSecret, 'access')).rejects.toThrow(
      /Invalid token type/,
    );
  });

  it('rejects an access token verified as a refresh token, even with the correct secret', async () => {
    const { accessToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(accessToken, secrets.accessSecret, 'refresh')).rejects.toThrow(
      /Invalid token type/,
    );
  });
});
