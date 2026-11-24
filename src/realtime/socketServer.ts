import { randomUUID } from 'node:crypto';
import type { Server as HTTPServer } from 'node:http';
import { Server as SocketIOServer, type DefaultEventsMap, type Socket } from 'socket.io';
import type { Card } from '../engine/index.js';
import { advance, applyHumanMove, handleDisconnect, handleQuit, reclaimSeat } from './gameplay.js';
import { QuickPlayMatchmaker } from './matchmaking.js';
import type { SeatEntry } from './matchmaking.js';
import {
  buildJoinLink,
  createPrivateRoom,
  joinPrivateRoom,
  PrivateRoomError,
  startPrivateRoom,
} from './privateRoom.js';
import { buildPlayerView } from './projection.js';
import { createLobbyRoom, findSeatByPlayerId, startGame } from './room.js';
import type { Room } from './room.js';
import { InMemoryRoomRepository } from './roomRepository.js';
import type { RoomRepository } from './roomRepository.js';
import { TurnTimerManager } from './turnTimer.js';

interface SocketData {
  roomId?: string;
  playerId?: string;
}

export interface RealtimeServer {
  io: SocketIOServer;
  repository: RoomRepository;
}

/**
 * Wires the room/gameplay/matchmaking primitives (already unit-tested on
 * their own) to real Socket.IO events. Identity here is just a client-
 * supplied playerId string - there is no auth yet (that is Phase 4), so this
 * layer trusts it. Phase 6 (hardening) needs to replace that trust with a
 * real verified identity before this ships.
 */
export function attachSocketServer(
  httpServer: HTTPServer,
  options: { turnTimeoutMs?: number } = {},
): RealtimeServer {
  const io = new SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, {
    cors: { origin: '*' },
  });
  const repository: RoomRepository = new InMemoryRoomRepository();
  const timers = new TurnTimerManager(
    options.turnTimeoutMs === undefined ? {} : { timeoutMs: options.turnTimeoutMs },
  );

  function notify(room: Room): void {
    for (const seat of room.seats) {
      if (seat.isBot || seat.socketId === null) continue;
      io.to(seat.socketId).emit('room:state', buildPlayerView(room, seat.seat));
    }
  }

  function bindSocketToSeat(room: Room, playerId: string, socketId: string): void {
    const binding = findSeatByPlayerId(room, playerId);
    if (!binding) return;
    binding.socketId = socketId;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.data.roomId = room.roomId;
      socket.data.playerId = playerId;
      void socket.join(room.roomId);
    } else {
      // The socket vanished between queueing/lobby and game start.
      binding.isBot = true;
      binding.connected = false;
      binding.socketId = null;
    }
  }

  function startQuickPlayRoom(entries: readonly SeatEntry[]): void {
    const room = createLobbyRoom({ roomId: randomUUID(), mode: 'quick-play', affectsRank: true });
    repository.create(room);
    startGame(room, entries.map((e) => e?.playerId ?? null));

    for (const entry of entries) {
      if (entry) bindSocketToSeat(room, entry.playerId, entry.socketId);
    }
    for (const seat of room.seats) {
      if (!seat.isBot && seat.socketId) {
        io.to(seat.socketId).emit('room:joined', { roomId: room.roomId, seat: seat.seat });
      }
    }

    advance(room, timers, notify);
    notify(room);
  }

  const matchmaker = new QuickPlayMatchmaker(startQuickPlayRoom);

  function currentRoom(socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>): Room | null {
    const roomId = socket.data.roomId;
    if (!roomId) return null;
    return repository.get(roomId) ?? null;
  }

  io.on('connection', (socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>) => {
    socket.on('quickplay:join', (payload: { playerId: string }) => {
      socket.data.playerId = payload.playerId;
      matchmaker.join(payload.playerId, socket.id);
    });

    socket.on(
      'privateroom:create',
      (payload: { playerId: string }, ack?: (res: { roomId: string; roomCode: string; joinLink: string }) => void) => {
        const room = createPrivateRoom(repository, payload.playerId);
        socket.data.roomId = room.roomId;
        socket.data.playerId = payload.playerId;
        void socket.join(room.roomId);
        ack?.({
          roomId: room.roomId,
          roomCode: room.roomCode!,
          joinLink: buildJoinLink('https://bhabhi-tholla.invalid', room.roomCode!),
        });
      },
    );

    socket.on(
      'privateroom:join',
      (payload: { roomCode: string; playerId: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
        const room = repository.findByRoomCode(payload.roomCode);
        if (!room) {
          ack?.({ ok: false, error: 'room-not-found' });
          return;
        }
        try {
          joinPrivateRoom(room, payload.playerId);
          socket.data.roomId = room.roomId;
          socket.data.playerId = payload.playerId;
          void socket.join(room.roomId);
          ack?.({ ok: true });
          io.to(room.roomId).emit('privateroom:lobby', { pendingPlayerIds: room.pendingPlayerIds });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof PrivateRoomError ? err.reason : 'unknown' });
        }
      },
    );

    socket.on('privateroom:start', (_payload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const room = currentRoom(socket);
      const playerId = socket.data.playerId;
      if (!room || !playerId) {
        ack?.({ ok: false, error: 'not-in-a-room' });
        return;
      }
      try {
        startPrivateRoom(room, playerId);
        for (const pendingId of room.pendingPlayerIds) {
          bindSocketToSeat(room, pendingId, findSocketIdForPlayer(io, room.roomId, pendingId) ?? '');
        }
        ack?.({ ok: true });
        advance(room, timers, notify);
        notify(room);
      } catch (err) {
        ack?.({ ok: false, error: err instanceof PrivateRoomError ? err.reason : 'unknown' });
      }
    });

    socket.on('play-card', (payload: { card: Card }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const room = currentRoom(socket);
      const binding = room?.seats.find((s) => s.socketId === socket.id);
      if (!room || !binding) {
        ack?.({ ok: false, error: 'not-in-a-game' });
        return;
      }
      try {
        applyHumanMove(room, timers, binding.seat, payload.card, notify);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
      }
    });

    socket.on('quit', () => {
      const room = currentRoom(socket);
      if (room) handleQuit(room, timers, socket.id, notify);
    });

    socket.on(
      'reclaim',
      (payload: { roomId: string; playerId: string }, ack?: (res: { ok: boolean }) => void) => {
        const room = repository.get(payload.roomId);
        if (!room) {
          ack?.({ ok: false });
          return;
        }
        const binding = reclaimSeat(room, payload.playerId, socket.id);
        if (binding) {
          socket.data.roomId = room.roomId;
          socket.data.playerId = payload.playerId;
          void socket.join(room.roomId);
        }
        ack?.({ ok: binding !== null });
        if (binding) notify(room);
      },
    );

    socket.on('disconnect', () => {
      const room = currentRoom(socket);
      if (room) handleDisconnect(room, timers, socket.id, notify);
    });
  });

  return { io, repository };
}

function findSocketIdForPlayer(
  io: SocketIOServer,
  roomId: string,
  playerId: string,
): string | undefined {
  for (const socket of io.sockets.sockets.values()) {
    const data = socket.data as SocketData;
    if (data.roomId === roomId && data.playerId === playerId) return socket.id;
  }
  return undefined;
}
