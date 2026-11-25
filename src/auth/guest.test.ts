import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import { createGuestSession } from './guest.js';
import { verifyToken } from './jwt.js';

const secrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('createGuestSession', () => {
  it('creates a new user with zero rank points and a working token pair', async () => {
    const session = await createGuestSession(prisma, secrets);

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    expect(user).not.toBeNull();
    expect(user?.rankPoints).toBe(0);
    expect(user?.email).toBeNull();

    expect(await verifyToken(session.tokens.accessToken, secrets.accessSecret, 'access')).toBe(session.userId);
    expect(await verifyToken(session.tokens.refreshToken, secrets.refreshSecret, 'refresh')).toBe(session.userId);
  });

  it('creates a distinct user on each call', async () => {
    const a = await createGuestSession(prisma, secrets);
    const b = await createGuestSession(prisma, secrets);
    expect(a.userId).not.toBe(b.userId);
  });
});
