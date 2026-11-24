# Bhabhi Thulla Backend — Phased Build Plan
Source of truth for rules: [GAME_RULES.md](../../GAME_RULES.md)

Goal: a server-authoritative, future-proof backend for the Bhabhi Thulla card game,
built in clean phases so each layer is solid before the next depends on it.

## Decision log

| Decision | Chosen option | Why |
| --- | --- | --- |
| Language | TypeScript, strict mode | User choice. Game rules have many stateful edge cases (thulla pickup, escape ordering, Bhabhi tie-breaks) — types catch mistakes in that logic before a live game does. |
| Database | PostgreSQL + Prisma | User choice. Users/games/positions/reports are relational; rank/leaderboard queries and transactional result-writes fit Postgres better than a document store. |
| Auth | Guest-first identity, link account later | User choice. No signup friction before first game; same user row gets upgraded when they link email/phone/Google later. |
| Client contract | Designed from scratch, no existing client to match | User choice. REST + socket contract is ours to shape cleanly; must be documented for whoever builds the client next. |
| API framework | Fastify | Not asked (low-stakes, reversible). Native TS support, built-in schema validation, shares one HTTP server cleanly with Socket.IO. |
| Realtime transport | Socket.IO | Not asked. Built-in room primitives, reconnection support, and a clean path to a Redis adapter later if horizontal scaling is ever needed — fits the disconnect/reconnect/bot-takeover rules (section 7) directly. |
| Test runner | Vitest | Not asked. Fast, native ESM/TS, no extra config burden. |
| Game/room state storage | In-memory (Map-based), behind a `RoomRepository` interface | Avoids introducing Redis before there's an actual multi-instance need. The interface seam means swapping to Redis later touches one module, not the engine or realtime logic. |
| Package manager | npm | Already implied by the existing `package.json`; no reason to switch. |
| Version control | Initialize git now (Phase 0) | Project has no repo yet; needed for any reasonable workflow. |
| Prisma CLI version | Pinned to stable 7.10.1, not 8.x | Not asked. `npm install prisma` grabbed `8.0.0-rc.35` because the registry's `latest` tag points at a pre-release; `@prisma/client`'s own `latest` is still 7.10.1. Riding a release candidate for the ORM is an avoidable risk for a project meant to be stable, so pinned the CLI to match the client's stable line. Prisma 7 also changed its own client architecture (generates `.ts` source into a project folder via a driver adapter, e.g. `@prisma/adapter-pg`, instead of the old `node_modules/@prisma/client` + implicit `datasource.url` model) — adopted that new model since it's what the current stable release actually does. |
| JWT library | `jose` | Not asked. ESM-native, actively maintained, no native bindings. |
| Password hashing | Node's built-in `crypto.scrypt`, no extra dependency | Not asked. Well-vetted, avoids `bcrypt`'s native-compilation friction on Windows and an extra dependency for something Node already does securely. |

## Always / Never

- **Always**: every move is validated server-side (correct turn, card in hand, follows the rule in effect); shuffle uses a CSPRNG; a client only ever receives its own hand plus public table state and other players' card counts, never their hands; bots decide using only information a human in that seat would have.
- **Never** (this plan): build the actual client app (web/mobile) — backend only; implement payments/monetization; implement a friends system, seasons/rank-reset, or multi-language content — these are listed as open/undecided in GAME_RULES.md and stay out of scope until explicitly requested.

## Phases

### Phase 0: Project foundation
Verified when: `npm run build && npm test` pass on an empty/trivial suite, and a running server answers `GET /health` with 200.
Files to touch: `package.json`, `tsconfig.json`, `.eslintrc*`, `.gitignore`, `docker-compose.yml`, `src/config.ts`, `src/server.ts`, `.env.example`

#### Step 0.1: Git + tooling scaffold (Size: S)
- Acceptance criteria: git repo initialized with sensible `.gitignore`; TypeScript strict config; ESLint+Prettier configured; Vitest configured and runnable.
- Verification command: `npm run lint && npm test`
- Files likely touched: `.gitignore`, `tsconfig.json`, `.eslintrc.cjs`, `vitest.config.ts`, `package.json`
- Test seams: a trivial smoke test (`1+1`) to prove the runner works
- Blocked by: none

#### Step 0.2: Env config + Docker Compose for Postgres (Size: S)
- Acceptance criteria: `docker-compose up` starts a local Postgres; `.env.example` documents required vars; a validated config loader (zod) fails fast on missing/invalid env vars.
- Verification command: `docker-compose up -d && npm run db:ping` (small script connecting once)
- Files likely touched: `docker-compose.yml`, `.env.example`, `src/config.ts`
- Test seams: unit test that config loader rejects a missing required var
- Blocked by: 0.1

#### Step 0.3: Fastify server skeleton + health check (Size: S)
- Acceptance criteria: Fastify app boots on configured port; `GET /health` returns `{status:"ok"}`; graceful shutdown on SIGINT/SIGTERM.
- Verification command: `npm run dev` then `curl localhost:PORT/health`
- Files likely touched: `src/server.ts`, `src/app.ts`
- Test seams: integration test hitting `/health` via Fastify's `.inject()`
- Blocked by: 0.1

### Phase 1: Core game engine (pure logic, no I/O)
Verified when: the full unit test suite for every rule in GAME_RULES.md sections 1–5 passes, including every edge case named in the doc.
Files to touch: `src/engine/**`

This is the highest-risk, highest-value phase — it's the actual game, and it has zero
dependencies on anything else, so it goes first and gets the deepest test coverage.

#### Step 1.1: Deck, shuffle, deal (Size: S)
- Acceptance criteria: CSPRNG shuffle (`crypto.randomInt`-based Fisher-Yates); deals all 52 cards for 3–6 players with random distribution of extra cards; always includes exactly one Ace of Spades holder.
- Verification command: `npm test -- engine/deal`
- Files likely touched: `src/engine/deck.ts`, `src/engine/deal.ts`
- Test seams: unit tests asserting card-count distribution and uniqueness across thousands of seeded runs
- Blocked by: 0.1

#### Step 1.2: First-round rules (Size: S)
- Acceptance criteria: AS holder must lead AS; must-follow-spade enforced; no-spade players may play any non-Ace; no thulla in round 1 (always discarded); highest spade starts round 2.
- Verification command: `npm test -- engine/firstRound`
- Files likely touched: `src/engine/firstRound.ts`
- Test seams: unit tests per bullet in GAME_RULES.md section 2, including the doc's own "cannot happen" assertion as a thrown error if ever violated
- Blocked by: 1.1

#### Step 1.3: Normal-round rules (led suit, thulla, pickup) (Size: M)
- Acceptance criteria: led suit set by starter's card; must-follow-led-suit enforced when held; thulla ends round immediately and remaining players don't play; no-thulla discards, thulla causes pickup by highest led-suit card; correct next-round starter in both cases.
- Verification command: `npm test -- engine/normalRound`
- Files likely touched: `src/engine/normalRound.ts`
- Test seams: unit tests per GAME_RULES.md section 3, including a thulla occurring on the very first follower (others never get to act)
- Blocked by: 1.1

#### Step 1.4: Escapes, finishing order, Bhabhi (Size: M)
- Acceptance criteria: empty-hand detection only at round resolution (not mid-round); thulla-card-as-last-card does not count as pickup; same-round multi-escape ordered by lower card = better position; final-round tie resolved by highest card = Bhabhi, rest ordered lowest-card-first; starter-has-escaped skip-to-next-with-cards (section 5).
- Verification command: `npm test -- engine/finish`
- Files likely touched: `src/engine/finish.ts`
- Test seams: unit tests for every bullet in GAME_RULES.md sections 4–5, especially the two tie-break rules
- Blocked by: 1.2, 1.3

#### Step 1.5: Move validator + engine facade (Size: S)
- Acceptance criteria: single `applyMove(state, playerId, card)` entry point that rejects illegal moves with a specific reason (wrong turn, card not in hand, rule violation) and otherwise returns `{state, events}`; `events` fully describe what happened (discard/pickup/escape/game-end) so callers never need to re-derive logic.
- Verification command: `npm test -- engine/validator`
- Files likely touched: `src/engine/index.ts`, `src/engine/validate.ts`
- Test seams: unit tests asserting rejection reasons for each illegal-move class
- Blocked by: 1.2, 1.3, 1.4

### Phase 2: Bot AI
Verified when: a simulation running many full bot-vs-bot games completes with zero illegal moves and zero crashes.
Files to touch: `src/bots/**`

#### Step 2.1: Bot decision engine (Size: M)
- Acceptance criteria: bot reads only its own hand, table state, discard/pickup history, card counts, and suits it has seen others go void in (never other hands); applies section 9 heuristics (dump high cards safely, avoid being highest under thulla risk, dump dangerous cards via thulla, track opponents' void suits); always returns a move the Phase 1 validator accepts.
- Verification command: `npm test -- bots/simulate`
- Files likely touched: `src/bots/decide.ts`, `src/bots/knowledge.ts`
- Test seams: a simulation test harness running N full random games of all-bot seats, asserting the validator never rejects a bot move
- Blocked by: 1.5

#### Step 2.2: Shared bot entry point for timeout/disconnect (Size: XS)
- Acceptance criteria: one function bots, 15s-timeout auto-play, and disconnect takeover all call — no duplicated decision logic.
- Verification command: `npm test -- bots/entrypoint`
- Files likely touched: `src/bots/index.ts`
- Test seams: unit test asserting the realtime layer's timeout/disconnect paths (stubbed) call this single function
- Blocked by: 2.1

### Phase 3: Realtime orchestration (rooms, matchmaking, timers, reconnect)
Verified when: an integration test using a real `socket.io-client` plays a full 4-player quick-play game end to end, including one forced timeout and one forced disconnect/reconnect.
Files to touch: `src/realtime/**`

#### Step 3.1: Room abstraction + RoomRepository interface (Size: M)
- Acceptance criteria: a `Room` wraps one engine `GameState` plus seat/socket bindings; `RoomRepository` interface has an in-memory implementation only (Redis explicitly deferred, see decision log).
- Verification command: `npm test -- realtime/room`
- Files likely touched: `src/realtime/room.ts`, `src/realtime/roomRepository.ts`
- Test seams: unit tests on room creation/seat assignment against the in-memory repo
- Blocked by: 1.5

#### Step 3.2: Turn timer + bot/timeout takeover (Size: S)
- Acceptance criteria: each turn has a 15s timer; on expiry the shared bot entry point (2.2) plays for the player; timer is cancelled correctly on a real move.
- Verification command: `npm test -- realtime/timer`
- Files likely touched: `src/realtime/turnTimer.ts`
- Test seams: timer-mocked unit test asserting exactly one auto-play on expiry, zero on a timely real move
- Blocked by: 3.1, 2.2

#### Step 3.3: Quick play matchmaking (Size: S)
- Acceptance criteria: 4-seat queue; if not full within 30s, empty seats bot-filled and game starts; always affects rank (flag carried on the room).
- Verification command: `npm test -- realtime/matchmaking`
- Files likely touched: `src/realtime/matchmaking.ts`
- Test seams: timer-mocked test asserting bot-fill fires at exactly 30s, not before
- Blocked by: 3.1, 2.2

#### Step 3.4: Private rooms (code + share link) (Size: S)
- Acceptance criteria: host creates a room, gets a short room code and a shareable join link; 3–6 players; never affects rank; single game per room code for now (doc marks multi-game-per-room as an open decision — default is one game, host can open a new room for the next).
- Verification command: `npm test -- realtime/privateRoom`
- Files likely touched: `src/realtime/privateRoom.ts`
- Test seams: integration test for create → join by code → join by link → start
- Blocked by: 3.1

#### Step 3.5: Disconnect / resume / per-player state projection (Size: M)
- Acceptance criteria: on disconnect, bot takes over immediately and keeps playing; result still records to the disconnected player's profile; on return, app-open flow offers "continue previous game" (reclaim control) vs "new game" (bot keeps the old game going); every socket event payload contains only that player's own hand plus public state and card counts for others — never another hand.
- Verification command: `npm test -- realtime/reconnect`
- Files likely touched: `src/realtime/session.ts`, `src/realtime/projection.ts`
- Test seams: integration test forcing a disconnect mid-game, asserting bot takeover, then reconnecting and asserting both reclaim paths; a projection unit test asserting no other-hand leakage in any emitted payload
- Blocked by: 3.2, 3.3, 3.4

### Phase 4: Accounts, persistence & rank
Verified when: an integration test runs a simulated ranked game to completion and the DB rows plus rank-point math match GAME_RULES.md section 10 for every finishing position, including a voluntary-quit case.
Files to touch: `prisma/schema.prisma`, `src/db/**`, `src/auth/**`

#### Step 4.1: Prisma schema + migration (Size: M)
- Acceptance criteria: `User` (guest-capable, linkable identity), `Game`, `GameParticipant` (position, points delta), `Report` tables; rank points and tier are derived/stored per user.
- Verification command: `npx prisma migrate dev && npx prisma validate`
- Files likely touched: `prisma/schema.prisma`
- Test seams: migration applies cleanly against the Phase 0 Postgres container
- Blocked by: 0.2

#### Step 4.2: Guest identity + JWT auth (Size: M)
- Acceptance criteria: first contact issues a device-bound guest `User` row + access/refresh JWT pair; an account-linking endpoint (email/password) upgrades the same row without losing history.
- Verification command: `npm test -- auth`
- Files likely touched: `src/auth/guest.ts`, `src/auth/jwt.ts`, `src/auth/link.ts`
- Test seams: integration test: guest issue → play games → link email → history intact
- Blocked by: 4.1

#### Step 4.3: Result persistence + rank/tier calculation (Size: M)
- Acceptance criteria: game result written once at game end; rank delta per the section 10 table applied and clamped at 0; tier derived from the section 10 ranges; voluntary quit during a ranked game applies the -40 penalty instead of position scoring.
- Verification command: `npm test -- db/rank`
- Files likely touched: `src/db/results.ts`, `src/db/rank.ts`
- Test seams: integration test covering all four finishing positions plus the quit path in one simulated game
- Blocked by: 3.5, 4.2

### Phase 5: Chat & moderation
Verified when: unit tests on the profanity filter pass against a seeded word list, and an integration test shows a muted player's messages are excluded only from the muter's own stream.
Files to touch: `src/chat/**`

#### Step 5.1: Chat messaging + quick phrases (Size: S)
- Acceptance criteria: free text, a fixed quick-phrase set, emoji passthrough, all delivered over the existing room socket channel.
- Verification command: `npm test -- chat/messages`
- Files likely touched: `src/chat/messages.ts`
- Blocked by: 3.1

#### Step 5.2: Profanity filter (EN/UR/Roman Urdu) (Size: S)
- Acceptance criteria: wordlist-based filter catches English, Urdu, and Roman Urdu profanity; swappable implementation behind an interface so it can be upgraded later.
- Verification command: `npm test -- chat/filter`
- Files likely touched: `src/chat/profanityFilter.ts`
- Blocked by: 5.1

#### Step 5.3: Mute + report (Size: S)
- Acceptance criteria: mute hides a player's messages for the muter only (server-side preference, persists across reconnects); report is stored with enough context for later review.
- Verification command: `npm test -- chat/moderation`
- Files likely touched: `src/chat/mute.ts`, `src/chat/report.ts`, prisma `Report` model (4.1)
- Blocked by: 5.1, 4.1

### Phase 6: Hardening & ops readiness
Verified when: the full test suite is green, `/code-review` / security-review pass finds no open criticals, and `docker-compose up` brings up the full stack (app + Postgres) from a clean checkout.
Files to touch: `Dockerfile`, `docker-compose.yml`, `src/**` (hardening touch-ups), `README.md`

#### Step 6.1: Security pass (Size: M)
- Acceptance criteria: rate limiting on auth/matchmaking endpoints; zod validation on every REST body and socket event payload; confirm CSPRNG used for all randomness (shuffle, room codes); confirm no hand data ever reaches the wrong socket (re-check 3.5's projection tests).
- Verification command: `/code-review` (security-and-hardening pass) + `npm test`
- Blocked by: 4.3, 5.3

#### Step 6.2: Logging, Dockerfile, docs (Size: S)
- Acceptance criteria: structured logs for game start/end, disconnects, errors; production Dockerfile; README with run instructions and the REST/socket contract documented for a future client.
- Verification command: `docker-compose up` from a clean checkout reaches a working `/health`
- Blocked by: 6.1

## Open environment gap

- **Resolved**: Docker is still not installed on the dev machine, but PostgreSQL 19 is now
  installed natively (Windows service `postgresql-x64-19`, listening on port 5432).
  `.env` (gitignored) points `DATABASE_URL` at it with a `bhabhi_tholla` database already
  created. `npm run db:ping` was changed from a `docker compose exec` call to a small
  cross-platform script (`scripts/db-ping.mjs`) that checks reachability via `DATABASE_URL`
  directly, so it works the same whether Postgres is native or Dockerized — verified
  working. `docker-compose.yml` is kept as-is for anyone who prefers Docker later (e.g. CI
  or another dev's machine); it's just not this machine's path. Phase 4 is unblocked.

## Not yet specified (fog — resolve when that phase is picked up)

- **Phase 4**: which additional identity providers (phone+OTP, Google) to add beyond email/password linking, and which SMS provider if phone+OTP is added later.
- **Phase 4**: whether bot-filled quick-play games award full or reduced rank points (GAME_RULES.md open decision) — default assumption going in is **full points**, tunable later.
- **Phase 3/6**: whether/when to introduce Redis for horizontal scaling — only relevant once there's an actual multi-instance deployment need; the `RoomRepository` seam exists so this doesn't require touching engine/bot code.
- **Phase 6**: deployment target (VPS vs managed cloud, e.g. Render/Railway/AWS) — ask when this phase is reached.
- **Phase 3**: whether a private-room host can add bots to empty seats (GAME_RULES.md open decision) — default assumption is **no bot-fill in private rooms** for now.

## Progress

| Phase | Status |
| --- | --- |
| 0: Project foundation | Done — git/TS/ESLint/Prettier/Vitest/Fastify all verified green, including a live Postgres connectivity check (see Open environment gap note: native install, not Docker). |
| 1: Core game engine | Done — deck/deal, first round, normal round, finish/escape/Bhabhi logic, move validator facade. 47 tests passing (unit + a 100-game random-move simulation across 3-6 players, re-run 5x for flakiness, all stable). |
| 2: Bot AI | Done — heuristics for forced/safe/risky/thulla-dump decisions (section 9), plus a Monte Carlo rollout for the one genuinely ambiguous decision (which card to lead with as round-starter). Shared `decideMove` entry point used for bot seats, timeouts, and disconnects alike - no separate wrapper needed since there's only one function. 20 tests, including a full bot-vs-bot simulation across 3-6 players (stable across repeated runs). Caught and fixed a real bug during this phase: a picked-up thulla pile was wrongly tracked as "permanently discarded," starving the opponent-hand sampler. |
| 3: Realtime orchestration | Done - room/repository/timer/matchmaking/private-room/projection logic, all unit-tested (no sockets needed), plus a thin Socket.IO wiring layer on top. Integration test with a real socket.io-client plays a full 4-player quick-play game end to end including a forced timeout and a disconnect/reclaim, re-run 6x with no flakiness. Verified live against the actual running server too (`npm run dev` + a real client), not just the test harness. Added a `legalMoves` field to the player projection beyond the original plan - needed for any real client to know what it can play, and made the integration test possible without duplicating rule logic in the test itself. Known gap (flagged in code, to close in Phase 6): `playerId` is client-supplied with no real auth yet. |
| 4: Accounts, persistence & rank | Done - Prisma schema (User/Game/GameParticipant/Report) migrated to the local Postgres; guest identity + JWT auth (jose) with email/password linking and login; scrypt password hashing (no extra dependency); rank/tier math matching section 10 exactly, including the quit penalty; persistGameResult wired into the realtime layer's notify() so a finished game is recorded automatically. Closed the Phase 3 "known gap": socket connections now require a verified access token (Socket.IO `io.use` middleware) instead of a trusted client-supplied playerId string - verified live both ways (valid token connects, invalid token gets connect_error). 139 tests total; hit and fixed a real cross-file DB test race (parallel test files sharing one Postgres instance) by disabling vitest file parallelism. |
| 5: Chat & moderation | Done - free text + fixed quick phrases (section 11) over the existing room socket channel; wordlist profanity filter for English/Roman Urdu/Urdu script behind a swappable `ProfanityFilter` interface; mute is DB-backed (new `Mute` table, not in the original file list - needed because "persists across reconnects" requires it) and excludes a muted player's messages only from the muter's own stream, verified with a real 3-player private-room socket test; report reuses the Phase 4 `Report` model with a new `roomId` field, since a live game has no `Game` row yet - persistGameResult backfills `gameId` once the game ends. 162 tests total. |
| 6: Hardening & ops | Done - rate limiting on auth endpoints (@fastify/rate-limit, found and fixed a plugin-registration-order bug along the way), zod validation on every socket event payload, structured logging for game start/end/disconnect/errors wired through Fastify's own pino logger, graceful shutdown that actually cancels pending turn timers (a real gap - plain setTimeout outlives server.close()), production Dockerfile (driver-adapter Prisma needs no native engine binary at runtime, validated by running the compiled app with only production deps installed, outside Docker since Docker isn't installed on this machine), docker-compose now brings up app+Postgres together, README with the full REST/socket contract. Also closed the 4 deferred Phase 4 fixes (email case-folding, atomic rank updates, transactional persistence, password length cap) before starting this phase's own work. 167 tests, full suite re-run clean multiple times. **Not independently verified**: the actual `docker build`/`docker-compose up` (no Docker on this machine) - the Dockerfile's core assumption (no engine binary needed with the driver adapter) was validated by simulating the production-dependency install and running the compiled server against it directly, but the container build itself needs a real Docker test before trusting it blindly. |
