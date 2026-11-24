import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card } from '../engine/testHelpers.js';
import { IllegalMoveError } from '../engine/index.js';
import {
  advance,
  applyHumanMove,
  handleDisconnect,
  handleQuit,
  reclaimSeat,
} from './gameplay.js';
import { makeTestRoom } from './testHelpers.js';
import { TurnTimerManager } from './turnTimer.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyHumanMove', () => {
  it('applies the move, notifies, and starts a timer for the next human seat', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    applyHumanMove(room, timers, 0, card('H', 4), notify);

    expect(room.state!.players[0]!.hand).toEqual([card('H', 9)]);
    expect(notify).toHaveBeenCalledWith(room);
    expect(timers.isRunning('test-room')).toBe(true);
  });

  it('throws IllegalMoveError and leaves the room untouched for an invalid move', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    expect(() => applyHumanMove(room, timers, 0, card('D', 7), notify)).toThrow(IllegalMoveError);
    expect(notify).not.toHaveBeenCalled();
    expect(room.state!.players[0]!.hand).toHaveLength(2);
  });

  it('cascades through a bot seat automatically before starting the next human timer', () => {
    const room = makeTestRoom({
      hands: [
        [card('H', 4), card('H', 9)],
        [card('H', 2)],
        [card('H', 5), card('D', 3)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', null, 'carol'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    applyHumanMove(room, timers, 0, card('H', 4), notify);

    // Seat 1 (bot) is forced to follow with its only card.
    expect(room.state!.players[1]!.hand).toEqual([]);
    expect(room.state!.round!.plays).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(timers.isRunning('test-room')).toBe(true);
  });
});

describe('turn timeout', () => {
  it('plays on the human seat\'s behalf when their timer expires, and can end the game', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    applyHumanMove(room, timers, 0, card('H', 4), notify);
    expect(timers.isRunning('test-room')).toBe(true);

    vi.advanceTimersByTime(15_000);

    // Seat 1's only card (H2) was forced; the round discards (no thulla),
    // seat 1 escapes, and seat 0 - the only one left - is auto-finished as Bhabhi.
    expect(room.state!.gameOver).toBe(true);
    expect(room.state!.finishOrder).toHaveLength(2);
    expect(timers.isRunning('test-room')).toBe(false);
  });
});

describe('advance', () => {
  it('resolves leading bot turns immediately, then starts a timer for the first human seat', () => {
    const room = makeTestRoom({
      hands: [[card('S', 14)], [card('H', 5), card('D', 6)]],
      round: { phase: 'first-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: [null, 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    advance(room, timers, notify);

    expect(room.state!.players[0]!.hand).toEqual([]);
    expect(room.state!.round!.plays).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(timers.isRunning('test-room')).toBe(true);
  });
});

describe('handleDisconnect', () => {
  it('takes over immediately if it was the disconnecting seat\'s turn', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    applyHumanMove(room, timers, 0, card('H', 4), notify);
    handleDisconnect(room, timers, 'bob', notify);

    expect(room.seats[1]).toMatchObject({ isBot: true, connected: false, socketId: null });
    expect(room.state!.gameOver).toBe(true);
  });

  it('only flips the seat flag if it is not currently their turn', () => {
    const room = makeTestRoom({
      hands: [
        [card('H', 4), card('H', 9)],
        [card('H', 2)],
        [card('H', 5), card('D', 3)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob', 'carol'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    handleDisconnect(room, timers, 'bob', notify);

    expect(room.seats[1]).toMatchObject({ isBot: true, connected: false });
    expect(notify).not.toHaveBeenCalled();
    expect(timers.isRunning('test-room')).toBe(false);
  });
});

describe('reclaimSeat', () => {
  it('restores a disconnected seat to human control', () => {
    const room = makeTestRoom({
      hands: [
        [card('H', 4), card('H', 9)],
        [card('H', 2)],
        [card('H', 5), card('D', 3)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob', 'carol'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    handleDisconnect(room, timers, 'bob', notify);
    const reclaimed = reclaimSeat(room, 'bob', 'bob-new-socket');

    expect(reclaimed).toMatchObject({ seat: 1, isBot: false, connected: true, socketId: 'bob-new-socket' });
  });

  it('refuses to reclaim after a deliberate quit', () => {
    const room = makeTestRoom({
      hands: [
        [card('H', 4), card('H', 9)],
        [card('H', 2)],
        [card('H', 5), card('D', 3)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob', 'carol'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    handleQuit(room, timers, 'bob', notify);

    expect(reclaimSeat(room, 'bob', 'bob-new-socket')).toBeNull();
    expect(room.seats[1]!.quitVoluntarily).toBe(true);
  });

  it('returns null once the game is over', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    const timers = new TurnTimerManager();
    const notify = vi.fn();

    applyHumanMove(room, timers, 0, card('H', 4), notify);
    handleDisconnect(room, timers, 'bob', notify);
    expect(room.state!.gameOver).toBe(true);

    expect(reclaimSeat(room, 'bob', 'bob-new-socket')).toBeNull();
  });
});
