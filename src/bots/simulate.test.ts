import { describe, expect, it } from 'vitest';
import { applyMove, createGame } from '../engine/index.js';
import type { GameState } from '../engine/index.js';
import { createKnowledge, decideMove, recordEvents } from './index.js';

function playFullBotGame(playerCount: number): GameState {
  let state = createGame(playerCount);
  let knowledge = createKnowledge(playerCount);
  let guard = 0;

  while (!state.gameOver) {
    if (++guard > 10_000) throw new Error('Game did not terminate');

    const round = state.round!;
    const seat = round.turnOrder[round.nextToActIndex]!;
    const move = decideMove(state, seat, knowledge);
    const result = applyMove(state, seat, move);
    state = result.state;
    knowledge = recordEvents(knowledge, result.events);
  }

  return state;
}

describe('bot vs bot full game simulation', () => {
  for (const playerCount of [3, 4, 5, 6]) {
    it(`completes a full ${playerCount}-player all-bot game with a valid finish order`, () => {
      for (let i = 0; i < 5; i++) {
        const state = playFullBotGame(playerCount);

        expect(state.finishOrder).toHaveLength(playerCount);
        expect(state.escaped.every(Boolean)).toBe(true);

        const positions = state.finishOrder.map((f) => f.position).sort((a, b) => a - b);
        expect(positions).toEqual(Array.from({ length: playerCount }, (_, idx) => idx + 1));

        const seats = state.finishOrder.map((f) => f.seat).sort((a, b) => a - b);
        expect(seats).toEqual(Array.from({ length: playerCount }, (_, idx) => idx));
      }
    });
  }
});
