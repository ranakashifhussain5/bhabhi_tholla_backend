import { applyMove } from '../engine/index.js';
import type { Card } from '../engine/index.js';
import { decideMove, recordEvents } from '../bots/index.js';
import { findSeatByPlayerId, findSeatBySocketId } from './room.js';
import type { Room, SeatBinding } from './room.js';
import type { TurnTimerManager } from './turnTimer.js';

export type RoomListener = (room: Room) => void;

function requireState(room: Room) {
  if (room.state === null || room.knowledge === null) {
    throw new Error(`Invariant violated: room ${room.roomId} has no game in progress`);
  }
  return { state: room.state, knowledge: room.knowledge };
}

function applyBotMove(room: Room, seat: number, notify: RoomListener): void {
  const { state, knowledge } = requireState(room);
  const move = decideMove(state, seat, knowledge);
  const result = applyMove(state, seat, move);
  room.state = result.state;
  room.knowledge = recordEvents(knowledge, result.events);
  notify(room);
}

/**
 * Drives the room forward through every consecutive bot turn (matchmaking
 * bots, disconnected seats, and timed-out seats all use the same decision
 * function) and stops as soon as a connected human needs to act or the game
 * ends. A human turn starts the turn timer (section 6); its callback plays
 * on their behalf via the same bot logic and keeps advancing.
 */
export function advance(room: Room, timers: TurnTimerManager, notify: RoomListener): void {
  const { state } = requireState(room);
  let current = state;

  while (!current.gameOver) {
    const round = current.round!;
    const seat = round.turnOrder[round.nextToActIndex]!;
    const binding = room.seats[seat]!;

    if (!binding.isBot) {
      timers.start(room.roomId, () => {
        applyBotMove(room, seat, notify);
        advance(room, timers, notify);
      });
      return;
    }

    applyBotMove(room, seat, notify);
    current = room.state!;
  }

  timers.clear(room.roomId);
}

/** The entry point for a real player's move. Throws IllegalMoveError on an invalid move. */
export function applyHumanMove(
  room: Room,
  timers: TurnTimerManager,
  seat: number,
  card: Card,
  notify: RoomListener,
): void {
  const { state, knowledge } = requireState(room);
  timers.clear(room.roomId);
  const result = applyMove(state, seat, card);
  room.state = result.state;
  room.knowledge = recordEvents(knowledge, result.events);
  notify(room);
  advance(room, timers, notify);
}

/** A network drop: the seat is taken over by the bot immediately, but can be reclaimed later (section 7). */
export function handleDisconnect(
  room: Room,
  timers: TurnTimerManager,
  socketId: string,
  notify: RoomListener,
): SeatBinding | null {
  const binding = findSeatBySocketId(room, socketId);
  if (!binding) return null;

  binding.isBot = true;
  binding.connected = false;
  binding.socketId = null;

  takeOverIfCurrentTurn(room, timers, binding.seat, notify);
  return binding;
}

/** A deliberate exit/quit during a ranked game: like a disconnect, but permanent - cannot be reclaimed. */
export function handleQuit(
  room: Room,
  timers: TurnTimerManager,
  socketId: string,
  notify: RoomListener,
): SeatBinding | null {
  const binding = findSeatBySocketId(room, socketId);
  if (!binding) return null;

  binding.isBot = true;
  binding.connected = false;
  binding.socketId = null;
  binding.quitVoluntarily = true;

  takeOverIfCurrentTurn(room, timers, binding.seat, notify);
  return binding;
}

function takeOverIfCurrentTurn(
  room: Room,
  timers: TurnTimerManager,
  seat: number,
  notify: RoomListener,
): void {
  if (room.state === null || room.state.gameOver) return;
  const round = room.state.round!;
  if (round.turnOrder[round.nextToActIndex] !== seat) return;

  timers.clear(room.roomId);
  applyBotMove(room, seat, notify);
  advance(room, timers, notify);
}

/** Lets a returning player take control back from the bot playing their seat. Returns null if there is nothing to reclaim. */
export function reclaimSeat(room: Room, playerId: string, socketId: string): SeatBinding | null {
  const binding = findSeatByPlayerId(room, playerId);
  if (!binding) return null;
  if (binding.quitVoluntarily) return null;
  if (room.state === null || room.state.gameOver) return null;

  binding.isBot = false;
  binding.connected = true;
  binding.socketId = socketId;
  return binding;
}
