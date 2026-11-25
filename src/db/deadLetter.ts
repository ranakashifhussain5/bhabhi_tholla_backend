import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FinishResult } from '../engine/index.js';
import type { RoomMode } from '../realtime/index.js';

/** Everything persistGameResult needs to write the result again later. */
export interface GameResultSnapshot {
  roomId: string;
  mode: RoomMode;
  affectsRank: boolean;
  startedAt: string;
  seats: Array<{ seat: number; playerId: string | null; quitVoluntarily: boolean }>;
  finishOrder: FinishResult[];
}

export interface DeadLetterEntry {
  failedAt: string;
  error: string;
  snapshot: GameResultSnapshot;
}

export const DEFAULT_DEAD_LETTER_PATH = 'dead-letters/game-results.jsonl';

/**
 * Last-resort log for a game result that still failed to write after every
 * retry. Appends one JSON line per failure to a local file (never the
 * database itself - that's the thing that just failed) so the result isn't
 * silently lost and can be replayed from the snapshot later.
 */
export async function writeDeadLetter(
  snapshot: GameResultSnapshot,
  error: unknown,
  filePath: string = DEFAULT_DEAD_LETTER_PATH,
): Promise<void> {
  const entry: DeadLetterEntry = {
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    snapshot,
  };
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Reads back every entry logged to a dead-letter file, in order. */
export async function readDeadLetters(filePath: string = DEFAULT_DEAD_LETTER_PATH): Promise<DeadLetterEntry[]> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return contents
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DeadLetterEntry);
}
