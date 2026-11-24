import { describe, expect, it } from 'vitest';
import { issueTokenPair, verifyToken } from './jwt.js';

const secrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

describe('issueTokenPair / verifyToken', () => {
  it('issues tokens that verify back to the same user id', async () => {
    const { accessToken, refreshToken } = await issueTokenPair('user-1', secrets);

    expect(await verifyToken(accessToken, secrets.accessSecret)).toBe('user-1');
    expect(await verifyToken(refreshToken, secrets.refreshSecret)).toBe('user-1');
  });

  it('rejects an access token verified against the refresh secret', async () => {
    const { accessToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(accessToken, secrets.refreshSecret)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const { accessToken } = await issueTokenPair('user-1', secrets);
    await expect(verifyToken(`${accessToken}x`, secrets.accessSecret)).rejects.toThrow();
  });
});
