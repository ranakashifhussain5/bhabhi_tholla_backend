import { describe, expect, it } from 'vitest';
import { card } from '../engine/testHelpers.js';
import { createKnowledge, recordEvent, recordEvents } from './knowledge.js';

describe('createKnowledge', () => {
  it('starts with no cards seen and no known-void suits', () => {
    const knowledge = createKnowledge(4);
    expect(knowledge.cardsSeen).toEqual([]);
    expect(knowledge.voidSuits).toHaveLength(4);
    expect(knowledge.voidSuits.every((s) => s.size === 0)).toBe(true);
  });
});

describe('recordEvent', () => {
  it('leaves knowledge unchanged for a non-thulla card-played event', () => {
    const knowledge = createKnowledge(2);
    const next = recordEvent(knowledge, {
      type: 'card-played',
      seat: 0,
      card: card('H', 9),
      ledSuit: null,
      thulla: false,
    });
    expect(next).toEqual(knowledge);
  });

  it('marks a seat void in the led suit when their play is a thulla, without touching cardsSeen', () => {
    const knowledge = createKnowledge(3);
    const next = recordEvent(knowledge, {
      type: 'card-played',
      seat: 2,
      card: card('D', 7),
      ledSuit: 'H',
      thulla: true,
    });
    expect(next.voidSuits[2]!.has('H')).toBe(true);
    expect(next.cardsSeen).toEqual([]);
  });

  it('adds discarded cards to cardsSeen - they are permanently out of circulation', () => {
    const knowledge = createKnowledge(2);
    const next = recordEvent(knowledge, {
      type: 'round-discarded',
      cards: [card('H', 4), card('H', 9)],
      nextStarter: 0,
    });
    expect(next.cardsSeen).toEqual([card('H', 4), card('H', 9)]);
  });

  it('does not add picked-up cards to cardsSeen - they stay in circulation, just hidden again', () => {
    const knowledge = createKnowledge(2);
    const next = recordEvent(knowledge, {
      type: 'round-picked-up',
      seat: 0,
      cards: [card('H', 9), card('D', 7)],
      nextStarter: 0,
    });
    expect(next.cardsSeen).toEqual([]);
  });

  it('does not mutate the input knowledge', () => {
    const knowledge = createKnowledge(2);
    recordEvent(knowledge, {
      type: 'card-played',
      seat: 0,
      card: card('H', 9),
      ledSuit: 'H',
      thulla: true,
    });
    expect(knowledge.cardsSeen).toEqual([]);
    expect(knowledge.voidSuits[0]!.size).toBe(0);
  });

  it('un-voids a seat for any suit it receives back via a pickup', () => {
    let knowledge = createKnowledge(2);
    knowledge = recordEvent(knowledge, {
      type: 'card-played',
      seat: 0,
      card: card('D', 7),
      ledSuit: 'H',
      thulla: true,
    });
    expect(knowledge.voidSuits[0]!.has('H')).toBe(true);

    knowledge = recordEvent(knowledge, {
      type: 'round-picked-up',
      seat: 0,
      cards: [card('H', 9), card('D', 7)],
      nextStarter: 0,
    });
    expect(knowledge.voidSuits[0]!.has('H')).toBe(false);
  });

  it('ignores event types that carry no knowledge', () => {
    const knowledge = createKnowledge(2);
    const next = recordEvent(knowledge, { type: 'player-escaped', seat: 0, position: 1 });
    expect(next).toEqual(knowledge);
  });
});

describe('recordEvents', () => {
  it('folds a sequence of events in order', () => {
    let knowledge = createKnowledge(2);
    knowledge = recordEvents(knowledge, [
      { type: 'card-played', seat: 1, card: card('C', 3), ledSuit: 'H', thulla: true },
      { type: 'round-picked-up', seat: 0, cards: [card('H', 9), card('C', 3)], nextStarter: 0 },
    ]);
    expect(knowledge.voidSuits[1]!.has('H')).toBe(true);
    expect(knowledge.cardsSeen).toEqual([]);

    knowledge = recordEvents(knowledge, [
      { type: 'round-discarded', cards: [card('D', 2), card('D', 5)], nextStarter: 1 },
    ]);
    expect(knowledge.cardsSeen).toEqual([card('D', 2), card('D', 5)]);
  });
});
