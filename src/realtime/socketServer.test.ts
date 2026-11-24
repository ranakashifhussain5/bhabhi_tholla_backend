import { createServer } from 'node:http';
import type { Server as HTTPServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { PlayerView } from './projection.js';
import { attachSocketServer } from './socketServer.js';
import type { RealtimeServer } from './socketServer.js';

interface JoinedPayload {
  roomId: string;
  seat: number;
}

interface AckResponse {
  ok: boolean;
  error?: string;
}

const TURN_TIMEOUT_MS = 300;

describe('socketServer integration (real socket.io-client)', () => {
  let httpServer: HTTPServer;
  let realtime: RealtimeServer;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    realtime = attachSocketServer(httpServer, { turnTimeoutMs: TURN_TIMEOUT_MS });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await realtime.io.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  function connect(): ClientSocket {
    const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    return socket;
  }

  it(
    'plays a full 4-player quick-play game end to end, including a forced timeout and a disconnect/reconnect',
    async () => {
      const playerIds = ['alice', 'bob', 'carol', 'dave'];
      const sockets = playerIds.map(() => connect());

      let roomId = '';
      await Promise.all(
        sockets.map(
          (socket, i) =>
            new Promise<void>((resolve) => {
              socket.once('room:joined', (payload: JoinedPayload) => {
                roomId = payload.roomId;
                resolve();
              });
              socket.emit('quickplay:join', { playerId: playerIds[i] });
            }),
        ),
      );
      expect(roomId).not.toBe('');

      let timedOutSeat = -1;
      let aliceDisconnectedOnce = false;
      let gameOverResolved = false;

      await new Promise<void>((resolveGameOver) => {
        function finishIfGameOver(view: PlayerView): boolean {
          if (!view.gameOver) return false;
          if (!gameOverResolved) {
            gameOverResolved = true;
            resolveGameOver();
          }
          return true;
        }

        function wireAutoPlayer(socket: ClientSocket, index: number): void {
          socket.on('room:state', (view: PlayerView) => {
            if (finishIfGameOver(view)) return;
            if (!view.yourTurn || view.legalMoves.length === 0) return;

            // Seat index 1 (bob): skip exactly one turn to force the server's turn timer.
            if (index === 1 && timedOutSeat === -1) {
              timedOutSeat = view.viewerSeat;
              return;
            }

            // Seat index 0 (alice): disconnect once mid-game instead of playing, then reclaim her seat.
            if (index === 0 && !aliceDisconnectedOnce && view.round && view.round.plays.length > 0) {
              aliceDisconnectedOnce = true;
              socket.disconnect();

              const reclaimSocket = connect();
              wireAutoPlayer(reclaimSocket, index);
              reclaimSocket.emit(
                'reclaim',
                { roomId, playerId: 'alice' },
                (res: AckResponse) => {
                  expect(res.ok).toBe(true);
                },
              );
              return;
            }

            socket.emit('play-card', { card: view.legalMoves[0] });
          });
        }

        sockets.forEach((socket, i) => wireAutoPlayer(socket, i));
      });

      expect(timedOutSeat).toBeGreaterThanOrEqual(0);
      expect(aliceDisconnectedOnce).toBe(true);
    },
    30_000,
  );
});
