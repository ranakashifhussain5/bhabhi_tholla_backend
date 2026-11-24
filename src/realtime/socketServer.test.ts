import { createServer } from 'node:http';
import type { Server as HTTPServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createGuestSession } from '../auth/index.js';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
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
const jwtSecrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

async function waitForParticipants(mode: string, expectedCount: number, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const game = await prisma.game.findFirst({ where: { mode } });
    if (game) {
      const participants = await prisma.gameParticipant.findMany({ where: { gameId: game.id } });
      if (participants.length >= expectedCount) return participants;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${expectedCount} game participants for mode "${mode}" were not persisted in time`);
}

describe('socketServer integration (real socket.io-client)', () => {
  let httpServer: HTTPServer;
  let realtime: RealtimeServer;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    await resetDb();
    httpServer = createServer();
    realtime = attachSocketServer(httpServer, { turnTimeoutMs: TURN_TIMEOUT_MS, prisma, jwtSecrets });
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function connect(accessToken: string): ClientSocket {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: accessToken },
    });
    clients.push(socket);
    return socket;
  }

  it(
    'plays a full 4-player quick-play game end to end, including a forced timeout and a disconnect/reconnect',
    async () => {
      const guests = await Promise.all(
        Array.from({ length: 4 }, () => createGuestSession(prisma, jwtSecrets)),
      );
      const sockets = guests.map((g) => connect(g.tokens.accessToken));

      let roomId = '';
      await Promise.all(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.once('room:joined', (payload: JoinedPayload) => {
                roomId = payload.roomId;
                resolve();
              });
              socket.emit('quickplay:join');
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

            // Seat index 1 (the 2nd guest): skip exactly one turn to force the server's turn timer.
            if (index === 1 && timedOutSeat === -1) {
              timedOutSeat = view.viewerSeat;
              return;
            }

            // Seat index 0 (the 1st guest): disconnect once mid-game instead of playing, then reclaim.
            if (index === 0 && !aliceDisconnectedOnce && view.round && view.round.plays.length > 0) {
              aliceDisconnectedOnce = true;
              socket.disconnect();

              const reclaimSocket = connect(guests[0]!.tokens.accessToken);
              wireAutoPlayer(reclaimSocket, index);
              reclaimSocket.emit('reclaim', { roomId }, (res: AckResponse) => {
                expect(res.ok).toBe(true);
              });
              return;
            }

            socket.emit('play-card', { card: view.legalMoves[0] });
          });
        }

        sockets.forEach((socket, i) => wireAutoPlayer(socket, i));
      });

      expect(timedOutSeat).toBeGreaterThanOrEqual(0);
      expect(aliceDisconnectedOnce).toBe(true);

      // Phase 4 integration: the finished ranked game should have been
      // persisted. notify() fires the write without awaiting it (so the game
      // loop never blocks on DB I/O), and the 4 participant rows are written
      // in a sequential loop, so poll until all 4 have actually landed.
      const participants = await waitForParticipants('quick-play', 4);
      expect(participants).toHaveLength(4);
    },
    30_000,
  );

  it(
    "excludes a muted player's chat messages only from the muter's own stream",
    async () => {
      const [alice, bob, carol] = await Promise.all(
        Array.from({ length: 3 }, () => createGuestSession(prisma, jwtSecrets)),
      );
      const aliceSocket = connect(alice!.tokens.accessToken);
      const bobSocket = connect(bob!.tokens.accessToken);
      const carolSocket = connect(carol!.tokens.accessToken);

      const created = await new Promise<{ roomId: string; roomCode: string }>((resolve) => {
        aliceSocket.emit('privateroom:create', {}, resolve);
      });

      await Promise.all(
        [bobSocket, carolSocket].map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.emit('privateroom:join', { roomCode: created.roomCode }, (res: AckResponse) => {
                expect(res.ok).toBe(true);
                resolve();
              });
            }),
        ),
      );

      const gameStarted = Promise.all(
        [aliceSocket, bobSocket, carolSocket].map(
          (socket) => new Promise<void>((resolve) => socket.once('room:state', () => resolve())),
        ),
      );
      await new Promise<void>((resolve) => {
        aliceSocket.emit('privateroom:start', {}, (res: AckResponse) => {
          expect(res.ok).toBe(true);
          resolve();
        });
      });
      await gameStarted;

      await new Promise<void>((resolve) => {
        aliceSocket.emit('chat:mute', { mutedPlayerId: bob!.userId }, (res: AckResponse) => {
          expect(res.ok).toBe(true);
          resolve();
        });
      });

      let aliceReceivedMessage = false;
      aliceSocket.on('chat:message', () => {
        aliceReceivedMessage = true;
      });
      const carolReceived = new Promise<{ text: string }>((resolve) => {
        carolSocket.once('chat:message', resolve);
      });

      await new Promise<void>((resolve) => {
        bobSocket.emit('chat:send', { text: 'hello everyone' }, (res: AckResponse) => {
          expect(res.ok).toBe(true);
          resolve();
        });
      });

      const message = await carolReceived;
      expect(message.text).toBe('hello everyone');
      expect(aliceReceivedMessage).toBe(false);
    },
    15_000,
  );
});
