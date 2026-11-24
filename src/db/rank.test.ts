import { describe, expect, it } from 'vitest';
import { computePointsDelta, tierForPoints } from './rank.js';

describe('computePointsDelta', () => {
  it('matches the section 10 points table for each quick-play position', () => {
    expect(computePointsDelta(1, false)).toBe(30);
    expect(computePointsDelta(2, false)).toBe(15);
    expect(computePointsDelta(3, false)).toBe(5);
    expect(computePointsDelta(4, false)).toBe(-25);
  });

  it('applies the quit penalty instead of the position score when quitting voluntarily', () => {
    expect(computePointsDelta(1, true)).toBe(-40);
    expect(computePointsDelta(4, true)).toBe(-40);
  });

  it('throws for a position outside the 4-player quick-play table', () => {
    expect(() => computePointsDelta(5, false)).toThrow(/no rank points mapping/);
  });
});

describe('tierForPoints', () => {
  it('matches every section 10 tier boundary', () => {
    expect(tierForPoints(0)).toBe('Bronze');
    expect(tierForPoints(499)).toBe('Bronze');
    expect(tierForPoints(500)).toBe('Silver');
    expect(tierForPoints(1199)).toBe('Silver');
    expect(tierForPoints(1200)).toBe('Gold');
    expect(tierForPoints(1999)).toBe('Gold');
    expect(tierForPoints(2000)).toBe('Platinum');
    expect(tierForPoints(2999)).toBe('Platinum');
    expect(tierForPoints(3000)).toBe('Diamond');
    expect(tierForPoints(4499)).toBe('Diamond');
    expect(tierForPoints(4500)).toBe('Master');
    expect(tierForPoints(100_000)).toBe('Master');
  });
});
