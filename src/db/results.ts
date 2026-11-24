import type { Room } from '../realtime/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { computePointsDelta } from './rank.js';

type Tx = Prisma.TransactionClient;

/**
 * Writes the finished game and each real player's result exactly once
 * (room.resultPersisted guards against a repeat call), all inside one
 * transaction so a crash mid-write can never leave a partial result (a Game
 * row with only some of its GameParticipant rows) permanently in the
 * database. Bot-only seats never had a user and are skipped. Private rooms
 * still get a history row, just with a zero points delta - affectsRank is
 * what actually gates the rank math (GAME_RULES.md section 10).
 */
export async function persistGameResult(prisma: PrismaClient, room: Room): Promise<void> {
  if (room.resultPersisted) return;
  if (room.state === null || !room.state.gameOver || room.startedAt === null) return;
  room.resultPersisted = true;

  const finishOrder = room.state.finishOrder;
  const seats = room.seats;
  const { mode, affectsRank, roomId, startedAt } = room;

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
