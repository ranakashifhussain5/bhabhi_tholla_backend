import type { PrismaClient } from '../generated/prisma/client.js';
import { ChatError } from './errors.js';

/** Server-side preference keyed by user id, so it persists across reconnects and devices (GAME_RULES.md section 11). */
export async function muteUser(prisma: PrismaClient, muterId: string, mutedId: string): Promise<void> {
  if (muterId === mutedId) throw new ChatError('cannot-mute-self');

  await prisma.mute.upsert({
    where: { muterId_mutedId: { muterId, mutedId } },
    create: { muterId, mutedId },
    update: {},
  });
}

export async function unmuteUser(prisma: PrismaClient, muterId: string, mutedId: string): Promise<void> {
  await prisma.mute.deleteMany({ where: { muterId, mutedId } });
}

export async function getMutedUserIds(prisma: PrismaClient, muterId: string): Promise<Set<string>> {
  const mutes = await prisma.mute.findMany({ where: { muterId }, select: { mutedId: true } });
  return new Set(mutes.map((m) => m.mutedId));
}
