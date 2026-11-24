import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import { ChatError } from './errors.js';
import { fileReport, MAX_REPORT_MESSAGE_LENGTH } from './report.js';

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

describe('fileReport', () => {
  it('stores a report with the live roomId and no gameId yet', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await fileReport(prisma, { reporterId: alice, reportedId: bob, roomId: 'room-123', message: 'being rude' });

    const report = await prisma.report.findFirst({ where: { reporterId: alice, reportedId: bob } });
    expect(report?.roomId).toBe('room-123');
    expect(report?.gameId).toBeNull();
    expect(report?.message).toBe('being rude');
  });

  it('refuses to let a player report themselves', async () => {
    const alice = await makeUser();
    await expect(
      fileReport(prisma, { reporterId: alice, reportedId: alice, roomId: 'room-123', message: 'x' }),
    ).rejects.toThrow(ChatError);
  });

  it('rejects an empty or over-length message', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await expect(
      fileReport(prisma, { reporterId: alice, reportedId: bob, roomId: 'room-123', message: '' }),
    ).rejects.toThrow(/invalid-report-message/);

    await expect(
      fileReport(prisma, {
        reporterId: alice,
        reportedId: bob,
        roomId: 'room-123',
        message: 'a'.repeat(MAX_REPORT_MESSAGE_LENGTH + 1),
      }),
    ).rejects.toThrow(/invalid-report-message/);
  });
});
