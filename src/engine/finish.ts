import { buildTurnOrder } from './seats.js';
import type { Card, GameEvent, GameState, PlayedCard } from './types.js';

interface ResolveRoundInput {
  state: GameState;
  plays: PlayedCard[];
  pickupSeat: number | null;
  nominalNextStarter: number;
}

interface ResolveRoundResult {
  state: GameState;
  events: GameEvent[];
}

export function resolveRound(input: ResolveRoundInput): ResolveRoundResult {
  const { state, plays, pickupSeat, nominalNextStarter } = input;
  const events: GameEvent[] = [];

  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const escaped = [...state.escaped];
  const finishOrder = [...state.finishOrder];

  if (pickupSeat === null) {
    events.push({
      type: 'round-discarded',
      cards: plays.map((p) => p.card),
      nextStarter: nominalNextStarter,
    });
  } else {
    const pile: Card[] = plays.map((p) => p.card);
    players[pickupSeat]!.hand.push(...pile);
    if (players[pickupSeat]!.hand.length === 0) {
      throw new Error('Invariant violated: pickup seat has an empty hand after pickup');
    }
    events.push({
      type: 'round-picked-up',
      seat: pickupSeat,
      cards: pile,
      nextStarter: nominalNextStarter,
    });
  }

  const finishedThisRound = [...plays].sort((a, b) => a.card.rank - b.card.rank);

  for (const { seat } of finishedThisRound) {
    if (players[seat]!.hand.length !== 0) continue;
    escaped[seat] = true;
    const position = finishOrder.length + 1;
    finishOrder.push({ seat, position });
    events.push({ type: 'player-escaped', seat, position });
  }

  let remaining = escaped.filter((e) => !e).length;

  if (remaining === 1) {
    const loneSeat = escaped.findIndex((e) => !e);
    escaped[loneSeat] = true;
    const position = finishOrder.length + 1;
    finishOrder.push({ seat: loneSeat, position });
    events.push({ type: 'player-escaped', seat: loneSeat, position });
    remaining = 0;
  }

  if (remaining === 0) {
    events.push({ type: 'game-over', finishOrder });
    return {
      state: { ...state, players, escaped, finishOrder, gameOver: true, round: null },
      events,
    };
  }

  const actualNextStarter = escaped[nominalNextStarter]
    ? firstNonEscaped(state.playerCount, nominalNextStarter, escaped)
    : nominalNextStarter;

  return {
    state: {
      ...state,
      players,
      escaped,
      finishOrder,
      gameOver: false,
      round: {
        phase: 'normal-round',
        turnOrder: buildTurnOrder(state.playerCount, actualNextStarter, escaped),
        nextToActIndex: 0,
        plays: [],
      },
    },
    events,
  };
}

function firstNonEscaped(playerCount: number, start: number, escaped: readonly boolean[]): number {
  for (let i = 1; i <= playerCount; i++) {
    const seat = (start + i) % playerCount;
    if (!escaped[seat]) return seat;
  }
  throw new Error('Invariant violated: no non-escaped seat found');
}
