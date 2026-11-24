import { describe, expect, it } from 'vitest';
import { applyNormalRoundMove, getNormalRoundLegalMoves } from './normalRound.js';
import { card, makeGame } from './testHelpers.js';
import type { GameState, NormalRoundState } from './types.js';

describe('getNormalRoundLegalMoves', () => {
  it('lets the leader play any card, which sets the led suit', () => {
    const round: NormalRoundState = { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] };
    const hand = [card('H', 5), card('D', 9)];
    expect(getNormalRoundLegalMoves(hand, round)).toEqual(hand);
  });

  it('forces a follower holding the led suit to play it', () => {
    const round: NormalRoundState = {
      phase: 'normal-round',
      turnOrder: [0, 1],
      nextToActIndex: 1,
      plays: [{ seat: 0, card: card('H', 9) }],
    };
    const hand = [card('H', 5), card('D', 2), card('H', 3)];
    expect(getNormalRoundLegalMoves(hand, round)).toEqual([card('H', 5), card('H', 3)]);
  });

  it('allows any card (a thulla) when the follower has no card of the led suit', () => {
    const round: NormalRoundState = {
      phase: 'normal-round',
      turnOrder: [0, 1],
      nextToActIndex: 1,
      plays: [{ seat: 0, card: card('H', 9) }],
    };
    const hand = [card('D', 2), card('C', 3)];
    expect(getNormalRoundLegalMoves(hand, round)).toEqual(hand);
  });
});

describe('applyNormalRoundMove', () => {
  function play(state: GameState, seat: number, c: ReturnType<typeof card>) {
    return applyNormalRoundMove(state, state.round as NormalRoundState, seat, c);
  }

  it('advances the turn without resolving mid-round', () => {
    const state = makeGame({
      hands: [[card('H', 4), card('C', 2)], [card('H', 9), card('D', 3)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });

    const result = play(state, 0, card('H', 4));

    expect(result.state.round).toEqual({
      phase: 'normal-round',
      turnOrder: [0, 1],
      nextToActIndex: 1,
      plays: [{ seat: 0, card: card('H', 4) }],
    });
    expect(result.state.players[0]!.hand).toEqual([card('C', 2)]);
    expect(result.events).toEqual([
      { type: 'card-played', seat: 0, card: card('H', 4), ledSuit: null, thulla: false },
    ]);
  });

  it('discards and starts the next round with the highest card when nobody thullas', () => {
    let state = makeGame({
      hands: [
        [card('H', 4), card('C', 2)],
        [card('H', 9)],
        [card('H', 6), card('D', 3)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
    });

    let result = play(state, 0, card('H', 4));
    state = result.state;
    result = play(state, 1, card('H', 9));
    state = result.state;
    result = play(state, 2, card('H', 6));
    state = result.state;

    expect(state.gameOver).toBe(false);
    expect(state.escaped).toEqual([false, true, false]);
    expect(state.finishOrder).toEqual([{ seat: 1, position: 1 }]);
    // seat 1 (the nominal next starter) escaped, so seat 2 starts round three instead.
    expect(state.round).toEqual({ phase: 'normal-round', turnOrder: [2, 0], nextToActIndex: 0, plays: [] });
    expect(result.events).toContainEqual({
      type: 'round-discarded',
      cards: [card('H', 4), card('H', 9), card('H', 6)],
      nextStarter: 1,
    });
    expect(result.events).toContainEqual({ type: 'player-escaped', seat: 1, position: 1 });
  });

  it('ends the round immediately on a thulla, picks up the pile, and does not escape the pickup seat', () => {
    let state = makeGame({
      hands: [[card('H', 9)], [card('H', 2), card('C', 5)], [card('D', 7)]],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
    });

    let result = play(state, 0, card('H', 9));
    state = result.state;
    result = play(state, 1, card('H', 2));
    state = result.state;
    result = play(state, 2, card('D', 7)); // seat 2 has no hearts: this is a thulla
    state = result.state;

    expect(result.events.map((e) => e.type)).toEqual(['card-played', 'round-picked-up', 'player-escaped']);
    expect(result.events).toContainEqual({
      type: 'card-played',
      seat: 2,
      card: card('D', 7),
      ledSuit: 'H',
      thulla: true,
    });
    expect(result.events).toContainEqual({
      type: 'round-picked-up',
      seat: 0,
      cards: [card('H', 9), card('H', 2), card('D', 7)],
      nextStarter: 0,
    });
    // Seat 0 played its only card (now has 0) but picks up the pile, so it has not escaped.
    expect(state.players[0]!.hand).toEqual([card('H', 9), card('H', 2), card('D', 7)]);
    expect(state.escaped[0]).toBe(false);
    // Seat 2's thulla card was its last card: it escapes, it does not pick up.
    expect(state.escaped[2]).toBe(true);
    expect(state.finishOrder).toEqual([{ seat: 2, position: 1 }]);
    expect(state.players[1]!.hand).toEqual([card('C', 5)]);
    expect(state.round).toEqual({ phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] });
  });

  it('orders simultaneous finishers in the same round by lower card = better position', () => {
    // seats 1 and 2 play their last card; seats 0 and 3 still have cards left afterwards,
    // so this isolates the ordering rule from the lone-survivor rule below.
    let state = makeGame({
      hands: [
        [card('H', 4), card('C', 9)],
        [card('H', 9)],
        [card('H', 6)],
        [card('H', 2), card('D', 5)],
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2, 3], nextToActIndex: 0, plays: [] },
    });

    let result = play(state, 0, card('H', 4));
    state = result.state;
    result = play(state, 1, card('H', 9));
    state = result.state;
    result = play(state, 2, card('H', 6));
    state = result.state;
    result = play(state, 3, card('H', 2));
    state = result.state;

    expect(state.finishOrder).toEqual([
      { seat: 2, position: 1 },
      { seat: 1, position: 2 },
    ]);
    expect(state.gameOver).toBe(false);
    expect(state.escaped).toEqual([false, true, true, false]);
  });

  it('auto-finishes the lone remaining player as the Bhabhi once everyone else has escaped', () => {
    // seat 0 starts with 2 cards, seat 1 with 1 card
    let state = makeGame({
      hands: [[card('H', 4), card('D', 3)], [card('H', 9)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });

    let result = play(state, 0, card('H', 4));
    state = result.state;
    result = play(state, 1, card('H', 9));
    state = result.state;

    expect(state.finishOrder).toEqual([
      { seat: 1, position: 1 },
      { seat: 0, position: 2 },
    ]);
    expect(state.gameOver).toBe(true);
    expect(state.round).toBeNull();
  });

  it('resolves a final-round tie by making the highest card the Bhabhi', () => {
    let state = makeGame({
      hands: [[card('H', 5)], [card('H', 9)]],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });

    let result = play(state, 0, card('H', 5));
    state = result.state;
    result = play(state, 1, card('H', 9));
    state = result.state;

    expect(state.finishOrder).toEqual([
      { seat: 0, position: 1 },
      { seat: 1, position: 2 },
    ]);
    expect(state.gameOver).toBe(true);
    expect(result.events).toContainEqual({
      type: 'game-over',
      finishOrder: [
        { seat: 0, position: 1 },
        { seat: 1, position: 2 },
      ],
    });
  });
});
