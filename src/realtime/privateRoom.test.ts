import { describe, expect, it } from 'vitest';
import {
  buildJoinLink,
  createPrivateRoom,
  joinPrivateRoom,
  PrivateRoomError,
  startPrivateRoom,
} from './privateRoom.js';
import { InMemoryRoomRepository } from './roomRepository.js';

describe('createPrivateRoom', () => {
  it('creates an unranked room with a 4-digit room code and the host pending', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'alice');

    expect(room.mode).toBe('private');
    expect(room.affectsRank).toBe(false);
    expect(room.hostPlayerId).toBe('alice');
    expect(room.pendingPlayerIds).toEqual(['alice']);
    expect(room.roomCode).toMatch(/^\d{4}$/);
    expect(repo.findByRoomCode(room.roomCode!)).toBe(room);
  });
});

describe('buildJoinLink', () => {
  it('builds a link from a base URL and room code', () => {
    expect(buildJoinLink('https://example.com', '4829')).toBe('https://example.com/join/4829');
    expect(buildJoinLink('https://example.com/', '4829')).toBe('https://example.com/join/4829');
  });
});

describe('joinPrivateRoom', () => {
  it('adds a new player to the lobby', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'alice');

    joinPrivateRoom(room, 'bob');
    joinPrivateRoom(room, 'carol');

    expect(room.pendingPlayerIds).toEqual(['alice', 'bob', 'carol']);
  });

  it('is idempotent for a player already in the lobby', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'alice');

    joinPrivateRoom(room, 'bob');
    joinPrivateRoom(room, 'bob');

    expect(room.pendingPlayerIds).toEqual(['alice', 'bob']);
  });

  it('refuses a 7th player (max 6)', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'p1');
    for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) joinPrivateRoom(room, id);

    expect(() => joinPrivateRoom(room, 'p7')).toThrow(PrivateRoomError);
  });

  it('refuses to join once the game has started', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'alice');
    joinPrivateRoom(room, 'bob');
    joinPrivateRoom(room, 'carol');
    startPrivateRoom(room, 'alice');

    expect(() => joinPrivateRoom(room, 'dave')).toThrow(/already-started/);
  });
});

describe('startPrivateRoom', () => {
  it('only the host can start, and only with at least 3 players', () => {
    const repo = new InMemoryRoomRepository();
    const room = createPrivateRoom(repo, 'alice');
    joinPrivateRoom(room, 'bob');

    expect(() => startPrivateRoom(room, 'alice')).toThrow(/not-enough-players/);
    expect(() => startPrivateRoom(room, 'bob')).toThrow(/not-host/);

    joinPrivateRoom(room, 'carol');
    startPrivateRoom(room, 'alice');

    expect(room.state).not.toBeNull();
    expect(room.seats.map((s) => s.playerId)).toEqual(['alice', 'bob', 'carol']);
    expect(room.seats.every((s) => !s.isBot)).toBe(true);
  });
});
