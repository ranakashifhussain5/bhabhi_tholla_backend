import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickPlayMatchmaker } from './matchmaking.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('QuickPlayMatchmaker', () => {
  it('starts a room as soon as enough real players join', () => {
    const startRoom = vi.fn();
    const matchmaker = new QuickPlayMatchmaker(startRoom, { seatsNeeded: 4, waitMs: 30_000 });

    matchmaker.join('a', 'sa');
    matchmaker.join('b', 'sb');
    matchmaker.join('c', 'sc');
    expect(startRoom).not.toHaveBeenCalled();

    matchmaker.join('d', 'sd');

    expect(startRoom).toHaveBeenCalledTimes(1);
    expect(startRoom).toHaveBeenCalledWith([
      { playerId: 'a', socketId: 'sa' },
      { playerId: 'b', socketId: 'sb' },
      { playerId: 'c', socketId: 'sc' },
      { playerId: 'd', socketId: 'sd' },
    ]);
    expect(matchmaker.queueLength()).toBe(0);
  });

  it('bot-fills remaining seats after the wait timeout', () => {
    const startRoom = vi.fn();
    const matchmaker = new QuickPlayMatchmaker(startRoom, { seatsNeeded: 4, waitMs: 30_000 });

    matchmaker.join('a', 'sa');
    matchmaker.join('b', 'sb');

    vi.advanceTimersByTime(29_999);
    expect(startRoom).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(startRoom).toHaveBeenCalledTimes(1);
    expect(startRoom).toHaveBeenCalledWith([
      { playerId: 'a', socketId: 'sa' },
      { playerId: 'b', socketId: 'sb' },
      null,
      null,
    ]);
  });

  it('does nothing on timeout if the queue emptied out via a full table first', () => {
    const startRoom = vi.fn();
    const matchmaker = new QuickPlayMatchmaker(startRoom, { seatsNeeded: 2, waitMs: 1000 });

    matchmaker.join('a', 'sa');
    matchmaker.join('b', 'sb');
    expect(startRoom).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(startRoom).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh wait window for the next table after one fills', () => {
    const startRoom = vi.fn();
    const matchmaker = new QuickPlayMatchmaker(startRoom, { seatsNeeded: 2, waitMs: 1000 });

    matchmaker.join('a', 'sa');
    matchmaker.join('b', 'sb');
    expect(startRoom).toHaveBeenCalledTimes(1);

    matchmaker.join('c', 'sc');
    vi.advanceTimersByTime(1000);

    expect(startRoom).toHaveBeenCalledTimes(2);
    expect(startRoom).toHaveBeenLastCalledWith([{ playerId: 'c', socketId: 'sc' }, null]);
  });
});
