import { createGame } from '../engine/index.js';
import type { GameState } from '../engine/index.js';
import { createKnowledge } from '../bots/index.js';
import type { BotKnowledge } from '../bots/index.js';

export type RoomMode = 'quick-play' | 'private';

export interface SeatBinding {
  seat: number;
  playerId: string | null;
  isBot: boolean;
  connected: boolean;
  socketId: string | null;
  /** Set by a deliberate quit (section 7), never by a network disconnect. Blocks reclaiming the seat and is Phase 4's signal to apply the quit penalty instead of normal position scoring. */
  quitVoluntarily: boolean;
}

export interface Room {
  roomId: string;
  mode: RoomMode;
  affectsRank: boolean;
  roomCode: string | null;
  hostPlayerId: string | null;
  pendingPlayerIds: string[];
  seats: SeatBinding[];
  state: GameState | null;
  knowledge: BotKnowledge | null;
  startedAt: Date | null;
  /** Set once by db/results.ts after persisting - guards against double-writing a result if notify() fires again post-game-over. */
  resultPersisted: boolean;
}

export function createLobbyRoom(options: {
  roomId: string;
  mode: RoomMode;
  affectsRank: boolean;
  roomCode?: string | null;
  hostPlayerId?: string | null;
}): Room {
  return {
    roomId: options.roomId,
    mode: options.mode,
    affectsRank: options.affectsRank,
    roomCode: options.roomCode ?? null,
    hostPlayerId: options.hostPlayerId ?? null,
    pendingPlayerIds: options.hostPlayerId ? [options.hostPlayerId] : [],
    seats: [],
    state: null,
    knowledge: null,
    startedAt: null,
    resultPersisted: false,
  };
}

/** Deals a fresh game and binds a seat to each entry (null entries are bot seats). */
export function startGame(room: Room, playerIds: ReadonlyArray<string | null>): void {
  if (room.state !== null) {
    throw new Error(`Invariant violated: room ${room.roomId} already has a game in progress`);
  }

  const playerCount = playerIds.length;
  room.state = createGame(playerCount);
  room.knowledge = createKnowledge(playerCount);
  room.startedAt = new Date();
  room.seats = playerIds.map((playerId, seat) => ({
    seat,
    playerId,
    isBot: playerId === null,
    connected: playerId !== null,
    socketId: null,
    quitVoluntarily: false,
  }));
}

export function findSeatByPlayerId(room: Room, playerId: string): SeatBinding | undefined {
  return room.seats.find((s) => s.playerId === playerId);
}

export function findSeatBySocketId(room: Room, socketId: string): SeatBinding | undefined {
  return room.seats.find((s) => s.socketId === socketId);
}
