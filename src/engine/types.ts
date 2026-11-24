export type Suit = 'S' | 'H' | 'D' | 'C';

export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const ACE: Rank = 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export interface PlayerState {
  seat: number;
  hand: Card[];
}

export interface PlayedCard {
  seat: number;
  card: Card;
}

export interface FirstRoundState {
  phase: 'first-round';
  turnOrder: number[];
  nextToActIndex: number;
  plays: PlayedCard[];
}

export interface NormalRoundState {
  phase: 'normal-round';
  turnOrder: number[];
  nextToActIndex: number;
  plays: PlayedCard[];
}

export type RoundState = FirstRoundState | NormalRoundState;

export interface FinishResult {
  seat: number;
  position: number;
}

export interface GameState {
  playerCount: number;
  players: PlayerState[];
  escaped: boolean[];
  finishOrder: FinishResult[];
  gameOver: boolean;
  round: RoundState | null;
}

export type GameEvent =
  | { type: 'card-played'; seat: number; card: Card }
  | { type: 'round-discarded'; cards: Card[]; nextStarter: number }
  | { type: 'round-picked-up'; seat: number; cards: Card[]; nextStarter: number }
  | { type: 'player-escaped'; seat: number; position: number }
  | { type: 'game-over'; finishOrder: FinishResult[] };

export class IllegalMoveError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'IllegalMoveError';
  }
}
