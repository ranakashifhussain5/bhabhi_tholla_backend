import { describe, expect, it } from 'vitest';
import { applyFirstRoundMove, getFirstRoundLegalMoves } from './firstRound.js';
import { card, makeGame } from './testHelpers.js';
import type { FirstRoundState } from './types.js';

describe('getFirstRoundLegalMoves', () => {
  it('forces the leader to play the Ace of Spades', () => {
    const hand = [card('S', 14), card('H', 5)];
    expect(getFirstRoundLegalMoves(hand, true)).toEqual([card('S', 14)]);
  });

  it('throws if the leader does not hold the Ace of Spades (invariant violation)', () => {
    const hand = [card('H', 5), card('D', 6)];
    expect(() => getFirstRoundLegalMoves(hand, true)).toThrow(/Ace of Spades/);
  });

  it('forces a follower with spades to play a spade', () => {
    const hand = [card('S', 5), card('H', 9), card('S', 2)];
    expect(getFirstRoundLegalMoves(hand, false)).toEqual([card('S', 5), card('S', 2)]);
  });

  it('allows a follower with no spades to play any non-Ace card', () => {
    const hand = [card('H', 14), card('D', 5), card('C', 9)];
    expect(getFirstRoundLegalMoves(hand, false)).toEqual([card('D', 5), card('C', 9)]);
  });

  it('throws loudly if a follower has no spades and only Aces (section 2 invariant)', () => {
    const hand = [card('H', 14), card('D', 14)];
    expect(() => getFirstRoundLegalMoves(hand, false)).toThrow(/no spades and only aces/);
  });
});

describe('applyFirstRoundMove', () => {
  function startingRound(turnOrder: number[]): FirstRoundState {
    return { phase: 'first-round', turnOrder, nextToActIndex: 0, plays: [] };
  }

  it('advances the turn without resolving until everyone has played', () => {
    const state = makeGame({
      hands: [
        [card('S', 14), card('S', 2)],
        [card('S', 5), card('H', 3)],
        [card('H', 2), card('D', 3)],
        [card('S', 13), card('C', 4)],
      ],
      round: startingRound([0, 1, 2, 3]),
    });

    const result = applyFirstRoundMove(state, state.round as FirstRoundState, 0, card('S', 14));

    expect(result.state.round?.phase).toBe('first-round');
    expect(result.state.round?.nextToActIndex).toBe(1);
    expect(result.state.players[0]!.hand).toEqual([card('S', 2)]);
    expect(result.events).toEqual([
      { type: 'card-played', seat: 0, card: card('S', 14), ledSuit: null, thulla: false },
    ]);
  });

  it('resolves to the highest spade starting round two once everyone has played', () => {
    let state = makeGame({
      hands: [
        [card('S', 14), card('S', 2)],
        [card('S', 5), card('H', 3)],
        [card('H', 2), card('D', 3)],
        [card('S', 13), card('C', 4)],
      ],
      round: startingRound([0, 1, 2, 3]),
    });

    const moves: [number, ReturnType<typeof card>][] = [
      [0, card('S', 14)],
      [1, card('S', 5)],
      [2, card('H', 2)],
      [3, card('S', 13)],
    ];

    let lastEvents: unknown[] = [];
    for (const [seat, c] of moves) {
      const result = applyFirstRoundMove(state, state.round as FirstRoundState, seat, c);
      state = result.state;
      lastEvents = result.events;
    }

    // Ace of Spades (rank 14) beats the King of Spades (rank 13): seat 0 starts round two.
    expect(state.round?.phase).toBe('normal-round');
    expect(state.round?.turnOrder).toEqual([0, 1, 2, 3]);
    expect(state.round?.plays).toEqual([]);
    expect(state.players.map((p) => p.hand)).toEqual([
      [card('S', 2)],
      [card('H', 3)],
      [card('D', 3)],
      [card('C', 4)],
    ]);
    expect(lastEvents).toEqual([
      { type: 'card-played', seat: 3, card: card('S', 13), ledSuit: null, thulla: false },
      {
        type: 'round-discarded',
        cards: [card('S', 14), card('S', 5), card('H', 2), card('S', 13)],
        nextStarter: 0,
      },
    ]);
  });
});
