export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';

/** 4-player quick play only (GAME_RULES.md section 10) - quick play is always 4 players. */
const QUICK_PLAY_POSITION_POINTS: Readonly<Record<number, number>> = {
  1: 30,
  2: 15,
  3: 5,
  4: -25,
};

export const QUIT_PENALTY = -40;

export function computePointsDelta(position: number, quitVoluntarily: boolean): number {
  if (quitVoluntarily) return QUIT_PENALTY;

  const delta = QUICK_PLAY_POSITION_POINTS[position];
  if (delta === undefined) {
    throw new Error(`Invariant violated: no rank points mapping for position ${position}`);
  }
  return delta;
}

export function clampRankPoints(points: number): number {
  return Math.max(0, points);
}

export function tierForPoints(points: number): Tier {
  if (points >= 4500) return 'Master';
  if (points >= 3000) return 'Diamond';
  if (points >= 2000) return 'Platinum';
  if (points >= 1200) return 'Gold';
  if (points >= 500) return 'Silver';
  return 'Bronze';
}
