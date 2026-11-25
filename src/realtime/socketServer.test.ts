import { createServer } from 'node:http';
import type { Server as HTTPServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createGuestSession } from '../auth/index.js';
import { prisma } from '../db/client.js';
import { resetDb } from '../db/testHelpers.js';
import type { PlayerView } from './projection.js';
import { DEFAULT_RATE_LIMITS } from './rateLimiter.js';
import type { RateLimitCategory, RateLimitConfig } from './rateLimiter.js';
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

async function createTestServer(
  turnTimeoutMs: number,
  rateLimits?: Readonly<Record<RateLimitCategory, RateLimitConfig>>,
  rateLimitMuteMs?: number,
): Promise<TestServer> {
  const httpServer = createServer();
  const realtime = attachSocketServer(httpServer, {
    turnTimeoutMs,
    prisma,
    jwtSecrets,
    ...(rateLimits ? { rateLimits } : {}),
    ...(rateLimitMuteMs === undefined ? {} : { rateLimitMuteMs }),
  });
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
    'removes the room from the repository once the game ends, so it is not kept forever in memory',
    async () => {
      const pool = new SocketPool();
      try {
        const guests = await Promise.all(
          Array.from({ length: 4 }, () => createGuestSession(prisma, jwtSecrets)),
        );
        const sockets = guests.map((g) => pool.connect(server.baseUrl, g.tokens.accessToken));

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
        expect(server.realtime.repository.get(roomId)).toBeDefined();

        // Disconnecting every real player while still in round 1 converts
        // all seats to bots (section 7); the server then plays the rest of
        // the game out instantly via the internal bot loop, exactly like the
        // chat-mute test below relies on for its own cleanup.
        pool.closeAll();

        await waitForParticipants('quick-play', 4);
        expect(server.realtime.repository.get(roomId)).toBeUndefined();
      } finally {
        pool.closeAll();
      }
    },
    15_000,
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

  it('kicks the previous connection with session:kicked when the same account connects a second time', async () => {
    const pool = new SocketPool();
    try {
      const guest = await createGuestSession(prisma, jwtSecrets);
      const firstSocket = pool.connect(server.baseUrl, guest.tokens.accessToken);
      await new Promise<void>((resolve) => firstSocket.on('connect', resolve));

      const kicked = new Promise<{ reason: string }>((resolve) => {
        firstSocket.once('session:kicked', resolve);
      });
      const firstDisconnected = new Promise<void>((resolve) => {
        firstSocket.once('disconnect', () => resolve());
      });

      const secondSocket = pool.connect(server.baseUrl, guest.tokens.accessToken);
      await new Promise<void>((resolve) => secondSocket.on('connect', resolve));

      expect((await kicked).reason).toBe('signed-in-elsewhere');
      await firstDisconnected;
      expect(firstSocket.connected).toBe(false);

      // The new connection stays fully usable.
      const ack = await new Promise<AckResponse>((resolve) => {
        secondSocket.emit('reclaim', { roomId: 'no-such-room' }, resolve);
      });
      expect(ack.ok).toBe(false);
      expect(secondSocket.connected).toBe(true);
    } finally {
      pool.closeAll();
    }
  });

  it(
    'disconnects a connection that floods chat:report past the warning',
    async () => {
      const floodServer = await createTestServer(SAFE_TURN_TIMEOUT_MS, {
        ...DEFAULT_RATE_LIMITS,
        'chat:report': { windowMs: 10_000, max: 2 },
      });
      const pool = new SocketPool();
      try {
        const guest = await createGuestSession(prisma, jwtSecrets);
        const socket = pool.connect(floodServer.baseUrl, guest.tokens.accessToken);
        await new Promise<void>((resolve) => socket.on('connect', resolve));

        const report = () => socket.emit('chat:report', { reportedPlayerId: 'someone', message: 'spam' });

        report(); // 1 - within budget
        report(); // 2 - within budget

        const warned = new Promise<{ event: string; action: string }>((resolve) => {
          socket.once('rate-limit', resolve);
        });
        report(); // 3 - over budget: warned, action still rejected
        expect((await warned).action).toBe('warning');

        const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
        report(); // 4 - flooding again after the warning: disconnected
        await disconnected;
        expect(socket.connected).toBe(false);
      } finally {
        pool.closeAll();
        await closeTestServer(floodServer);
      }
    },
    10_000,
  );

  it(
    'mutes (rather than disconnects) a connection that floods chat:send, and recovers once the mute expires',
    async () => {
      const floodServer = await createTestServer(
        SAFE_TURN_TIMEOUT_MS,
        { ...DEFAULT_RATE_LIMITS, 'chat:send': { windowMs: 200, max: 2 } },
        500, // short mute, just for this test, so it doesn't need to wait a real 60s
      );
      const pool = new SocketPool();
      try {
        const guest = await createGuestSession(prisma, jwtSecrets);
        const socket = pool.connect(floodServer.baseUrl, guest.tokens.accessToken);
        await new Promise<void>((resolve) => socket.on('connect', resolve));

        const chat = () =>
          new Promise<AckResponse>((resolve) => {
            socket.emit('chat:send', { text: 'spam' }, resolve);
          });

        await chat(); // 1 - within budget (rejected for an unrelated reason: not in a game)
        await chat(); // 2 - within budget

        const warned = new Promise<{ action: string }>((resolve) => socket.once('rate-limit', resolve));
        const thirdAck = await chat(); // 3 - over budget: warned
        expect(thirdAck.error).toBe('rate-limited');
        expect((await warned).action).toBe('warning');

        const muted = new Promise<{ action: string; durationMs: number }>((resolve) =>
          socket.once('rate-limit', resolve),
        );
        const fourthAck = await chat(); // 4 - flooding again: muted, not disconnected
        expect(fourthAck.error).toBe('rate-limited-muted');
        expect((await muted).action).toBe('muted');
        expect(socket.connected).toBe(true);

        const fifthAck = await chat(); // still muted
        expect(fifthAck.error).toBe('rate-limited-muted');

        await new Promise((resolve) => setTimeout(resolve, 600)); // past the mute duration

        const recoveredAck = await chat();
        expect(recoveredAck.error).not.toBe('rate-limited-muted');
        expect(recoveredAck.error).not.toBe('rate-limited');
      } finally {
        pool.closeAll();
        await closeTestServer(floodServer);
      }
    },
    10_000,
  );
});
