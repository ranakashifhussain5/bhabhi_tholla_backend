import { describe, expect, it } from 'vitest';
import { createLobbyRoom, findSeatByPlayerId, findSeatBySocketId, startGame } from './room.js';

describe('createLobbyRoom', () => {
  it('starts with no game and, for a private room, the host already pending', () => {
    const room = createLobbyRoom({
      roomId: 'r1',
      mode: 'private',
      affectsRank: false,
      roomCode: '1234',
      hostPlayerId: 'alice',
    });

    expect(room.state).toBeNull();
    expect(room.seats).toEqual([]);
    expect(room.pendingPlayerIds).toEqual(['alice']);
    expect(room.hostPlayerId).toBe('alice');
  });

  it('has no pending players when no host is given (quick play)', () => {
    const room = createLobbyRoom({ roomId: 'r2', mode: 'quick-play', affectsRank: true });
    expect(room.pendingPlayerIds).toEqual([]);
  });
});

describe('startGame', () => {
  it('deals a game and binds seats, with null entries becoming bots', () => {
    const room = createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true });
    startGame(room, ['alice', null, 'carol', null]);

    expect(room.state).not.toBeNull();
    expect(room.knowledge).not.toBeNull();
    expect(room.seats).toHaveLength(4);
    expect(room.seats[0]).toMatchObject({ playerId: 'alice', isBot: false, connected: true });
    expect(room.seats[1]).toMatchObject({ playerId: null, isBot: true, connected: false });
    expect(room.seats[2]).toMatchObject({ playerId: 'carol', isBot: false, connected: true });
    expect(room.seats[3]).toMatchObject({ playerId: null, isBot: true, connected: false });
  });

  it('refuses to deal a second game into the same room', () => {
    const room = createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true });
    startGame(room, ['alice', 'bob', 'carol']);
    expect(() => startGame(room, ['dave', 'erin', 'frank'])).toThrow(/already has a game/);
  });
});

describe('seat lookups', () => {
  it('finds a seat by player id or socket id', () => {
    const room = createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true });
    startGame(room, ['alice', 'bob', 'carol']);
    room.seats[1]!.socketId = 'socket-bob';

    expect(findSeatByPlayerId(room, 'carol')?.seat).toBe(2);
    expect(findSeatBySocketId(room, 'socket-bob')?.seat).toBe(1);
    expect(findSeatByPlayerId(room, 'nobody')).toBeUndefined();
  });
});
