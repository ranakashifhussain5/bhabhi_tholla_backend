import { describe, expect, it } from 'vitest';
import { card, makeGame } from './testHelpers.js';
import { IllegalMoveError } from './types.js';
import { applyMove, getLegalMoves } from './validate.js';

describe('getLegalMoves', () => {
  it('delegates to first-round rules', () => {
    const state = makeGame({
      hands: [[card('S', 14)], [card('H', 5)]],
      round: { phase: 'first-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });
    expect(getLegalMoves(state, 0)).toEqual([card('S', 14)]);
  });

  it('delegates to normal-round rules', () => {
    const state = makeGame({
      hands: [[card('H', 5), card('D', 2)], [card('H', 9)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });
    expect(getLegalMoves(state, 0)).toEqual([card('H', 5), card('D', 2)]);
  });

  it('throws once the game is over', () => {
    const state = makeGame({
      hands: [[], []],
      round: { phase: 'normal-round', turnOrder: [], nextToActIndex: 0, plays: [] },
    });
    state.gameOver = true;
    state.round = null;
    expect(() => getLegalMoves(state, 0)).toThrow(IllegalMoveError);
  });
});

describe('applyMove', () => {
  const baseState = () =>
    makeGame({
      hands: [[card('S', 14), card('H', 5)], [card('H', 9)]],
      round: { phase: 'first-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });

  it('rejects a move from the wrong seat', () => {
    const state = baseState();
    expect(() => applyMove(state, 1, card('H', 9))).toThrow(/not-your-turn/);
  });

  it('rejects a card the player does not hold', () => {
    const state = baseState();
    expect(() => applyMove(state, 0, card('D', 7))).toThrow(/card-not-in-hand/);
  });

  it('rejects a legally-held card that breaks the active rule', () => {
    const state = baseState();
    // Seat 0 holds the Ace of Spades but tries to play a different card as leader.
    expect(() => applyMove(state, 0, card('H', 5))).toThrow(/card-does-not-follow-rules/);
  });

  it('applies a legal move and returns the updated state and events', () => {
    const state = baseState();
    const result = applyMove(state, 0, card('S', 14));
    expect(result.state.players[0]!.hand).toEqual([card('H', 5)]);
    expect(result.events).toEqual([
      { type: 'card-played', seat: 0, card: card('S', 14), ledSuit: null, thulla: false },
    ]);
  });

  it('rejects any move once the game is over', () => {
    const state = baseState();
    state.gameOver = true;
    state.round = null;
    expect(() => applyMove(state, 0, card('S', 14))).toThrow(/game-already-over/);
  });
});
