import type { Card, GameEvent, Suit } from '../engine/index.js';

export interface BotKnowledge {
  cardsSeen: Card[];
  voidSuits: Array<Set<Suit>>;
}

export function createKnowledge(playerCount: number): BotKnowledge {
  return {
    cardsSeen: [],
    voidSuits: Array.from({ length: playerCount }, () => new Set<Suit>()),
  };
}

export function recordEvent(knowledge: BotKnowledge, event: GameEvent): BotKnowledge {
  if (event.type === 'card-played') {
    if (!event.thulla || event.ledSuit === null) return knowledge;
    const voidSuits = knowledge.voidSuits.map((s) => new Set(s));
    voidSuits[event.seat]!.add(event.ledSuit);
    return { cardsSeen: knowledge.cardsSeen, voidSuits };
  }

  if (event.type === 'round-discarded') {
    // Discarded cards are permanently out of circulation. A picked-up pile is
    // NOT: it returns to the pickup seat's hand, hidden again, so it stays in
    // circulation and must not be excluded from future opponent-hand sampling.
    return { cardsSeen: [...knowledge.cardsSeen, ...event.cards], voidSuits: knowledge.voidSuits };
  }

  if (event.type === 'round-picked-up') {
    const voidSuits = knowledge.voidSuits.map((s) => new Set(s));
    for (const card of event.cards) {
      voidSuits[event.seat]!.delete(card.suit);
    }
    return { cardsSeen: knowledge.cardsSeen, voidSuits };
  }

  return knowledge;
}

export function recordEvents(knowledge: BotKnowledge, events: readonly GameEvent[]): BotKnowledge {
  return events.reduce(recordEvent, knowledge);
}
