import { resolveRound } from './finish.js';
import type { Card, GameEvent, GameState, NormalRoundState } from './types.js';

export function getNormalRoundLegalMoves(
  hand: readonly Card[],
  round: NormalRoundState,
): Card[] {
  if (round.plays.length === 0) {
    return [...hand];
  }

  const ledSuit = round.plays[0]!.card.suit;
  const followers = hand.filter((c) => c.suit === ledSuit);
  if (followers.length > 0) return followers;

  return [...hand];
}

export function applyNormalRoundMove(
  state: GameState,
  round: NormalRoundState,
  seat: number,
  card: Card,
): { state: GameState; events: GameEvent[] } {
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const player = players[seat]!;
  player.hand = player.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));

  const isLeader = round.plays.length === 0;
  const ledSuit = isLeader ? card.suit : round.plays[0]!.card.suit;
  const isThulla = !isLeader && card.suit !== ledSuit;

  const plays = [...round.plays, { seat, card }];
  const events: GameEvent[] = [
    { type: 'card-played', seat, card, ledSuit: isLeader ? null : ledSuit, thulla: isThulla },
  ];

  if (isThulla) {
    const ledSuitPlays = plays.filter((p) => p.card.suit === ledSuit);
    const highestLedSuit = ledSuitPlays.reduce((best, p) => (p.card.rank > best.card.rank ? p : best));

    const resolved = resolveRound({
      state: { ...state, players },
      plays,
      pickupSeat: highestLedSuit.seat,
      nominalNextStarter: highestLedSuit.seat,
    });

    return { state: resolved.state, events: [...events, ...resolved.events] };
  }

  if (plays.length < round.turnOrder.length) {
    const nextState: GameState = {
      ...state,
      players,
      round: { ...round, plays, nextToActIndex: round.nextToActIndex + 1 },
    };
    return { state: nextState, events };
  }

  const highest = plays.reduce((best, p) => (p.card.rank > best.card.rank ? p : best));
  const resolved = resolveRound({
    state: { ...state, players },
    plays,
    pickupSeat: null,
    nominalNextStarter: highest.seat,
  });

  return { state: resolved.state, events: [...events, ...resolved.events] };
}
