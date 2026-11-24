import { prisma } from './client.js';

export async function resetDb(): Promise<void> {
  await prisma.gameParticipant.deleteMany();
  await prisma.report.deleteMany();
  await prisma.mute.deleteMany();
  await prisma.game.deleteMany();
  await prisma.user.deleteMany();
}
