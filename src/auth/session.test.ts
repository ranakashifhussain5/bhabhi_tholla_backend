import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import { createGuestSession } from './guest.js';
import { AuthError, linkEmailPassword } from './link.js';
import { refreshSession } from './session.js';

const secrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('refreshSession', () => {
  it('rotates a valid, up-to-date refresh token for a fresh pair', async () => {
    const guest = await createGuestSession(prisma, secrets);
    const tokens = await refreshSession(prisma, guest.tokens.refreshToken, secrets);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('rejects a refresh token whose version predates a password change', async () => {
    const guest = await createGuestSession(prisma, secrets);
    const staleRefreshToken = guest.tokens.refreshToken;

    // Changing the password bumps tokenVersion - the token issued above was
    // minted under the old version and must stop working, even though its
    // signature and expiry are both still perfectly valid.
    await linkEmailPassword(prisma, secrets, guest.userId, 'changed@example.com', 'new-password');

    await expect(refreshSession(prisma, staleRefreshToken, secrets)).rejects.toThrow(AuthError);
  });

  it('lets the device that just changed the password keep using its fresh tokens', async () => {
    const guest = await createGuestSession(prisma, secrets);
    const freshTokens = await linkEmailPassword(prisma, secrets, guest.userId, 'kept@example.com', 'new-password');

    const rotated = await refreshSession(prisma, freshTokens.refreshToken, secrets);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).toBeTruthy();
  });

  it('rejects a well-formed refresh token for a user that no longer exists', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await prisma.user.delete({ where: { id: guest.userId } });

    await expect(refreshSession(prisma, guest.tokens.refreshToken, secrets)).rejects.toThrow(AuthError);
  });

  it('rejects a garbage token', async () => {
    await expect(refreshSession(prisma, 'not-a-real-token', secrets)).rejects.toThrow();
  });
});
