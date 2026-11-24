export const QUICK_PLAY_SEATS = 4;
export const QUICK_PLAY_WAIT_MS = 30_000;

export interface QueueEntry {
  playerId: string;
  socketId: string;
}

export type SeatEntry = QueueEntry | null;

/**
 * Queues real players for quick play (always 4 seats, GAME_RULES.md section
 * 8). If the table isn't full within 30s of the first player joining, the
 * remaining seats are bot-filled and the game starts with whoever is there.
 */
export class QuickPlayMatchmaker {
  private queue: QueueEntry[] = [];
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly seatsNeeded: number;
  private readonly waitMs: number;

  constructor(
    private readonly startRoom: (entries: readonly SeatEntry[]) => void,
    options: { seatsNeeded?: number; waitMs?: number } = {},
  ) {
    this.seatsNeeded = options.seatsNeeded ?? QUICK_PLAY_SEATS;
    this.waitMs = options.waitMs ?? QUICK_PLAY_WAIT_MS;
  }

  join(playerId: string, socketId: string): void {
    if (this.queue.some((entry) => entry.playerId === playerId)) return;
    this.queue.push({ playerId, socketId });

    if (this.queue.length >= this.seatsNeeded) {
      this.flush(this.seatsNeeded);
      return;
    }

    this.waitTimer ??= setTimeout(() => this.fillWithBots(), this.waitMs);
  }

  queueLength(): number {
    return this.queue.length;
  }

  private flush(count: number): void {
    this.clearWaitTimer();
    const entries: SeatEntry[] = this.queue.splice(0, count);
    this.startRoom(entries);
  }

  private fillWithBots(): void {
    this.waitTimer = null;
    if (this.queue.length === 0) return;

    const entries: SeatEntry[] = this.queue.splice(0, this.queue.length);
    while (entries.length < this.seatsNeeded) entries.push(null);
    this.startRoom(entries);
  }

  private clearWaitTimer(): void {
    if (this.waitTimer !== null) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }
}
