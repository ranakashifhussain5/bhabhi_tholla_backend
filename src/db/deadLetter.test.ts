import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameResultSnapshot } from './deadLetter.js';
import { readDeadLetters, writeDeadLetter } from './deadLetter.js';

const snapshot: GameResultSnapshot = {
  roomId: 'room-1',
  mode: 'quick-play',
  affectsRank: true,
  startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  seats: [{ seat: 0, playerId: 'user-1', quitVoluntarily: false }],
  finishOrder: [{ seat: 0, position: 1 }],
};

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bhabhi-dead-letter-unit-'));
  filePath = join(dir, 'nested', 'game-results.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeDeadLetter / readDeadLetters', () => {
  it('creates any missing parent directory and writes a readable entry', async () => {
    await writeDeadLetter(snapshot, new Error('db unreachable'), filePath);

    const entries = await readDeadLetters(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.error).toBe('db unreachable');
    expect(entries[0]?.snapshot).toEqual(snapshot);
    expect(typeof entries[0]?.failedAt).toBe('string');
  });

  it('appends multiple failures as separate lines, in order', async () => {
    await writeDeadLetter(snapshot, new Error('first failure'), filePath);
    await writeDeadLetter({ ...snapshot, roomId: 'room-2' }, new Error('second failure'), filePath);

    const entries = await readDeadLetters(filePath);
    expect(entries.map((e) => e.error)).toEqual(['first failure', 'second failure']);
    expect(entries.map((e) => e.snapshot.roomId)).toEqual(['room-1', 'room-2']);
  });

  it('returns an empty list when the file does not exist yet', async () => {
    expect(await readDeadLetters(filePath)).toEqual([]);
  });

  it('stringifies a non-Error rejection reason', async () => {
    await writeDeadLetter(snapshot, 'plain string rejection', filePath);
    const entries = await readDeadLetters(filePath);
    expect(entries[0]?.error).toBe('plain string rejection');
  });
});
