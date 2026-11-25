import { describe, expect, it } from 'vitest';
import { SocketRateLimiter } from './rateLimiter.js';
import type { RateLimitCategory, RateLimitConfig } from './rateLimiter.js';

const limits: Readonly<Record<RateLimitCategory, RateLimitConfig>> = {
  'chat:send': { windowMs: 1000, max: 2 },
  'chat:report': { windowMs: 1000, max: 1 },
  'privateroom:join': { windowMs: 1000, max: 2 },
  'quickplay:join': { windowMs: 1000, max: 2 },
};

describe('SocketRateLimiter', () => {
  it('allows events up to the configured max within the window', () => {
    const limiter = new SocketRateLimiter(limits);
    expect(limiter.check('s1', 'chat:send', 0)).toEqual({ allowed: true });
    expect(limiter.check('s1', 'chat:send', 10)).toEqual({ allowed: true });
  });

  it('warns on the first crossing of the limit, without disconnecting', () => {
    const limiter = new SocketRateLimiter(limits);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    expect(limiter.check('s1', 'chat:send', 20)).toEqual({ allowed: false, action: 'warn' });
  });

  it('escalates chat:send to a temporary mute after flooding again past the warning', () => {
    const limiter = new SocketRateLimiter(limits, 5000);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // warn
    expect(limiter.check('s1', 'chat:send', 30)).toEqual({ allowed: false, action: 'mute', muteMs: 5000 });
  });

  it('keeps chat:send rejected for the full mute duration, well past the original window', () => {
    const limiter = new SocketRateLimiter(limits, 5000);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // warn
    limiter.check('s1', 'chat:send', 30); // mute until t=5030

    expect(limiter.check('s1', 'chat:send', 3000)).toEqual({ allowed: false, action: 'mute', muteMs: 2030 });
  });

  it('allows chat:send again once the mute expires', () => {
    const limiter = new SocketRateLimiter(limits, 5000);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // warn
    limiter.check('s1', 'chat:send', 30); // mute until t=5030

    expect(limiter.check('s1', 'chat:send', 5031)).toEqual({ allowed: true });
  });

  it('escalates a non-chat category straight to disconnect after flooding again past the warning', () => {
    const limiter = new SocketRateLimiter(limits);
    limiter.check('s1', 'quickplay:join', 0);
    limiter.check('s1', 'quickplay:join', 10);
    limiter.check('s1', 'quickplay:join', 20); // warn
    expect(limiter.check('s1', 'quickplay:join', 30)).toEqual({ allowed: false, action: 'disconnect' });
  });

  it('tracks each category independently for the same socket', () => {
    const limiter = new SocketRateLimiter(limits);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // chat:send now over budget for s1

    expect(limiter.check('s1', 'quickplay:join', 20)).toEqual({ allowed: true });
  });

  it('tracks each socket independently for the same category', () => {
    const limiter = new SocketRateLimiter(limits);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // s1 now over budget

    expect(limiter.check('s2', 'chat:send', 20)).toEqual({ allowed: true });
  });

  it('clear() drops every tracked category and the mute for a socket', () => {
    const limiter = new SocketRateLimiter(limits, 5000);
    limiter.check('s1', 'chat:send', 0);
    limiter.check('s1', 'chat:send', 10);
    limiter.check('s1', 'chat:send', 20); // warn
    limiter.check('s1', 'chat:send', 30); // mute

    limiter.clear('s1');

    expect(limiter.check('s1', 'chat:send', 31)).toEqual({ allowed: true });
  });
});
