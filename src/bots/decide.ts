import {
  applyMove,
  createDeck,
  getLegalMoves,
  shuffle,
} from '../engine/index.js';
import type { Card, GameState, NormalRoundState, PlayerState, Suit } from '../engine/index.js';
import type { BotKnowledge } from './knowledge.js';

const LEAD_ROLLOUT_SAMPLES = 15;

export function decideMove(state: GameState, seat: number, knowledge: BotKnowledge): Card {
  const legalMoves = getLegalMoves(state, seat);
  if (legalMoves.length === 1) return legalMoves[0]!;

  // getLegalMoves already throws above whenever state.round is null, so this
  // narrows the type rather than handling a reachable case.
  const round = state.round!;
  const isLeader = round.plays.length === 0;

  if (round.phase === 'first-round') {
    // Not forced (several spades, or several non-Ace cards): keep stronger cards for later.
    return pickLowest(legalMoves);
  }

  if (isLeader) {
    return chooseLeadCard(state, seat, legalMoves, knowledge);
  }

  const ledSuit = round.plays[0]!.card.suit;
  const isFollowingSuit = legalMoves[0]!.suit === ledSuit;
  if (!isFollowingSuit) {
    // Forced to thulla: the card's suit doesn't affect who picks up, so shed
    // the most dangerous (highest) card while it's a free dump.
    return pickHighest(legalMoves);
  }

  const risky = isThullaRiskAhead(round, ledSuit, knowledge);
  return risky ? pickLowest(legalMoves) : pickHighest(legalMoves);
}

function pickLowest(cards: readonly Card[]): Card {
  return cards.reduce((min, c) => (c.rank < min.rank ? c : min));
}

function pickHighest(cards: readonly Card[]): Card {
  return cards.reduce((max, c) => (c.rank > max.rank ? c : max));
}

function isThullaRiskAhead(round: NormalRoundState, ledSuit: Suit, knowledge: BotKnowledge): boolean {
  for (let i = round.nextToActIndex + 1; i < round.turnOrder.length; i++) {
    const otherSeat = round.turnOrder[i]!;
    if (knowledge.voidSuits[otherSeat]?.has(ledSuit)) return true;
  }
  return false;
}

function chooseLeadCard(
  state: GameState,
  seat: number,
  candidates: readonly Card[],
  knowledge: BotKnowledge,
): Card {
  let best = candidates[0]!;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    let total = 0;
    for (let i = 0; i < LEAD_ROLLOUT_SAMPLES; i++) {
      total += simulateLead(state, seat, candidate, knowledge);
    }
    const score = total / LEAD_ROLLOUT_SAMPLES;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function simulateLead(
  state: GameState,
  seat: number,
  candidate: Card,
  knowledge: BotKnowledge,
): number {
  const sampledPlayers = sampleOpponentHands(state, seat, knowledge);
  let simState: GameState = { ...state, players: sampledPlayers };

  let result = applyMove(simState, seat, candidate);
  simState = result.state;
  let lastEvents = result.events;

  while (simState.round !== null && simState.round.plays.length > 0) {
    const round = simState.round;
    const nextSeat = round.turnOrder[round.nextToActIndex]!;
    const move = randomLegalMove(simState, nextSeat);
    result = applyMove(simState, nextSeat, move);
    simState = result.state;
    lastEvents = result.events;
  }

  const resolution = lastEvents.find(
    (e) => e.type === 'round-discarded' || e.type === 'round-picked-up',
  );
  const dumpBonus = candidate.rank / 14;

  if (resolution?.type === 'round-picked-up' && resolution.seat === seat) {
    return -resolution.cards.length;
  }

  return dumpBonus;
}

function randomLegalMove(state: GameState, seat: number): Card {
  const legal = getLegalMoves(state, seat);
  return legal[Math.floor(Math.random() * legal.length)]!;
}

function sampleOpponentHands(
  state: GameState,
  leaderSeat: number,
  knowledge: BotKnowledge,
): PlayerState[] {
  const leaderHand = state.players[leaderSeat]!.hand;
  const roundPlays = state.round?.plays.map((p) => p.card) ?? [];
  const visible = [...knowledge.cardsSeen, ...roundPlays, ...leaderHand];
  const visibleKeys = new Set(visible.map((c) => `${c.suit}${c.rank}`));

  const pool = shuffle(createDeck().filter((c) => !visibleKeys.has(`${c.suit}${c.rank}`)));

  return state.players.map((player) => {
    if (player.seat === leaderSeat || player.hand.length === 0) {
      return { ...player, hand: [...player.hand] };
    }

    const needed = player.hand.length;
    const voids = knowledge.voidSuits[player.seat] ?? new Set<Suit>();
    const assigned: Card[] = [];

    for (let i = pool.length - 1; i >= 0 && assigned.length < needed; i--) {
      if (!voids.has(pool[i]!.suit)) {
        assigned.push(...pool.splice(i, 1));
      }
    }
    while (assigned.length < needed && pool.length > 0) {
      assigned.push(pool.pop()!);
    }

    return { ...player, hand: assigned };
  });
}
