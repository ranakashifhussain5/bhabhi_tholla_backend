import { describe, expect, it } from 'vitest';
import { createGame, dealHands, MAX_PLAYERS, MIN_PLAYERS } from './deal.js';

describe('dealHands', () => {
  it('rejects player counts outside 3-6', () => {
    expect(() => dealHands(2)).toThrow();
    expect(() => dealHands(7)).toThrow();
  });

  for (let playerCount = MIN_PLAYERS; playerCount <= MAX_PLAYERS; playerCount++) {
    it(`deals all 52 cards among ${playerCount} players with no duplicates`, () => {
      const hands = dealHands(playerCount);
      expect(hands).toHaveLength(playerCount);

      const allCards = hands.flat();
      expect(allCards).toHaveLength(52);
      expect(new Set(allCards.map((c) => `${c.suit}${c.rank}`)).size).toBe(52);

      const base = Math.floor(52 / playerCount);
      const remainder = 52 % playerCount;
      for (const hand of hands) {
        expect(hand.length === base || hand.length === base + 1).toBe(true);
      }
      const extraCount = hands.filter((h) => h.length === base + 1).length;
      expect(extraCount).toBe(remainder);
    });
  }

  it('randomizes which seats receive the extra card across games', () => {
    const playerCount = 5; // remainder = 2, so this is observable
    const base = Math.floor(52 / playerCount);
    const extraSeatSets = new Set<string>();

    for (let i = 0; i < 40; i++) {
      const hands = dealHands(playerCount);
      const extraSeats = hands
        .map((h, seat) => ({ seat, len: h.length }))
        .filter((x) => x.len > base)
        .map((x) => x.seat)
        .sort()
        .join(',');
      extraSeatSets.add(extraSeats);
    }

    expect(extraSeatSets.size).toBeGreaterThan(1);
  });
});

describe('createGame', () => {
  it('starts in the first round with the Ace of Spades holder leading', () => {
    const state = createGame(4);
    expect(state.round?.phase).toBe('first-round');
    expect(state.round?.turnOrder).toHaveLength(4);

    const leaderSeat = state.round!.turnOrder[0]!;
    const leader = state.players[leaderSeat]!;
    expect(leader.hand.some((c) => c.suit === 'S' && c.rank === 14)).toBe(true);
  });

  it('builds turn order clockwise starting from the Ace of Spades holder', () => {
    const state = createGame(4);
    const leaderSeat = state.round!.turnOrder[0]!;
    const expected = [0, 1, 2, 3].map((i) => (leaderSeat + i) % 4);
    expect(state.round!.turnOrder).toEqual(expected);
  });

  it('starts with nobody escaped and an empty finish order', () => {
    const state = createGame(6);
    expect(state.escaped).toEqual(new Array(6).fill(false));
    expect(state.finishOrder).toEqual([]);
    expect(state.gameOver).toBe(false);
  });
});
