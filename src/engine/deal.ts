import { createDeck, shuffle } from './deck.js';
import { buildTurnOrder } from './seats.js';
import type { Card, GameState, PlayerState } from './types.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export function dealHands(playerCount: number): Card[][] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Invalid player count: ${playerCount}`);
  }

  const deck = shuffle(createDeck());
  const base = Math.floor(deck.length / playerCount);
  const remainder = deck.length % playerCount;

  const seats = Array.from({ length: playerCount }, (_, seat) => seat);
  const extraRecipients = new Set(shuffle(seats).slice(0, remainder));

  const hands: Card[][] = [];
  let cursor = 0;
  for (let seat = 0; seat < playerCount; seat++) {
    const count = base + (extraRecipients.has(seat) ? 1 : 0);
    hands.push(deck.slice(cursor, cursor + count));
    cursor += count;
  }
  return hands;
}

export function createGame(playerCount: number): GameState {
  const hands = dealHands(playerCount);
  const players: PlayerState[] = hands.map((hand, seat) => ({ seat, hand }));

  const asHolder = players.findIndex((p) => p.hand.some((c) => c.suit === 'S' && c.rank === 14));
  if (asHolder === -1) {
    throw new Error('Invariant violated: no player holds the Ace of Spades');
  }

  const escaped = new Array<boolean>(playerCount).fill(false);

  return {
    playerCount,
    players,
    escaped,
    finishOrder: [],
    gameOver: false,
    round: {
      phase: 'first-round',
      turnOrder: buildTurnOrder(playerCount, asHolder, escaped),
      nextToActIndex: 0,
      plays: [],
    },
  };
}
