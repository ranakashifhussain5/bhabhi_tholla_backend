import { describe, expect, it } from 'vitest';
import { resolveRound } from './finish.js';
import { makeGame } from './testHelpers.js';

describe('resolveRound defensive invariants', () => {
  it('throws if a pickup seat somehow ends up with an empty hand', () => {
    const state = makeGame({
      hands: [[], []],
      round: { phase: 'normal-round', turnOrder: [0, 1], nextToActIndex: 0, plays: [] },
    });

    expect(() =>
      resolveRound({ state, plays: [], pickupSeat: 0, nominalNextStarter: 0 }),
    ).toThrow(/pickup seat has an empty hand/);
  });
});
