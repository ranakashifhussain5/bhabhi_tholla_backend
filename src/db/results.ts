import type { Room } from '../realtime/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { clampRankPoints, computePointsDelta } from './rank.js';

/**
 * Writes the finished game and each real player's result exactly once
 * (room.resultPersisted guards against a repeat call). Bot-only seats never
 * had a user and are skipped. Private rooms still get a history row, just
 * with a zero points delta - affectsRank is what actually gates the rank
 * math (GAME_RULES.md section 10).
 */
export async function persistGameResult(prisma: PrismaClient, room: Room): Promise<void> {
  if (room.resultPersisted) return;
  if (room.state === null || !room.state.gameOver || room.startedAt === null) return;
  room.resultPersisted = true;

  const game = await prisma.game.create({
    data: {
      mode: room.mode,
      affectsRank: room.affectsRank,
      playerCount: room.seats.length,
      startedAt: room.startedAt,
    },
  });

  for (const seat of room.seats) {
    if (seat.playerId === null) continue;

    const finish = room.state.finishOrder.find((f) => f.seat === seat.seat);
    if (!finish) continue;

    const pointsDelta = room.affectsRank ? computePointsDelta(finish.position, seat.quitVoluntarily) : 0;

    await prisma.gameParticipant.create({
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
      await applyRankDelta(prisma, seat.playerId, pointsDelta);
    }
  }
}

async function applyRankDelta(prisma: PrismaClient, userId: string, pointsDelta: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await prisma.user.update({
    where: { id: userId },
    data: { rankPoints: clampRankPoints(user.rankPoints + pointsDelta) },
  });
}
