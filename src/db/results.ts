import { setTimeout as delay } from 'node:timers/promises';
import type { Room } from '../realtime/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { GameResultSnapshot } from './deadLetter.js';
import { writeDeadLetter } from './deadLetter.js';
import { computePointsDelta } from './rank.js';

type Tx = Prisma.TransactionClient;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 200;

export interface PersistGameResultOptions {
  /** Total attempts before giving up and writing a dead letter (default 3). */
  maxAttempts?: number;
  /** Base delay between retries; attempt N waits delay * 2^(N-1) (default 200ms). Set 0 in tests. */
  retryDelayMs?: number;
  deadLetterPath?: string;
}

function buildResultSnapshot(room: Room): GameResultSnapshot {
  return {
    roomId: room.roomId,
    mode: room.mode,
    affectsRank: room.affectsRank,
    startedAt: room.startedAt!.toISOString(),
    seats: room.seats.map((s) => ({ seat: s.seat, playerId: s.playerId, quitVoluntarily: s.quitVoluntarily })),
    finishOrder: room.state!.finishOrder,
  };
}

/**
 * Writes the finished game and each real player's result exactly once
 * (room.resultPersisted guards against a repeat call - set immediately so a
 * second notify() firing while this one is still retrying bails out instead
 * of racing it). A transient DB failure is retried a few times with
 * exponential backoff; if every attempt still fails, the result is logged to
 * a dead-letter file (see deadLetter.ts) instead of being lost, and the
 * error is rethrown so the caller still finds out.
 */
export async function persistGameResult(
  prisma: PrismaClient,
  room: Room,
  options: PersistGameResultOptions = {},
): Promise<void> {
  if (room.resultPersisted) return;
  if (room.state === null || !room.state.gameOver || room.startedAt === null) return;
  room.resultPersisted = true;

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await writeGameResult(prisma, room);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await delay(retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  await writeDeadLetter(buildResultSnapshot(room), lastError, options.deadLetterPath);
  throw lastError;
}

/**
 * The actual write, all inside one transaction so a crash mid-write can
 * never leave a partial result (a Game row with only some of its
 * GameParticipant rows) permanently in the database. Bot-only seats never
 * had a user and are skipped. Private rooms still get a history row, just
 * with a zero points delta - affectsRank is what actually gates the rank
 * math (GAME_RULES.md section 10).
 */
async function writeGameResult(prisma: PrismaClient, room: Room): Promise<void> {
  const finishOrder = room.state!.finishOrder;
  const seats = room.seats;
  const startedAt = room.startedAt!;
  const { mode, affectsRank, roomId } = room;

  await prisma.$transaction(async (tx) => {
    const game = await tx.game.create({
      data: { mode, affectsRank, playerCount: seats.length, startedAt },
    });

    // Reports filed during the live game (see src/chat/report.ts) only had a
    // roomId to attach to, since this Game row didn't exist yet - link them now.
    await tx.report.updateMany({ where: { roomId, gameId: null }, data: { gameId: game.id } });

    for (const seat of seats) {
      if (seat.playerId === null) continue;

      const finish = finishOrder.find((f) => f.seat === seat.seat);
      if (!finish) continue;

      const pointsDelta = affectsRank ? computePointsDelta(finish.position, seat.quitVoluntarily) : 0;

      await tx.gameParticipant.create({
        data: {
          gameId: game.id,
          userId: seat.playerId,
          seat: seat.seat,
          position: finish.position,
          pointsDelta,
          quitVoluntarily: seat.quitVoluntarily,
        },
      });

      if (pointsDelta !== 0) {
        await applyRankDelta(tx, seat.playerId, pointsDelta);
      }
    }
  });
}

/**
 * A single atomic UPDATE instead of read-then-write: avoids a lost-update
 * race if this were ever called concurrently for the same user, and GREATEST
 * enforces "rank points cannot go below 0" (section 10) in the same statement.
 */
async function applyRankDelta(tx: Tx, userId: string, pointsDelta: number): Promise<void> {
  await tx.$executeRaw`UPDATE "User" SET "rankPoints" = GREATEST("rankPoints" + ${pointsDelta}, 0) WHERE id = ${userId}`;
}
