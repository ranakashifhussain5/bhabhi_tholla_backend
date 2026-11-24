import { randomInt, randomUUID } from 'node:crypto';
import { createLobbyRoom, startGame } from './room.js';
import type { Room } from './room.js';
import type { RoomRepository } from './roomRepository.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../engine/index.js';

export class PrivateRoomError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'PrivateRoomError';
  }
}

function generateRoomCode(): string {
  return String(randomInt(1000, 10_000));
}

export function createPrivateRoom(repository: RoomRepository, hostPlayerId: string): Room {
  let roomCode = generateRoomCode();
  while (repository.findByRoomCode(roomCode)) {
    roomCode = generateRoomCode();
  }

  const room = createLobbyRoom({
    roomId: randomUUID(),
    mode: 'private',
    affectsRank: false,
    roomCode,
    hostPlayerId,
  });
  repository.create(room);
  return room;
}

export function buildJoinLink(baseUrl: string, roomCode: string): string {
  return `${baseUrl.replace(/\/$/, '')}/join/${roomCode}`;
}

export function joinPrivateRoom(room: Room, playerId: string): void {
  if (room.state !== null) {
    throw new PrivateRoomError('already-started');
  }
  if (room.pendingPlayerIds.includes(playerId)) {
    return;
  }
  if (room.pendingPlayerIds.length >= MAX_PLAYERS) {
    throw new PrivateRoomError('room-full');
  }
  room.pendingPlayerIds.push(playerId);
}

/** Only the host may start the game, and only once there are enough players (section 1: 3-6). Private rooms never bot-fill empty seats. */
export function startPrivateRoom(room: Room, requesterPlayerId: string): void {
  if (room.state !== null) {
    throw new PrivateRoomError('already-started');
  }
  if (requesterPlayerId !== room.hostPlayerId) {
    throw new PrivateRoomError('not-host');
  }
  if (room.pendingPlayerIds.length < MIN_PLAYERS) {
    throw new PrivateRoomError('not-enough-players');
  }
  startGame(room, room.pendingPlayerIds);
}
