import type { Card, FirstRoundState, GameState, NormalRoundState, PlayerState, Rank, Suit } from './types.js';

export function card(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function makeGame(options: {
  hands: Card[][];
  escaped?: boolean[];
  round: FirstRoundState | NormalRoundState;
  finishOrder?: GameState['finishOrder'];
}): GameState {
  const playerCount = options.hands.length;
  const players: PlayerState[] = options.hands.map((hand, seat) => ({ seat, hand }));
  return {
    playerCount,
    players,
    escaped: options.escaped ?? new Array<boolean>(playerCount).fill(false),
    finishOrder: options.finishOrder ?? [],
    gameOver: false,
    round: options.round,
  };
}
