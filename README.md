# Bhabhi Thulla Backend

Server-authoritative backend for the Bhabhi Thulla card game. The game rules
in [GAME_RULES.md](GAME_RULES.md) are the source of truth for behavior; this
file covers how to run the project and the API/socket contract for building
a client against it.

## Stack

- Node.js 24, TypeScript (strict), ESM
- Fastify (REST) + Socket.IO (realtime)
- PostgreSQL via Prisma 7 (driver adapter / `@prisma/adapter-pg`, no native
  query engine binary needed at runtime)
- Vitest for tests

## Prerequisites

- Node.js 24+
- A PostgreSQL 17 database - either:
  - **Docker**: `docker compose up -d postgres` (recommended if you have Docker), or
  - **Native install**: point `DATABASE_URL` at it in `.env` (see below)

## Setup

```bash
npm install                      # also runs `prisma generate` via postinstall
cp .env.example .env              # fill in JWT secrets and DATABASE_URL
npm run db:migrate                # applies migrations to your database
npm run dev                       # starts the server with live reload
```

`npm run db:ping` checks that `DATABASE_URL` is reachable, independent of
whether Postgres is Dockerized or native.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | HTTP port (default 3000) |
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` | Signs short-lived (15m) access tokens - 32+ chars, must differ from `JWT_REFRESH_SECRET` |
| `JWT_REFRESH_SECRET` | Signs long-lived (30d) refresh tokens - 32+ chars, must differ from `JWT_ACCESS_SECRET` |

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Runs the server with `tsx watch` |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs the compiled server from `dist/` |
| `npm test` | Runs the full test suite (needs a reachable Postgres) |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:generate` | `prisma generate` (also runs automatically on `npm install`) |
| `npm run db:up` / `db:ping` | Start/check the Dockerized Postgres |

## Running with Docker

```bash
docker compose up --build
```

Brings up Postgres and the app together. The app reads `JWT_ACCESS_SECRET`
and `JWT_REFRESH_SECRET` from the host environment (falls back to insecure
dev-only defaults if unset - override these for anything beyond local
testing).

A one-shot `migrate` service runs `prisma migrate deploy` against `postgres`
and exits; `app` won't start until it completes successfully. The long-running
`app` image still deliberately doesn't bundle the `prisma` CLI or the
`prisma/` folder (keeps it lean - see the Dockerfile); only the separate
`migrate` build target has them.

## REST API

All bodies are JSON. Rate-limited per the table below (`429` once exceeded).

| Method & path | Body | Auth | Rate limit | Returns |
| --- | --- | --- | --- | --- |
| `GET /health` | - | no | 100/min | `{ status: "ok" }` |
| `POST /auth/guest` | - | no | 10/min | `{ userId, tokens: { accessToken, refreshToken } }` - new guest identity, no signup needed |
| `POST /auth/refresh` | `{ refreshToken }` | no | 20/min | `{ accessToken, refreshToken }` - rotates both |
| `POST /auth/link` | `{ email, password }` | `Authorization: Bearer <accessToken>` | 20/min | `{ ok: true, tokens: { accessToken, refreshToken } }` - upgrades the authenticated guest in place, or changes its password if already linked |
| `POST /auth/login` | `{ email, password }` | no | 10/min | `{ accessToken, refreshToken }` |

`password` must be 8-72 characters. Linking an email already in use returns
`409`; bad credentials return `401`.

### Sessions and token revocation

Every user has a `tokenVersion`, embedded in each refresh token issued to
them. `/auth/link` bumps it every time it sets or changes the password, which
immediately invalidates every refresh token issued before that call -
`/auth/refresh` checks the embedded version against the database and returns
`401` on a mismatch, even if the token's signature and expiry are still
valid. `/auth/link`'s own response carries a fresh pair under the new
version, so the device that just changed the password isn't logged out by
its own action. Access tokens don't carry or check this version - they're
short-lived (15m) enough that the exposure window is bounded without a
database lookup on every request.

Only one socket connection is allowed per account at a time: connecting a
second one disconnects the first (see `session:kicked` below).

### Flood control

`quickplay:join`, `privateroom:join`, `chat:send`, and `chat:report` are
rate-limited per connection. The first time a connection crosses a
category's limit, that action is rejected (ack: `{ ok: false, error:
"rate-limited" }`) and the server sends `rate-limit` with `{ event, action:
"warning" }`. Flooding again after the warning escalates: `chat:send` gets a
temporary mute (every further message rejected with `"rate-limited-muted"`
until it expires, `rate-limit`'s payload adds `durationMs`); every other
category disconnects the connection outright (ack error
`"rate-limited-disconnected"`, then `rate-limit` with `action:
"disconnected"`, then the socket is closed).

## Socket.IO contract

Connect with the access token in the handshake auth payload:

```js
io('https://your-server', { auth: { token: accessToken } });
```

A missing or invalid token rejects the connection (`connect_error`,
`"unauthorized"`). Every event below that takes an acknowledgement callback
responds with at least `{ ok: boolean, error?: string }`.

### Client → server

| Event | Payload | Notes |
| --- | --- | --- |
| `quickplay:join` | - | Joins the 4-player ranked queue; bot-fills after 30s if not full |
| `privateroom:create` | - | Ack: `{ roomId, roomCode, joinLink }` |
| `privateroom:join` | `{ roomCode }` | Ack: `{ ok, error? }` |
| `privateroom:start` | - | Host only, needs 3-6 players. Ack: `{ ok, error? }` |
| `play-card` | `{ card: { suit: "S"\|"H"\|"D"\|"C", rank: 2-14 } }` | Ack: `{ ok, error? }` - rejected moves include the engine's reason (`not-your-turn`, `card-not-in-hand`, `card-does-not-follow-rules`, etc.) |
| `reclaim` | `{ roomId }` | Takes control back from the bot after a disconnect |
| `quit` | - | Deliberate exit from a ranked game - applies the quit penalty instead of normal scoring, and cannot be reclaimed |
| `chat:send` | `{ text }` | Free text (filtered) or one of the fixed quick phrases (unfiltered) |
| `chat:mute` | `{ mutedPlayerId }` | Persists across reconnects |
| `chat:unmute` | `{ mutedPlayerId }` | |
| `chat:report` | `{ reportedPlayerId, message }` | Stored for review |

### Server → client

| Event | Payload |
| --- | --- |
| `room:joined` | `{ roomId, seat }` - sent once when a quick-play match is found |
| `room:state` | The player's view: own hand, everyone's card counts, round/turn state, `legalMoves` (only on your turn), `finishOrder`, `gameOver` - **never contains another player's hand** |
| `privateroom:lobby` | `{ pendingPlayerIds }` - broadcast to a private room's lobby as players join |
| `chat:message` | `{ seat, text, sentAt }` - never sent to a socket that has muted the sender |
| `session:kicked` | `{ reason: "signed-in-elsewhere" }` - sent to a connection right before the server disconnects it because the same account connected again elsewhere |
| `rate-limit` | `{ event, action: "warning" \| "muted" \| "disconnected", durationMs? }` - flood control on `event` (see below); `durationMs` is only present for `"muted"` |

### Quick phrases

`"Thulla laga!"`, `"Jaldi karo"`, `"Well played"` - sent via `chat:send` like
any other message, skip the profanity filter since they're pre-approved.

## Testing

```bash
npm test
```

Needs a reachable Postgres (same `DATABASE_URL` as the app). Test files run
sequentially (`fileParallelism: false` in `vitest.config.ts`) because several
share one real database and reset it between tests.

## Project layout

| Directory | Contents |
| --- | --- |
| `src/engine/` | Pure game rules - no I/O. The core of the project. |
| `src/bots/` | Bot decision-making (heuristics + a Monte Carlo rollout for the lead-card choice) |
| `src/realtime/` | Rooms, matchmaking, turn timers, the Socket.IO wiring |
| `src/auth/` | Guest identity, JWT issuing/verification, email/password linking |
| `src/db/` | Prisma client, rank/tier math, game-result persistence |
| `src/chat/` | Messages, profanity filter, mute, reports |
| `prisma/` | Schema and migrations |

See `plans/archive/backend-build.md` for the phase-by-phase build plan and
decision log.
