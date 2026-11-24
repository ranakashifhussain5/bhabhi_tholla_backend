import type { PrismaClient } from '../generated/prisma/client.js';
import { ChatError } from './errors.js';

export const MAX_REPORT_MESSAGE_LENGTH = 500;

export interface FileReportOptions {
  reporterId: string;
  reportedId: string;
  roomId: string;
  message: string;
}

/**
 * Stores a report for later review. roomId is always captured immediately -
 * the Game row for a live game doesn't exist yet (it's only written when the
 * game ends), so gameId starts null and is backfilled by persistGameResult.
 */
export async function fileReport(prisma: PrismaClient, options: FileReportOptions): Promise<void> {
  if (options.reporterId === options.reportedId) throw new ChatError('cannot-report-self');
  if (options.message.length === 0 || options.message.length > MAX_REPORT_MESSAGE_LENGTH) {
    throw new ChatError('invalid-report-message');
  }

  await prisma.report.create({
    data: {
      reporterId: options.reporterId,
      reportedId: options.reportedId,
      roomId: options.roomId,
      message: options.message,
    },
  });
}
