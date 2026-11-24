import { applyFirstRoundMove, getFirstRoundLegalMoves } from './firstRound.js';
import { applyNormalRoundMove, getNormalRoundLegalMoves } from './normalRound.js';
import { cardEquals, IllegalMoveError } from './types.js';
import type { Card, GameEvent, GameState } from './types.js';

export function getLegalMoves(state: GameState, seat: number): Card[] {
  if (state.gameOver || state.round === null) {
    throw new IllegalMoveError('game-already-over');
  }
  const player = state.players[seat];
  if (!player) throw new IllegalMoveError('unknown-seat');

  const round = state.round;
  const isLeader = round.plays.length === 0;

  if (round.phase === 'first-round') {
    return getFirstRoundLegalMoves(player.hand, isLeader);
  }
  return getNormalRoundLegalMoves(player.hand, round);
}

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
}

export function applyMove(state: GameState, seat: number, card: Card): MoveResult {
  if (state.gameOver || state.round === null) {
    throw new IllegalMoveError('game-already-over');
  }

  const round = state.round;
  const expectedSeat = round.turnOrder[round.nextToActIndex];
  if (expectedSeat === undefined) {
    throw new Error('Invariant violated: round has no seat left to act');
  }
  if (expectedSeat !== seat) {
    throw new IllegalMoveError('not-your-turn');
  }

  const player = state.players[seat];
  if (!player || !player.hand.some((c) => cardEquals(c, card))) {
    throw new IllegalMoveError('card-not-in-hand');
  }

  const legalMoves = getLegalMoves(state, seat);
  if (!legalMoves.some((c) => cardEquals(c, card))) {
    throw new IllegalMoveError('card-does-not-follow-rules');
  }

  if (round.phase === 'first-round') {
    return applyFirstRoundMove(state, round, seat, card);
  }
  return applyNormalRoundMove(state, round, seat, card);
}
