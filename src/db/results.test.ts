import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../engine/index.js';
import type { Room, SeatBinding } from '../realtime/index.js';
import { prisma } from './client.js';
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
});
