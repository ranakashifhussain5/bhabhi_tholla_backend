export const DEFAULT_TURN_TIMEOUT_MS = 15_000;

/**
 * Tracks at most one pending turn timeout per room. Each turn lasts
 * DEFAULT_TURN_TIMEOUT_MS (GAME_RULES.md section 6); on expiry the caller is
 * responsible for playing on the seat's behalf via the bot logic.
 */
export class TurnTimerManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  }

  start(roomId: string, onTimeout: () => void): void {
    this.clear(roomId);
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      onTimeout();
    }, this.timeoutMs);
    this.timers.set(roomId, timer);
  }

  clear(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(roomId);
    }
  }

  isRunning(roomId: string): boolean {
    return this.timers.has(roomId);
  }
}
