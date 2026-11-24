import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnTimerManager } from './turnTimer.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnTimerManager', () => {
  it('fires the callback after the configured timeout', () => {
    const timers = new TurnTimerManager({ timeoutMs: 1000 });
    const onTimeout = vi.fn();

    timers.start('room-1', onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('defaults to a 15 second timeout', () => {
    const timers = new TurnTimerManager();
    const onTimeout = vi.fn();

    timers.start('room-1', onTimeout);
    vi.advanceTimersByTime(14_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('clear cancels a pending timer', () => {
    const timers = new TurnTimerManager({ timeoutMs: 1000 });
    const onTimeout = vi.fn();

    timers.start('room-1', onTimeout);
    timers.clear('room-1');
    vi.advanceTimersByTime(10_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('starting again replaces the previous timer rather than stacking', () => {
    const timers = new TurnTimerManager({ timeoutMs: 1000 });
    const first = vi.fn();
    const second = vi.fn();

    timers.start('room-1', first);
    vi.advanceTimersByTime(500);
    timers.start('room-1', second);
    vi.advanceTimersByTime(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tracks isRunning per room independently', () => {
    const timers = new TurnTimerManager({ timeoutMs: 1000 });
    timers.start('room-1', vi.fn());

    expect(timers.isRunning('room-1')).toBe(true);
    expect(timers.isRunning('room-2')).toBe(false);

    timers.clear('room-1');
    expect(timers.isRunning('room-1')).toBe(false);
  });
});
