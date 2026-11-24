import { describe, expect, it } from 'vitest';
import { card, makeGame } from '../engine/testHelpers.js';
import { decideMove } from './decide.js';
import { createKnowledge } from './knowledge.js';

describe('decideMove', () => {
  it('plays the only legal move when forced', () => {
    const state = makeGame({
      hands: [[card('S', 14), card('H', 5)], [card('H', 9)]],
      round: { phase: 'first-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });
    expect(decideMove(state, 0, createKnowledge(2))).toEqual(card('S', 14));
  });

  it('keeps high spades back when several legal spades are held in round one', () => {
    const state = makeGame({
      hands: [[card('S', 14)], [card('S', 9), card('S', 2), card('H', 3)]],
      round: {
        phase: 'first-round',
        turnOrder: [0, 1],
        nextToActIndex: 1,
        plays: [{ seat: 0, card: card('S', 14) }],
      },
    });
    expect(decideMove(state, 1, createKnowledge(2))).toEqual(card('S', 2));
  });

  it('dumps the highest matching card when following suit is safe (no known void ahead)', () => {
    const state = makeGame({
      hands: [[card('H', 4)], [card('H', 2), card('H', 9)], [card('D', 5)]],
      round: {
        phase: 'normal-round',
        turnOrder: [0, 1, 2],
        nextToActIndex: 1,
        plays: [{ seat: 0, card: card('H', 4) }],
      },
    });
    expect(decideMove(state, 1, createKnowledge(3))).toEqual(card('H', 9));
  });

  it('plays low when a later player is known void in the led suit (thulla risk ahead)', () => {
    const knowledge = createKnowledge(3);
    knowledge.voidSuits[2]!.add('H');

    const state = makeGame({
      hands: [[card('H', 4)], [card('H', 2), card('H', 9)], [card('D', 5)]],
      round: {
        phase: 'normal-round',
        turnOrder: [0, 1, 2],
        nextToActIndex: 1,
        plays: [{ seat: 0, card: card('H', 4) }],
      },
    });
    expect(decideMove(state, 1, knowledge)).toEqual(card('H', 2));
  });

  it('dumps the highest card when forced to thulla, regardless of suit', () => {
    const state = makeGame({
      hands: [[card('H', 4)], [card('D', 2), card('C', 9)]],
      round: {
        phase: 'normal-round',
        turnOrder: [0, 1],
        nextToActIndex: 1,
        plays: [{ seat: 0, card: card('H', 4) }],
      },
    });
    expect(decideMove(state, 1, createKnowledge(2))).toEqual(card('C', 9));
  });

  it('as leader, avoids a suit where every other player is known void', () => {
    const knowledge = createKnowledge(3);
    knowledge.voidSuits[1]!.add('H');
    knowledge.voidSuits[2]!.add('H');

    const state = makeGame({
      hands: [
        [card('S', 5), card('H', 9)],
        Array.from({ length: 8 }, (_, i) => card('D', ((i % 11) + 2) as never)),
        Array.from({ length: 8 }, (_, i) => card('C', ((i % 11) + 2) as never)),
      ],
      round: { phase: 'normal-round', turnOrder: [0, 1, 2], nextToActIndex: 0, plays: [] },
    });

    expect(decideMove(state, 0, knowledge)).toEqual(card('S', 5));
  });

  it('throws once the game is over', () => {
    const state = makeGame({
      hands: [[], []],
      round: { phase: 'normal-round', turnOrder: [], nextToActIndex: 0, plays: [] },
    });
    state.round = null;
    state.gameOver = true;
    expect(() => decideMove(state, 0, createKnowledge(2))).toThrow(/game-already-over/);
  });
});
