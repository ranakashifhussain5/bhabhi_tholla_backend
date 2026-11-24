import { describe, expect, it } from 'vitest';
import { createGame } from './deal.js';
import type { GameState } from './types.js';
import { applyMove, getLegalMoves } from './validate.js';

function playRandomGame(playerCount: number): GameState {
  let state = createGame(playerCount);
  let guard = 0;

  while (!state.gameOver) {
    if (++guard > 10_000) throw new Error('Game did not terminate');

    const round = state.round!;
    const seat = round.turnOrder[round.nextToActIndex]!;
    const legal = getLegalMoves(state, seat);
    const choice = legal[Math.floor(Math.random() * legal.length)]!;
    const result = applyMove(state, seat, choice);
    state = result.state;
  }

  return state;
}

describe('full game simulation', () => {
  for (const playerCount of [3, 4, 5, 6]) {
    it(`completes a full ${playerCount}-player game with a valid finish order`, () => {
      for (let i = 0; i < 25; i++) {
        const state = playRandomGame(playerCount);

        expect(state.finishOrder).toHaveLength(playerCount);
        expect(state.escaped.every(Boolean)).toBe(true);

        const positions = state.finishOrder.map((f) => f.position).sort((a, b) => a - b);
        expect(positions).toEqual(Array.from({ length: playerCount }, (_, idx) => idx + 1));

        const seats = state.finishOrder.map((f) => f.seat).sort((a, b) => a - b);
        expect(seats).toEqual(Array.from({ length: playerCount }, (_, idx) => idx));

        // Everyone except possibly the Bhabhi (position N) emptied their hand to finish.
        // A lone-survivor Bhabhi ends the game still holding cards; a final-round-tie
        // Bhabhi empties their hand like everyone else - either is a valid finish.
        for (const { seat, position } of state.finishOrder) {
          if (position < playerCount) {
            expect(state.players[seat]!.hand).toHaveLength(0);
          }
        }
      }
    });
  }
});
