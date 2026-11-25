import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine/index.js';
import type { Room, SeatBinding } from '../realtime/index.js';
import { prisma } from './client.js';
import { readDeadLetters } from './deadLetter.js';
import { persistGameResult } from './results.js';
import { resetDb } from './testHelpers.js';

function makeFinishedRoom(options: {
  affectsRank: boolean;
  userIds: string[];
  finishOrder: Array<{ seat: number; position: number }>;
  quitSeats?: number[];
}): Room {
  const playerCount = options.userIds.length;
  const quitSeats = new Set(options.quitSeats ?? []);

  const state: GameState = {
    playerCount,
    players: options.userIds.map((_, seat) => ({ seat, hand: [] })),
    escaped: new Array<boolean>(playerCount).fill(true),
    finishOrder: options.finishOrder,
    gameOver: true,
    round: null,
  };

  const seats: SeatBinding[] = options.userIds.map((playerId, seat) => ({
    seat,
    playerId,
    isBot: quitSeats.has(seat),
    connected: !quitSeats.has(seat),
    socketId: null,
    quitVoluntarily: quitSeats.has(seat),
  }));

  return {
    roomId: `test-room-${seats.map((s) => s.playerId).join('-')}-${Math.random()}`,
    mode: options.affectsRank ? 'quick-play' : 'private',
    affectsRank: options.affectsRank,
    roomCode: null,
    hostPlayerId: null,
    pendingPlayerIds: [],
    seats,
    state,
    knowledge: null,
    startedAt: new Date(),
    resultPersisted: false,
  };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('persistGameResult', () => {
  it('records the game and applies section 10 rank math for every position, plus a quit case', async () => {
    const users = await Promise.all(Array.from({ length: 4 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);

    // Seat 3 finishes 4th (Bhabhi) but quit voluntarily, so the quit penalty
    // applies instead of the normal 4th-place score.
    const room = makeFinishedRoom({
      affectsRank: true,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
        { seat: 2, position: 3 },
        { seat: 3, position: 4 },
      ],
      quitSeats: [3],
    });

    await persistGameResult(prisma, room);

    const game = await prisma.game.findFirst({ where: { mode: 'quick-play' } });
    expect(game).not.toBeNull();
    expect(game?.affectsRank).toBe(true);
    expect(game?.playerCount).toBe(4);

    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: game!.id },
      orderBy: { seat: 'asc' },
    });
    expect(participants.map((p) => p.pointsDelta)).toEqual([30, 15, 5, -40]);
    expect(participants[3]?.quitVoluntarily).toBe(true);

    const updatedUsers = await Promise.all(userIds.map((id) => prisma.user.findUnique({ where: { id } })));
    // Seat 3 would be 0 - 40 = -40, clamped to 0 (rank points cannot go below 0).
    expect(updatedUsers.map((u) => u?.rankPoints)).toEqual([30, 15, 5, 0]);
  });

  it('records history for a private room without changing anyone\'s rank points', async () => {
    const users = await Promise.all(Array.from({ length: 3 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);

    const room = makeFinishedRoom({
      affectsRank: false,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
        { seat: 2, position: 3 },
      ],
    });

    await persistGameResult(prisma, room);

    const game = await prisma.game.findFirst({ where: { mode: 'private' } });
    expect(game?.affectsRank).toBe(false);

    const participants = await prisma.gameParticipant.findMany({ where: { gameId: game!.id } });
    expect(participants.every((p) => p.pointsDelta === 0)).toBe(true);

    const updatedUsers = await Promise.all(userIds.map((id) => prisma.user.findUnique({ where: { id } })));
    expect(updatedUsers.every((u) => u?.rankPoints === 0)).toBe(true);
  });

  it('is idempotent - a repeat call does not double-write the result', async () => {
    const users = await Promise.all(Array.from({ length: 4 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);
    const room = makeFinishedRoom({
      affectsRank: true,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
        { seat: 2, position: 3 },
        { seat: 3, position: 4 },
      ],
    });

    await persistGameResult(prisma, room);
    await persistGameResult(prisma, room);

    expect(await prisma.game.count()).toBe(1);
  });

  it('skips seats with no linked player (bot-filled seats)', async () => {
    const users = await Promise.all(Array.from({ length: 2 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);
    const room = makeFinishedRoom({
      affectsRank: true,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
      ],
    });
    room.seats[1]!.playerId = null;

    await persistGameResult(prisma, room);

    const game = await prisma.game.findFirst();
    const participants = await prisma.gameParticipant.findMany({ where: { gameId: game!.id } });
    expect(participants).toHaveLength(1);
    expect(participants[0]?.seat).toBe(0);
  });

  it('backfills gameId on reports filed during the live game, by roomId', async () => {
    const users = await Promise.all(Array.from({ length: 2 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);
    const room = makeFinishedRoom({
      affectsRank: false,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
      ],
    });

    await prisma.report.create({
      data: { reporterId: userIds[0]!, reportedId: userIds[1]!, roomId: room.roomId, message: 'rude chat' },
    });

    await persistGameResult(prisma, room);

    const game = await prisma.game.findFirst({ where: { mode: 'private' } });
    const report = await prisma.report.findFirst({ where: { roomId: room.roomId } });
    expect(report?.gameId).toBe(game?.id);
  });

  it('retries a transient DB failure (with backoff) and still saves the result', async () => {
    const users = await Promise.all(Array.from({ length: 2 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);
    const room = makeFinishedRoom({
      affectsRank: true,
      userIds,
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
      ],
    });

    const transactionSpy = vi.spyOn(prisma, '$transaction');
    transactionSpy.mockRejectedValueOnce(new Error('connection reset'));
    transactionSpy.mockRejectedValueOnce(new Error('connection reset'));

    try {
      await persistGameResult(prisma, room, { retryDelayMs: 0 });

      expect(transactionSpy).toHaveBeenCalledTimes(3);
      expect(await prisma.game.count()).toBe(1);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('logs a dead letter and preserves the result data when every retry is exhausted', async () => {
    const users = await Promise.all(Array.from({ length: 3 }, () => prisma.user.create({ data: {} })));
    const userIds = users.map((u) => u.id);
    const finishOrder = [
      { seat: 0, position: 1 },
      { seat: 1, position: 2 },
      { seat: 2, position: 3 },
    ];
    const room = makeFinishedRoom({ affectsRank: true, userIds, finishOrder });

    const transactionSpy = vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('connection refused'));
    const deadLetterDir = await mkdtemp(join(tmpdir(), 'bhabhi-dead-letter-'));
    const deadLetterPath = join(deadLetterDir, 'game-results.jsonl');

    try {
      await expect(persistGameResult(prisma, room, { retryDelayMs: 0, deadLetterPath })).rejects.toThrow(
        'connection refused',
      );

      // Exactly the default 3 attempts, and nothing landed in the database -
      // the point of the dead letter is that the result survives anyway.
      expect(transactionSpy).toHaveBeenCalledTimes(3);
      expect(await prisma.game.count()).toBe(0);

      const entries = await readDeadLetters(deadLetterPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.error).toBe('connection refused');
      expect(entries[0]?.snapshot.roomId).toBe(room.roomId);
      expect(entries[0]?.snapshot.finishOrder).toEqual(finishOrder);
      expect(entries[0]?.snapshot.seats.map((s) => s.playerId)).toEqual(userIds);
    } finally {
      transactionSpy.mockRestore();
      await rm(deadLetterDir, { recursive: true, force: true });
    }
  });
});
