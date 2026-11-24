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

// Long enough to never fire within a test's lifetime by accident: a test
// whose own async setup is slow risks backlogged setTimeout turn timers all
// firing in a burst the moment it finally goes idle, silently auto-playing
// an entire game in the background. Only the one test that specifically
// exercises the forced-timeout path gets its own short-timeout server.
const SAFE_TURN_TIMEOUT_MS = 60_000;
const SHORT_TURN_TIMEOUT_MS = 300;
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

interface TestServer {
  httpServer: HTTPServer;
  realtime: RealtimeServer;
  baseUrl: string;
}

async function createTestServer(turnTimeoutMs: number): Promise<TestServer> {
  const httpServer = createServer();
  const realtime = attachSocketServer(httpServer, { turnTimeoutMs, prisma, jwtSecrets });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const { port } = httpServer.address() as AddressInfo;
  return { httpServer, realtime, baseUrl: `http://localhost:${port}` };
}

async function closeTestServer(server: TestServer): Promise<void> {
  server.realtime.shutdown();
  await server.realtime.io.close();
  await new Promise<void>((resolve) => {
    server.httpServer.close(() => resolve());
  });
}

/**
 * Each test owns its own socket list and closes it itself, rather than
 * sharing one array across the whole describe block via an outer afterEach:
 * with async hooks, a later test's sockets can already exist in a shared
 * array by the time an earlier test's afterEach runs its closing loop,
 * closing connections that belong to a completely different test's room.
 */
class SocketPool {
  private readonly clients: ClientSocket[] = [];

  connect(baseUrl: string, accessToken: string): ClientSocket {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: accessToken },
    });
    this.clients.push(socket);
    return socket;
  }

  closeAll(): void {
    for (const client of this.clients) client.close();
    this.clients.length = 0;
  }
}

describe('socketServer integration (real socket.io-client)', () => {
  let server: TestServer;

  beforeEach(async () => {
    await resetDb();
    server = await createTestServer(SAFE_TURN_TIMEOUT_MS);
  });

  afterEach(async () => {
    await closeTestServer(server);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'plays a full 4-player quick-play game end to end, including a forced timeout and a disconnect/reconnect',
    async () => {
      // This test specifically exercises the forced-timeout path, so it needs
      // its own dedicated short-timeout server instead of the shared one.
      const shortServer = await createTestServer(SHORT_TURN_TIMEOUT_MS);
      const pool = new SocketPool();
      try {
        const guests = await Promise.all(
          Array.from({ length: 4 }, () => createGuestSession(prisma, jwtSecrets)),
        );
        const sockets = guests.map((g) => pool.connect(shortServer.baseUrl, g.tokens.accessToken));

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

                const reclaimSocket = pool.connect(shortServer.baseUrl, guests[0]!.tokens.accessToken);
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
      } finally {
        pool.closeAll();
        await closeTestServer(shortServer);
      }
    },
    30_000,
  );

  it(
    "excludes a muted player's chat messages only from the muter's own stream",
    async () => {
      const pool = new SocketPool();
      try {
        const [alice, bob, carol] = await Promise.all(
          Array.from({ length: 3 }, () => createGuestSession(prisma, jwtSecrets)),
        );
        const aliceSocket = pool.connect(server.baseUrl, alice!.tokens.accessToken);
        const bobSocket = pool.connect(server.baseUrl, bob!.tokens.accessToken);
        const carolSocket = pool.connect(server.baseUrl, carol!.tokens.accessToken);

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
      } finally {
        pool.closeAll();
      }

      // Closing the sockets disconnects all 3 seats; since it's still round
      // 1, each disconnect converts that seat to a bot (correct product
      // behavior - section 7), and once all three are bots the server plays
      // the rest of the game out instantly via the internal bot loop. Wait
      // for that triggered persistence to land before this test ends, so it
      // can't race the next test's db reset.
      await waitForParticipants('private', 3);
    },
    15_000,
  );

  it('rejects malformed socket payloads cleanly instead of crashing the connection', async () => {
    const pool = new SocketPool();
    try {
      const guest = await createGuestSession(prisma, jwtSecrets);
      const socket = pool.connect(server.baseUrl, guest.tokens.accessToken);
      await new Promise<void>((resolve) => socket.on('connect', resolve));

      const playCardResult = await new Promise<AckResponse>((resolve) => {
        socket.emit('play-card', { card: { suit: 'NOT-A-SUIT', rank: 'also-not-a-number' } }, resolve);
      });
      expect(playCardResult.ok).toBe(false);
      expect(playCardResult.error).toBe('invalid-payload');

      const chatResult = await new Promise<AckResponse>((resolve) => {
        socket.emit('chat:send', { text: 12345 }, resolve);
      });
      expect(chatResult.ok).toBe(false);
      expect(chatResult.error).toBe('invalid-payload');

      // The connection itself must still be alive and usable after both rejections.
      const stillConnected = await new Promise<boolean>((resolve) => {
        socket.emit('reclaim', { roomId: 'no-such-room' }, (res: AckResponse) => resolve(res.ok === false));
      });
      expect(stillConnected).toBe(true);
      expect(socket.connected).toBe(true);
    } finally {
      pool.closeAll();
    }
  });
});
