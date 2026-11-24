import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import { ChatError } from './errors.js';
import { getMutedUserIds, muteUser, unmuteUser } from './mute.js';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({ data: {} });
  return user.id;
}

describe('muteUser / unmuteUser / getMutedUserIds', () => {
  it('mutes a player and reports them in the muter\'s muted set', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await muteUser(prisma, alice, bob);

    expect(await getMutedUserIds(prisma, alice)).toEqual(new Set([bob]));
    // Muting is one-directional: bob did not mute alice.
    expect(await getMutedUserIds(prisma, bob)).toEqual(new Set());
  });

  it('is idempotent - muting the same player twice does not error or duplicate', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await muteUser(prisma, alice, bob);
    await muteUser(prisma, alice, bob);

    expect(await getMutedUserIds(prisma, alice)).toEqual(new Set([bob]));
  });

  it('refuses to let a player mute themselves', async () => {
    const alice = await makeUser();
    await expect(muteUser(prisma, alice, alice)).rejects.toThrow(ChatError);
  });

  it('unmute removes a player from the muted set', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await muteUser(prisma, alice, bob);
    await unmuteUser(prisma, alice, bob);

    expect(await getMutedUserIds(prisma, alice)).toEqual(new Set());
  });

  it('persists across what would be a reconnect (a fresh lookup by user id)', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await muteUser(prisma, alice, bob);

    // Simulate a fresh connection/session: a brand new lookup, no in-memory state carried over.
    const mutedAfterReconnect = await getMutedUserIds(prisma, alice);
    expect(mutedAfterReconnect.has(bob)).toBe(true);
  });
});
