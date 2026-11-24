import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import { createGuestSession } from './guest.js';
import { AuthError, linkEmailPassword, loginWithEmailPassword } from './link.js';

const secrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('linkEmailPassword', () => {
  it('upgrades the same user row in place, preserving history (e.g. rank points)', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await prisma.user.update({ where: { id: guest.userId }, data: { rankPoints: 120 } });

    await linkEmailPassword(prisma, guest.userId, 'player@example.com', 'hunter2hunter2');

    const user = await prisma.user.findUnique({ where: { id: guest.userId } });
    expect(user?.id).toBe(guest.userId);
    expect(user?.email).toBe('player@example.com');
    expect(user?.rankPoints).toBe(120);
    expect(user?.passwordHash).not.toBeNull();
  });

  it('refuses to link an email already used by a different account', async () => {
    const first = await createGuestSession(prisma, secrets);
    const second = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, first.userId, 'taken@example.com', 'password123');

    await expect(linkEmailPassword(prisma, second.userId, 'taken@example.com', 'other-pass')).rejects.toThrow(
      AuthError,
    );
  });

  it('is idempotent for re-linking the same email to the same account', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, guest.userId, 'same@example.com', 'password123');
    await expect(linkEmailPassword(prisma, guest.userId, 'same@example.com', 'new-password')).resolves.not.toThrow();
  });

  it('cleanly rejects a concurrent race to link the same email to two different accounts', async () => {
    const first = await createGuestSession(prisma, secrets);
    const second = await createGuestSession(prisma, secrets);

    // Both calls pass the findUnique check before either one's update
    // commits - the DB's unique constraint, not the check, is what must
    // stop the loser, and it must surface as the same clean AuthError.
    const results = await Promise.allSettled([
      linkEmailPassword(prisma, first.userId, 'race@example.com', 'password123'),
      linkEmailPassword(prisma, second.userId, 'race@example.com', 'password123'),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AuthError);
  });

  it('normalizes email case, so differently-cased emails cannot collide or diverge', async () => {
    const first = await createGuestSession(prisma, secrets);
    const second = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, first.userId, 'Mixed@Example.com', 'password123');

    const user = await prisma.user.findUnique({ where: { id: first.userId } });
    expect(user?.email).toBe('mixed@example.com');

    await expect(linkEmailPassword(prisma, second.userId, 'mixed@example.com', 'other-pass')).rejects.toThrow(
      AuthError,
    );
  });
});

describe('loginWithEmailPassword', () => {
  it('issues tokens for the correct email/password', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, guest.userId, 'login@example.com', 'correct-password');

    const tokens = await loginWithEmailPassword(prisma, secrets, 'login@example.com', 'correct-password');
    expect(tokens.accessToken).toBeTruthy();
  });

  it('rejects an incorrect password', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, guest.userId, 'login2@example.com', 'correct-password');

    await expect(loginWithEmailPassword(prisma, secrets, 'login2@example.com', 'wrong')).rejects.toThrow(AuthError);
  });

  it('rejects an email with no linked account', async () => {
    await expect(loginWithEmailPassword(prisma, secrets, 'nobody@example.com', 'anything')).rejects.toThrow(
      AuthError,
    );
  });

  it('logs in with a differently-cased email than was used to link', async () => {
    const guest = await createGuestSession(prisma, secrets);
    await linkEmailPassword(prisma, guest.userId, 'CaseTest@Example.com', 'correct-password');

    const tokens = await loginWithEmailPassword(prisma, secrets, 'casetest@example.com', 'correct-password');
    expect(tokens.accessToken).toBeTruthy();
  });
});
