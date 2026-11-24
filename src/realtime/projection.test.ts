import { describe, expect, it } from 'vitest';
import { card } from '../engine/testHelpers.js';
import { buildPlayerView } from './projection.js';
import { makeTestRoom } from './testHelpers.js';

describe('buildPlayerView', () => {
  it('shows the viewer their own hand but only card counts for everyone else', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4), card('H', 9)], [card('H', 2), card('D', 3)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });

    const aliceView = buildPlayerView(room, 0);
    expect(aliceView.hand).toEqual([card('H', 4), card('H', 9)]);
    expect(aliceView.seats).toEqual([
      { seat: 0, cardCount: 2, isBot: false, connected: true, escaped: false },
      { seat: 1, cardCount: 2, isBot: false, connected: true, escaped: false },
    ]);

    const bobView = buildPlayerView(room, 1);
    expect(bobView.hand).toEqual([card('H', 2), card('D', 3)]);
    // Bob's view never includes Alice's actual cards anywhere.
    const serialized = JSON.stringify(bobView);
    expect(serialized).not.toContain('"rank":4');
    expect(serialized).not.toContain('"rank":9');
  });

  it('reports whose turn it is', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 1, plays: [{ seat: 0, card: card('H', 4) }] },
      playerIds: ['alice', 'bob'],
    });

    expect(buildPlayerView(room, 0).yourTurn).toBe(false);
    expect(buildPlayerView(room, 0).legalMoves).toEqual([]);
    expect(buildPlayerView(room, 1).yourTurn).toBe(true);
    expect(buildPlayerView(room, 1).legalMoves).toEqual([card('H', 2)]);
  });

  it('throws if the game has not started', () => {
    const room = makeTestRoom({
      hands: [[card('H', 4)], [card('H', 2)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
      playerIds: ['alice', 'bob'],
    });
    room.state = null;

    expect(() => buildPlayerView(room, 0)).toThrow(/no game in progress/);
  });
});
