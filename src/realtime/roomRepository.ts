import type { Room } from './room.js';

export interface RoomRepository {
  create(room: Room): void;
  get(roomId: string): Room | undefined;
  delete(roomId: string): void;
  findByRoomCode(roomCode: string): Room | undefined;
  list(): Room[];
}

/**
 * Session state lives in memory for one process. There is no multi-instance
 * support yet - this is the explicit seam for swapping in a Redis-backed
 * repository later without touching the game/bot logic (see the backend
 * build plan's decision log).
 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, Room>();

  create(room: Room): void {
    if (this.rooms.has(room.roomId)) {
      throw new Error(`Invariant violated: room ${room.roomId} already exists`);
    }
    this.rooms.set(room.roomId, room);
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  delete(roomId: string): void {
    this.rooms.delete(roomId);
  }

  findByRoomCode(roomCode: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.roomCode === roomCode) return room;
    }
    return undefined;
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }
}
