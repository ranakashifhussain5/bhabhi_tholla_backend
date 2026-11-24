import { resolveRound } from './finish.js';
import { ACE } from './types.js';
import type { Card, FirstRoundState, GameEvent, GameState } from './types.js';

export function getFirstRoundLegalMoves(hand: readonly Card[], isLeader: boolean): Card[] {
  if (isLeader) {
    const as = hand.find((c) => c.suit === 'S' && c.rank === ACE);
    if (!as) throw new Error('Invariant violated: first-round leader does not hold the Ace of Spades');
    return [as];
  }

  const spades = hand.filter((c) => c.suit === 'S');
  if (spades.length > 0) return spades;

  const nonAces = hand.filter((c) => c.rank !== ACE);
  if (nonAces.length === 0) {
    throw new Error(
      'Invariant violated: player has no spades and only aces in the first round (see GAME_RULES.md section 2)',
    );
  }
  return nonAces;
}

export function applyFirstRoundMove(
  state: GameState,
  round: FirstRoundState,
  seat: number,
  card: Card,
): { state: GameState; events: GameEvent[] } {
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const player = players[seat]!;
  player.hand = player.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));

  const plays = [...round.plays, { seat, card }];
  const events: GameEvent[] = [{ type: 'card-played', seat, card, ledSuit: null, thulla: false }];

  if (plays.length < round.turnOrder.length) {
    const nextState: GameState = {
      ...state,
      players,
      round: { ...round, plays, nextToActIndex: round.nextToActIndex + 1 },
    };
    return { state: nextState, events };
  }

  const spadePlays = plays.filter((p) => p.card.suit === 'S');
  if (spadePlays.length === 0) {
    throw new Error('Invariant violated: first round completed with no spade played');
  }
  const highestSpade = spadePlays.reduce((best, p) => (p.card.rank > best.card.rank ? p : best));

  const resolved = resolveRound({
    state: { ...state, players },
    plays,
    pickupSeat: null,
    nominalNextStarter: highestSpade.seat,
  });

  return { state: resolved.state, events: [...events, ...resolved.events] };
}
