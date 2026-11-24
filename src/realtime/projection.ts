import { getLegalMoves } from '../engine/index.js';
import type { Card, FinishResult, PlayedCard } from '../engine/index.js';
import type { Room } from './room.js';

export interface SeatView {
  seat: number;
  cardCount: number;
  isBot: boolean;
  connected: boolean;
  escaped: boolean;
}

export interface RoundView {
  phase: 'first-round' | 'normal-round';
  turnOrder: number[];
  nextToActIndex: number;
  plays: PlayedCard[];
}

export interface PlayerView {
  viewerSeat: number;
  hand: Card[];
  seats: SeatView[];
  round: RoundView | null;
  finishOrder: FinishResult[];
  gameOver: boolean;
  yourTurn: boolean;
  /** Which of the viewer's own cards are legal to play right now; empty when it isn't their turn. */
  legalMoves: Card[];
}

/**
 * Builds the client-safe view for one seat: their own hand in full, and only
 * card counts (never hand contents) for everyone else - GAME_RULES.md
 * section 12.
 */
export function buildPlayerView(room: Room, viewerSeat: number): PlayerView {
  if (room.state === null) {
    throw new Error(`Invariant violated: room ${room.roomId} has no game in progress`);
  }
  const state = room.state;
  const viewer = state.players[viewerSeat];
  if (!viewer) {
    throw new Error(`Invariant violated: seat ${viewerSeat} does not exist in room ${room.roomId}`);
  }
  const yourTurn = state.round !== null && state.round.turnOrder[state.round.nextToActIndex] === viewerSeat;

  return {
    viewerSeat,
    hand: viewer.hand,
    seats: state.players.map((player, seat) => ({
      seat,
      cardCount: player.hand.length,
      isBot: room.seats[seat]!.isBot,
      connected: room.seats[seat]!.connected,
      escaped: state.escaped[seat]!,
    })),
    round: state.round
      ? {
          phase: state.round.phase,
          turnOrder: state.round.turnOrder,
          nextToActIndex: state.round.nextToActIndex,
          plays: state.round.plays,
        }
      : null,
    finishOrder: state.finishOrder,
    gameOver: state.gameOver,
    yourTurn,
    legalMoves: yourTurn ? getLegalMoves(state, viewerSeat) : [],
  };
}
