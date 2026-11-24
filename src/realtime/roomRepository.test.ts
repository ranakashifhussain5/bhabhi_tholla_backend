import { describe, expect, it } from 'vitest';
import { createLobbyRoom } from './room.js';
import { InMemoryRoomRepository } from './roomRepository.js';

describe('InMemoryRoomRepository', () => {
  it('creates, gets, and deletes rooms', () => {
    const repo = new InMemoryRoomRepository();
    const room = createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true });

    repo.create(room);
    expect(repo.get('r1')).toBe(room);

    repo.delete('r1');
    expect(repo.get('r1')).toBeUndefined();
  });

  it('refuses to create a room with a duplicate id', () => {
    const repo = new InMemoryRoomRepository();
    repo.create(createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true }));
    expect(() => repo.create(createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true }))).toThrow(
      /already exists/,
    );
  });

  it('finds a room by its room code', () => {
    const repo = new InMemoryRoomRepository();
    const room = createLobbyRoom({
      roomId: 'r1',
      mode: 'private',
      affectsRank: false,
      roomCode: '4829',
    });
    repo.create(room);

    expect(repo.findByRoomCode('4829')).toBe(room);
    expect(repo.findByRoomCode('0000')).toBeUndefined();
  });

  it('lists every room', () => {
    const repo = new InMemoryRoomRepository();
    repo.create(createLobbyRoom({ roomId: 'r1', mode: 'quick-play', affectsRank: true }));
    repo.create(createLobbyRoom({ roomId: 'r2', mode: 'quick-play', affectsRank: true }));

    expect(repo.list().map((r) => r.roomId).sort()).toEqual(['r1', 'r2']);
  });
});
