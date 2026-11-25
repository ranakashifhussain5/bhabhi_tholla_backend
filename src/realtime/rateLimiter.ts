export type RateLimitCategory = 'chat:send' | 'chat:report' | 'privateroom:join' | 'quickplay:join';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export const DEFAULT_RATE_LIMITS: Readonly<Record<RateLimitCategory, RateLimitConfig>> = {
  'chat:send': { windowMs: 10_000, max: 8 },
  'chat:report': { windowMs: 60_000, max: 3 },
  'privateroom:join': { windowMs: 10_000, max: 5 },
  'quickplay:join': { windowMs: 10_000, max: 5 },
};

const MUTE_DURATION_MS = 60_000;

export type RateLimitOutcome =
  | { allowed: true }
  | { allowed: false; action: 'warn' }
  | { allowed: false; action: 'mute'; muteMs: number }
  | { allowed: false; action: 'disconnect' };

interface CategoryState {
  timestamps: number[];
  violations: number;
}

/**
 * Per-connection flood control for a small set of abuse-prone event
 * categories (chat, reports, joining). The first time a socket exceeds a
 * category's limit within its window, the action is rejected with a warning
 * - still just a nudge. Flooding again after the warning escalates: chat
 * gets a temporary mute (every chat:send rejected until it expires, without
 * needing to re-cross the window each time), everything else gets the
 * connection disconnected outright.
 */
export class SocketRateLimiter {
  private readonly state = new Map<string, CategoryState>();
  private readonly mutedUntil = new Map<string, number>();

  constructor(
    private readonly limits: Readonly<Record<RateLimitCategory, RateLimitConfig>> = DEFAULT_RATE_LIMITS,
    private readonly muteDurationMs: number = MUTE_DURATION_MS,
  ) {}

  check(socketId: string, category: RateLimitCategory, now: number = Date.now()): RateLimitOutcome {
    if (category === 'chat:send') {
      const muteUntil = this.mutedUntil.get(socketId);
      if (muteUntil !== undefined && now < muteUntil) {
        return { allowed: false, action: 'mute', muteMs: muteUntil - now };
      }
    }

    const key = `${socketId}:${category}`;
    const config = this.limits[category];
    const entry = this.state.get(key) ?? { timestamps: [], violations: 0 };
    entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);

    if (entry.timestamps.length < config.max) {
      entry.timestamps.push(now);
      entry.violations = 0;
      this.state.set(key, entry);
      return { allowed: true };
    }

    entry.violations += 1;
    this.state.set(key, entry);

    if (entry.violations <= 1) {
      return { allowed: false, action: 'warn' };
    }

    if (category === 'chat:send') {
      this.mutedUntil.set(socketId, now + this.muteDurationMs);
      return { allowed: false, action: 'mute', muteMs: this.muteDurationMs };
    }

    return { allowed: false, action: 'disconnect' };
  }

  /** Drops all tracked state for a connection - call once it disconnects, so state never accumulates forever. */
  clear(socketId: string): void {
    this.mutedUntil.delete(socketId);
    const prefix = `${socketId}:`;
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) this.state.delete(key);
    }
  }
}
