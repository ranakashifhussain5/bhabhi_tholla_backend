import { createKnowledge } from '../bots/index.js';
import { makeGame } from '../engine/testHelpers.js';
import type { Card, FirstRoundState, NormalRoundState } from '../engine/index.js';
import type { Room, SeatBinding } from './room.js';

export function makeTestRoom(options: {
  hands: Card[][];
  round: FirstRoundState | NormalRoundState;
  playerIds: ReadonlyArray<string | null>;
}): Room {
  const playerCount = options.hands.length;
  const seats: SeatBinding[] = options.playerIds.map((playerId, seat) => ({
    seat,
    playerId,
    isBot: playerId === null,
    connected: playerId !== null,
    socketId: playerId,
    quitVoluntarily: false,
  }));

  return {
    roomId: 'test-room',
    mode: 'quick-play',
    affectsRank: true,
    roomCode: null,
    hostPlayerId: null,
    pendingPlayerIds: [],
    seats,
    state: makeGame({ hands: options.hands, round: options.round }),
    knowledge: createKnowledge(playerCount),
  };
}
