import { describe, expect, it } from 'vitest';
import { createDeck, shuffle } from './deck.js';

describe('createDeck', () => {
  it('has 52 unique cards covering every suit and rank', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);

    const keys = new Set(deck.map((c) => `${c.suit}${c.rank}`));
    expect(keys.size).toBe(52);

    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      const ranksForSuit = deck.filter((c) => c.suit === suit).map((c) => c.rank);
      expect(ranksForSuit.sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    }
  });
});

describe('shuffle', () => {
  it('returns a permutation with the same multiset of items', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);

    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => `${c.suit}${c.rank}`))).toEqual(
      new Set(deck.map((c) => `${c.suit}${c.rank}`)),
    );
  });

  it('does not mutate the input array', () => {
    const deck = createDeck();
    const copy = [...deck];
    shuffle(deck);
    expect(deck).toEqual(copy);
  });

  it('produces varied orderings across repeated calls', () => {
    const deck = createDeck();
    const serialized = (d: typeof deck) => d.map((c) => `${c.suit}${c.rank}`).join(',');
    const original = serialized(deck);

    const results = Array.from({ length: 10 }, () => serialized(shuffle(deck)));
    expect(results.some((r) => r !== original)).toBe(true);
    expect(new Set(results).size).toBeGreaterThan(1);
  });
});
