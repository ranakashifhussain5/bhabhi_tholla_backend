# Bhabhi Thulla Backend — Project Review

A full project audit: every module reviewed against [GAME_RULES.md](GAME_RULES.md)
and the test suite, bugs found were fixed and verified, and a complete inventory
of what the backend actually does. All 7 planned phases are complete at the
time of this review (see [plans/archive/backend-build.md](plans/archive/backend-build.md)
for the phase-by-phase build history and decision log).

**Verification at time of writing**: `tsc --noEmit` clean, `eslint .` clean (0
errors), `npm run build` succeeds, **194/194 tests passing** (re-run multiple
times for stability). Updated after follow-up hardening passes that turned
five of the judgment calls below into fixes (JWT secret strength/collision,
access/refresh token typing, chat message trimming, profanity word-boundary
matching, token revocation/single-session enforcement), plus retrying and
dead-lettering game-result writes on DB failure (see section 1 for details).

---

## 1. Bugs found and fixed in this review

### `src/realtime/matchmaking.ts` — duplicate-join seat corruption
`QuickPlayMatchmaker.join()` had no guard against the same `playerId` joining
the quick-play queue twice (e.g. a double-click on "find match"). A duplicate
entry would get assigned a second seat; the seat-lookup logic (first match
only) would then silently rebind the first seat's socket to the second
connection, orphaning the original connection in a dead seat forever. Fixed
with an idempotency check, matching the pattern already used in private rooms.
Covered by a new test.

### `src/realtime/projection.ts` — hand/turn data leaked as live references
The per-player view sent to clients (`buildPlayerView`) returned the engine's
*live* arrays (hand, turn order, plays) instead of copies — unlike every other
part of the engine, which always defensively copies before handing state out.
Any external mutation of an emitted view object (not currently exploited
anywhere, but a real footgun for future code) could have corrupted live game
state. Fixed to copy all three arrays.

### `src/realtime/socketServer.ts` — finished rooms never removed from memory (most significant)
`RoomRepository.delete()` existed but was never called anywhere. Every
finished game's full room object — the entire game state, every player's
hand, everything — stayed in the in-memory map **forever**. On a long-running
server this is an unbounded memory leak: it would grow for as long as the
process stayed up. Fixed by deleting the room once its result has been
persisted (success or failure). Verified this is safe — every socket handler
already copes with a room no longer existing. Covered by a new test asserting
the room is gone once a game ends.

### `src/auth/link.ts` — email-uniqueness race condition
Linking an email to an account checked "is this email taken?" and then wrote
the update as two separate steps (classic check-then-act). Two concurrent
link attempts for the same email could both pass the check before either
commits; the database's own unique constraint would still stop the second
one, but it surfaced as a raw, unhandled database error (leaking an internal
message as a generic 500) instead of the same clean "email already in use"
response every other path gives. Fixed by catching that specific database
error and converting it to the normal error. Covered by a new test that
fires both attempts concurrently.

### `src/realtime/socketServer.ts` — `chat:unmute` could hang forever
Every other socket event handler in this file wraps its database work in a
try/catch and always sends a response back to the client. `chat:unmute` was
the one exception: if the database call failed for any reason, the client
would simply never get a response — a silent hang instead of a clean failure
message. Fixed to match every sibling handler's pattern.

### `README.md` — dead link
Pointed at the build plan's old location (`plans/pending/`). The plan was
archived once all phases finished and now lives at `plans/archive/`. Fixed.

### `src/config.ts` — weak/colliding JWT secrets no longer boot
Raised the minimum secret length from 16 to 32 characters and added a check
that rejects `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` being set to the
same value - the app now fails to boot instead of silently letting a refresh
token also pass as an access token. Covered by new tests.

### `src/auth/jwt.ts` — access and refresh tokens are no longer interchangeable
Added a `typ` claim (`"access"` or `"refresh"`) to every signed token, and
`verifyToken` now takes the expected type and rejects a mismatch. Previously,
anyone holding both secrets (or exploiting the identical-secret case above)
could use a refresh token wherever an access token was expected, or vice
versa. Covered by new tests.

### `src/chat/messages.ts` — pure-whitespace messages now rejected
Chat text is trimmed before any validation, so a message that is only
whitespace is now rejected as empty instead of passing through. Covered by a
new test.

### `src/chat/profanityFilter.ts` — short words no longer match as substrings
Words at or under 3 characters (e.g. "mc", "bc") now only match as a whole
token, never as a substring inside a longer innocent word (e.g. "mcdonalds"
no longer gets flagged). Longer words still also match the collapsed
(spaces-removed) form, to keep catching spaced-out evasion like "f u c k".
Covered by new tests.

### `src/db/results.ts` — a failed game-result write is retried, then dead-lettered instead of lost
`persistGameResult` now retries a failed transaction up to 3 times with
exponential backoff before giving up. If every attempt still fails, the full
result snapshot is appended to a local dead-letter file (`src/db/deadLetter.ts`)
instead of being lost, and the error is still rethrown so the existing
caller-side logging fires. Covered by tests simulating both a transient
failure (retries then succeeds) and a total outage (dead-letters the
snapshot, nothing lands in the DB).

### Auth: token revocation and single-session enforcement
Added a `tokenVersion` column on `User`, embedded in every refresh token at
issuance. `/auth/link` bumps it whenever it sets or changes the password, so
every refresh token issued before that point stops working on its next
`/auth/refresh` call, even though its signature and expiry are both still
valid - the device making the change gets a fresh pair in the same response
so it isn't logged out by its own action. Access tokens are unaffected
(short-lived enough that the exposure window is bounded without a database
check on every request). Separately, a socket layer now allows only one
active connection per account - connecting a second time sends the first a
`session:kicked` event and disconnects it (this replaces the "reclaiming a
seat from a second device" judgment call below, which used to let the new
connection quietly take over). Covered by new tests at every layer (JWT
claim extraction, the DB version check, the REST round trip, and the socket
kick).

---

## 2. Reviewed and deliberately left alone

These were noticed but are judgment calls, not bugs — recorded here rather
than silently fixed, in case any of them matter for a future decision:

- **Docker / docker-compose.** Re-checked exhaustively: every environment
  variable name matches exactly across the Dockerfile, `docker-compose.yml`,
  `src/config.ts`, and `.env.example`; the build-stage placeholder database
  URL is correctly isolated from the runtime stage; the production image's
  dependencies match what the generated Prisma client actually imports at
  runtime. No defect found. Docker itself isn't installed on this machine, so
  an actual `docker compose up` still hasn't been run end to end — if a
  specific error ever shows up when it is, that's the thing to bring back for
  a precise fix, since nothing wrong could be found by reading alone.

---

## 3. Everything this backend does, by module

### `src/engine/` — the rules themselves
Pure game logic with no I/O, matching GAME_RULES.md sections 1–5 and 12:
- Builds and shuffles a 52-card deck using a cryptographically secure random
  generator (never `Math.random()` for anything that decides a real outcome).
- Deals all 52 cards fairly across 3–6 players, randomizing *which* seats get
  any extra cards when the deck doesn't divide evenly.
- Round 1: the Ace-of-Spades holder must lead it; everyone else must follow
  with a spade if they have one, or any non-Ace card if they don't.
  Everything is discarded; whoever played the highest spade starts round 2.
- Round 2 onward: whoever starts sets the suit everyone must follow. Anyone
  who can't follow may play anything — a "thulla" — which ends the round
  immediately and makes them (or rather, whoever played the highest card of
  the required suit) pick up everything on the table.
- Tracks when a player empties their hand (escapes), in what order, with the
  correct tie-break rules when several escape in the same round, and
  determines the Bhabhi (last-place finisher) including the final-round-tie
  case.
- A single move-validation entry point that is the only way any card can ever
  be played — it rejects illegal moves with a specific reason (wrong turn,
  card not in hand, breaks the active rule) so nothing downstream has to
  re-check legality.

### `src/bots/` — the AI
Decision-making used for actual bot seats, disconnected players, and anyone
who lets their 15-second turn timer run out (GAME_RULES.md section 9):
- Plays forced moves instantly (only one legal option).
- Dumps its highest card when it's safe to do so, plays low when a thulla
  looks likely (because a later player is already known to be out of the
  required suit), and always dumps its most dangerous card when forced into
  a thulla anyway.
- For the one genuinely hard decision — which card to lead a round with — runs
  a small Monte Carlo simulation: samples plausible hands for the other
  players (consistent with what's publicly known), plays out several
  what-if rounds, and picks whichever lead card comes out best on average.
- Never looks at another player's actual hand — only card counts and which
  suits a player has already revealed they're void in, exactly like a real
  player would know.

### `src/realtime/` — rooms, matchmaking, and the live connection
Everything that makes the game playable over a network:
- **Quick play**: a 4-player ranked queue that starts immediately once full,
  or after 30 seconds fills any empty seats with bots.
- **Private rooms**: a host creates a room, gets a 4-digit code and a share
  link, 3–6 friends join, only the host can start it, and it never
  auto-fills with bots.
- Drives every turn automatically for bot/disconnected/timed-out seats and
  pauses only when a real, connected player needs to act.
- A 15-second turn timer per move (now correctly cancelled everywhere it
  needs to be, including on server shutdown).
- Disconnect during a game hands that seat to the bot immediately; the real
  player can reclaim control later. A deliberate quit is permanent and
  cannot be reclaimed (and is flagged for the rank penalty).
- Sends each player only their own hand, plus everyone else's card counts —
  never another player's actual cards.
- Finished games are now correctly cleaned out of memory (the bug fixed
  above) instead of accumulating forever.

### `src/auth/` — identity
- New players get a usable account instantly with no signup step (a "guest"
  identity) and a pair of tokens (short-lived for normal use, long-lived for
  staying logged in).
- That guest account can later be upgraded with an email and password without
  losing any history or rank — and that link step is now safe even if it's
  attempted twice at the same moment (the race-condition fix above).
- Passwords are hashed securely; emails are treated case-insensitively so
  "Name@Example.com" and "name@example.com" are always the same account.

### `src/db/` — accounts, games, and rank
- Stores finished games and every player's result in one all-or-nothing
  database write.
- Computes rank points exactly per GAME_RULES.md section 10 (by finishing
  position, with a separate penalty for quitting on purpose), never letting
  points go below zero, and derives the Bronze→Master tier from the total.
- Talks to Postgres through the lightweight driver adapter rather than a
  separate database engine process, which is why the production container
  doesn't need to bundle one.

### `src/chat/` — in-game chat and moderation
- Free text plus three pre-approved quick phrases players can send instantly.
- A starter profanity filter covering English, Roman Urdu, and Urdu script
  (built to be swapped for a stronger one later without touching anything
  that calls it).
- Muting another player persists across reconnects and devices, and now
  reliably reports success or failure every time (the hanging-ack fix above).
- Reporting another player stores enough detail to review later, and links
  itself to the finished game's record once that exists.

### `src/app.ts` / `src/server.ts` — the HTTP side
- A small REST API: health check, create a guest account, refresh a session,
  link an account, log in.
- Every one of those endpoints is rate-limited so it can't be spammed or
  brute-forced.
- Starts and stops cleanly, including shutting down any in-flight game timers.

### Docker / deployment
- A multi-stage build that keeps the shipped image lean: the database CLI
  tooling and schema files used only at build time never make it into the
  final image.
- `docker-compose.yml` brings up the database and the app together for local
  use.

### `prisma/schema.prisma` — the data model
Users, Games, each player's per-game result, and Reports — with the
relationships between them (who played in what, who reported whom) all
correctly enforced by the database itself.

---

## 4. What's genuinely left for later

Nothing here is a bug — these are either explicitly out of scope per the
original plan, or open questions the game rules themselves never answered:

- Actually running `docker compose up` once Docker is available on a machine
  that has it.
- Revoking a stolen token before it naturally expires (tokens are stateless
  by design; there's no server-side "log everyone out" switch yet).
- A couple of small open questions GAME_RULES.md itself left unanswered
  (whether a bot-filled quick-play game should count for full rank points,
  whether a private room host should be able to add bots) — reasonable
  defaults were picked and documented, not left unresolved by accident.
