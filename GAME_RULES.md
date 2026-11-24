# Bhabhi Thulla: Game Rules (source of truth)

This file is the single source of truth for game rules and product behaviour.
The server must enforce every rule here. The client only displays state and sends the player's chosen card.

---

## 1. Cards and players

- One standard deck, 52 cards, no jokers.
- Suits: Spades (S), Hearts (H), Diamonds (D), Clubs (C). No suit is stronger than another.
- Rank order, low to high: 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A.
- Quick play: always **4 players**.
- Private room: **3 to 6 players**.
- All 52 cards are dealt. With 3, 5 or 6 players some players get one extra card. Who gets the extra cards is random.
- Turn order is clockwise by seat.

## 2. First round (first trick)

1. The player holding the **Ace of Spades (AS)** starts and must play AS.
2. Every other player, in turn order:
   - If they have any spade, they **must play a spade**.
   - If they have no spade, they may play **any card except an Ace**.
3. There is **no thulla** in the first round. All cards played are removed from the game (discarded).
4. The player who played the **highest spade** starts the second round.

Note: a player with no spades and only Aces cannot happen in the first round. The smallest possible hand is 8 cards (52 / 6) and there are only 3 non-spade Aces. The server should still assert this and fail loudly if it ever happens.

## 3. Normal rounds (second round onwards)

1. The round's starting player plays any card from their hand. Its suit becomes the **led suit**.
2. Each next player in turn order:
   - If they have the led suit, they **must** play a card of that suit.
   - If they do not have the led suit, they may play **any card**. This is a **thulla**.
3. **No thulla** (everyone followed suit): all cards in the round are discarded. The player who played the highest card of the led suit starts the next round.
4. **Thulla**: the round ends **immediately**. Players after the thulla player do not play in this round. The player who played the **highest card of the led suit** in this round picks up **all cards on the table** (including the thulla card) into their hand, and starts the next round.

## 4. Finishing (escaping) and the Bhabhi

- A player whose hand becomes empty has **escaped** and takes no further turns.
- Escapes are checked when the round is resolved (after discard or pick-up). A player who played their last card but then picks up cards because of a thulla has **not** escaped.
- A player whose last card is a thulla card escapes (they do not pick up; the highest led-suit player does).
- Finishing positions are given in the order players escape (1st, 2nd, ...).
- If several players escape in the **same round**, the one who played the **lower card** gets the better position.
- The game ends when only one player still has cards. That player is the **Bhabhi** (last position).
- **Final round tie**: if the last remaining players all empty their hands in the same round, the player who played the **highest card** is the Bhabhi. The others are ordered by card, lowest card = better position.

## 5. Who starts the next round (edge cases)

- Normally the starter is defined by sections 2 to 3.
- If that player has escaped, the next player in clockwise order who still has cards starts.

## 6. Turn timer

- Each turn lasts **15 seconds**.
- If the timer runs out, the server plays for the player using the bot logic (section 9).

## 7. Disconnects, leaving and resuming

- If a player disconnects or leaves during a game, a **bot takes over their seat immediately** and plays until the game ends.
- The game result is recorded on **that player's profile and rank**, even if the bot finished the game.
- If the player comes back (network restored or app reopened) while the game is still running, they can **take back control** from the bot.
- When the app is opened and the player has an unfinished game, show a choice:
  - **"Continue previous game"**: rejoin and take control back.
  - **"New game"**: the bot keeps playing the old game and its result still counts for this player.
- **Leaving on purpose** (pressing exit/quit during a ranked game) gives a quit penalty instead of normal position points (see section 10).

## 8. Game modes

### Quick play (ranked)
- Always 4 players.
- Matchmaking looks for real players. If the table is not full within **30 seconds**, the empty seats are filled with bots and the game starts.
- Affects rank.

### Private room (unranked)
- 3 to 6 players.
- The host creates a room and gets a **room code** (e.g. `4829`) and a **share link** (for WhatsApp etc.).
- Friends join with the code or the link.
- **Does not affect rank.**

## 9. Bots

- Bots must be **strong** players.
- Bots play **fair**: they only use information a human in that seat would have:
  - their own hand,
  - cards currently on the table,
  - cards already played or discarded earlier in the game,
  - card counts of other players,
  - which players are known to be out of a suit (because they played a thulla on that suit).
- Bots must **never** read other players' hands.
- Strategy goals (to be refined): get rid of high cards when safe, avoid being the highest card when a thulla is likely, use thulla to dump dangerous cards, track which suits other players are void in.
- The same bot logic is used for timeouts and disconnected players.

## 10. Rank system (quick play only)

No coins. Players earn or lose **rank points** based on finishing position.

### Points per game (4 players, quick play)
| Position | Points |
|---|---|
| 1st | +30 |
| 2nd | +15 |
| 3rd | +5 |
| 4th (Bhabhi) | -25 |
| Quit on purpose | -40 |

Reference table if ranked games with 6 players are ever added: 1st +30, 2nd +20, 3rd +10, 4th +5, 5th 0, Bhabhi -25.

- Rank points cannot go below 0.

### Tiers
| Tier | Points |
|---|---|
| Bronze | 0 - 499 |
| Silver | 500 - 1199 |
| Gold | 1200 - 1999 |
| Platinum | 2000 - 2999 |
| Diamond | 3000 - 4499 |
| Master | 4500+ |

(Point ranges are a starting point and can be tuned after testing.)

## 11. Chat

- Free text chat, fixed quick phrases (e.g. "Thulla laga!", "Jaldi karo", "Well played") and emojis.
- **Profanity filter** for English, Urdu and Roman Urdu.
- Players can **mute** another player (hides their messages for themselves).
- Players can **report** another player. Reports are stored for review.

## 12. Fairness and security (server rules)

- The server shuffles and deals using a cryptographically secure random generator.
- All game logic runs on the server. The client only sends "play card X".
- The server validates every move (correct turn, card is in hand, follows the rules above) and rejects invalid moves.
- Each player receives **only their own cards**. Other players' hands are never sent to a client, only card counts.
- Game state stays in game-server memory during play. The result is saved to the database once, when the game ends.

---

## Open decisions (not decided yet)

- Do bot-filled quick play tables give full or reduced rank points?
- Seasons: reset or soft-reset rank every few months?
- Can the private room host add bots to empty seats?
- Private room: single game, or a match of several games chosen by the host?
- Profile stats to show (games played, 1st places, times Bhabhi, thullas given, etc.).
- Friends system (add friend, see online, invite).
- App language(s): English, Urdu, or both.
- Monetization: none at first, later ads and/or cosmetic items.
