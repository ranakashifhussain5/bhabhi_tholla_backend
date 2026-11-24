import { randomUUID } from 'node:crypto';
import type { Server as HTTPServer } from 'node:http';
import { Server as SocketIOServer, type DefaultEventsMap, type Socket } from 'socket.io';
import type { JwtSecrets } from '../auth/index.js';
import { verifyToken } from '../auth/index.js';
import {
  ChatError,
  createChatMessage,
  defaultProfanityFilter,
  fileReport,
  getMutedUserIds,
  muteUser,
  unmuteUser,
} from '../chat/index.js';
import type { ChatMessage, ProfanityFilter } from '../chat/index.js';
import { persistGameResult } from '../db/results.js';
import type { Card } from '../engine/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';
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
  playerId: string;
  mutedUserIds: Set<string>;
}

export interface RealtimeServer {
  io: SocketIOServer;
  repository: RoomRepository;
}

export interface AttachSocketServerOptions {
  turnTimeoutMs?: number;
  prisma: PrismaClient;
  jwtSecrets: JwtSecrets;
  profanityFilter?: ProfanityFilter;
}

type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Wires the room/gameplay/matchmaking primitives (already unit-tested on
 * their own) to real Socket.IO events. Every connection must present a valid
 * access token (section 12's "server is authoritative" extends to identity
 * too) - there is no more trust-the-client-string gap from Phase 3.
 */
export function attachSocketServer(
  httpServer: HTTPServer,
  options: AttachSocketServerOptions,
): RealtimeServer {
  const io = new SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, {
    cors: { origin: '*' },
  });
  const repository: RoomRepository = new InMemoryRoomRepository();
  const timers = new TurnTimerManager(
    options.turnTimeoutMs === undefined ? {} : { timeoutMs: options.turnTimeoutMs },
  );
  const { prisma, jwtSecrets } = options;
  const profanityFilter = options.profanityFilter ?? defaultProfanityFilter;

  io.use((socket, next) => {
    void (async () => {
      try {
        const token = socket.handshake.auth.token as unknown;
        if (typeof token !== 'string') throw new Error('missing-token');
        const playerId = await verifyToken(token, jwtSecrets.accessSecret);
        socket.data.playerId = playerId;
        socket.data.mutedUserIds = await getMutedUserIds(prisma, playerId);
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    })();
  });

  function notify(room: Room): void {
    for (const seat of room.seats) {
      if (seat.isBot || seat.socketId === null) continue;
      io.to(seat.socketId).emit('room:state', buildPlayerView(room, seat.seat));
    }
    if (room.state?.gameOver) {
      void persistGameResult(prisma, room).catch((err: unknown) => {
        console.error(`Failed to persist game result for room ${room.roomId}`, err);
      });
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

  /** A muted player's messages are excluded only from the muter's own stream (GAME_RULES.md section 11). */
  function broadcastChatMessage(room: Room, senderPlayerId: string, message: ChatMessage): void {
    for (const seat of room.seats) {
      if (seat.isBot || seat.socketId === null) continue;
      const recipient = io.sockets.sockets.get(seat.socketId) as AppSocket | undefined;
      if (recipient?.data.mutedUserIds.has(senderPlayerId)) continue;
      io.to(seat.socketId).emit('chat:message', message);
    }
  }

  function currentRoom(socket: AppSocket): Room | null {
    const roomId = socket.data.roomId;
    if (!roomId) return null;
    return repository.get(roomId) ?? null;
  }

  io.on('connection', (socket: AppSocket) => {
    socket.on('quickplay:join', () => {
      matchmaker.join(socket.data.playerId, socket.id);
    });

    socket.on(
      'privateroom:create',
      (_payload: unknown, ack?: (res: { roomId: string; roomCode: string; joinLink: string }) => void) => {
        const room = createPrivateRoom(repository, socket.data.playerId);
        socket.data.roomId = room.roomId;
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
      (payload: { roomCode: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
        const room = repository.findByRoomCode(payload.roomCode);
        if (!room) {
          ack?.({ ok: false, error: 'room-not-found' });
          return;
        }
        try {
          joinPrivateRoom(room, socket.data.playerId);
          socket.data.roomId = room.roomId;
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
      if (!room) {
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

    socket.on('reclaim', (payload: { roomId: string }, ack?: (res: { ok: boolean }) => void) => {
      const room = repository.get(payload.roomId);
      if (!room) {
        ack?.({ ok: false });
        return;
      }
      const binding = reclaimSeat(room, socket.data.playerId, socket.id);
      if (binding) {
        socket.data.roomId = room.roomId;
        void socket.join(room.roomId);
      }
      ack?.({ ok: binding !== null });
      if (binding) notify(room);
    });

    socket.on('disconnect', () => {
      const room = currentRoom(socket);
      if (room) handleDisconnect(room, timers, socket.id, notify);
    });

    socket.on('chat:send', (payload: { text: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const room = currentRoom(socket);
      const binding = room?.seats.find((s) => s.socketId === socket.id);
      if (!room || !binding) {
        ack?.({ ok: false, error: 'not-in-a-game' });
        return;
      }
      try {
        const message = createChatMessage(binding.seat, payload.text, profanityFilter);
        broadcastChatMessage(room, socket.data.playerId, message);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof ChatError ? err.reason : 'unknown' });
      }
    });

    socket.on(
      'chat:mute',
      (payload: { mutedPlayerId: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
        void (async () => {
          try {
            await muteUser(prisma, socket.data.playerId, payload.mutedPlayerId);
            socket.data.mutedUserIds = await getMutedUserIds(prisma, socket.data.playerId);
            ack?.({ ok: true });
          } catch (err) {
            ack?.({ ok: false, error: err instanceof ChatError ? err.reason : 'unknown' });
          }
        })();
      },
    );

    socket.on('chat:unmute', (payload: { mutedPlayerId: string }, ack?: (res: { ok: boolean }) => void) => {
      void (async () => {
        await unmuteUser(prisma, socket.data.playerId, payload.mutedPlayerId);
        socket.data.mutedUserIds = await getMutedUserIds(prisma, socket.data.playerId);
        ack?.({ ok: true });
      })();
    });

    socket.on(
      'chat:report',
      (
        payload: { reportedPlayerId: string; message: string },
        ack?: (res: { ok: boolean; error?: string }) => void,
      ) => {
        void (async () => {
          const room = currentRoom(socket);
          if (!room) {
            ack?.({ ok: false, error: 'not-in-a-room' });
            return;
          }
          try {
            await fileReport(prisma, {
              reporterId: socket.data.playerId,
              reportedId: payload.reportedPlayerId,
              roomId: room.roomId,
              message: payload.message,
            });
            ack?.({ ok: true });
          } catch (err) {
            ack?.({ ok: false, error: err instanceof ChatError ? err.reason : 'unknown' });
          }
        })();
      },
    );
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
