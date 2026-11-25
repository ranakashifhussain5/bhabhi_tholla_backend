import { describe, expect, it } from 'vitest';
import {
  createWordlistProfanityFilter,
  DEFAULT_ENGLISH_PROFANITY,
  DEFAULT_ROMAN_URDU_PROFANITY,
  DEFAULT_URDU_SCRIPT_PROFANITY,
  defaultProfanityFilter,
} from './profanityFilter.js';

describe('createWordlistProfanityFilter', () => {
  const filter = createWordlistProfanityFilter(['badword']);

  it('catches an exact match, case-insensitively', () => {
    expect(filter.containsProfanity('BadWord')).toBe(true);
    expect(filter.containsProfanity('this is a badword here')).toBe(true);
  });

  it('does not false-positive on an unrelated word', () => {
    expect(filter.containsProfanity('this is a perfectly fine sentence')).toBe(false);
  });

  it('catches spaced-out evasion', () => {
    expect(filter.containsProfanity('b a d w o r d')).toBe(true);
  });

  it('ignores punctuation around the word', () => {
    expect(filter.containsProfanity('wow, badword!')).toBe(true);
  });
});

describe('defaultProfanityFilter', () => {
  it('catches a representative word from each of the three covered languages', () => {
    expect(defaultProfanityFilter.containsProfanity(`see you ${DEFAULT_ENGLISH_PROFANITY[0]}`)).toBe(true);
    expect(defaultProfanityFilter.containsProfanity(`tu ${DEFAULT_ROMAN_URDU_PROFANITY[0]} hai`)).toBe(true);
    expect(defaultProfanityFilter.containsProfanity(DEFAULT_URDU_SCRIPT_PROFANITY[0]!)).toBe(true);
  });

  it('allows an ordinary friendly message', () => {
    expect(defaultProfanityFilter.containsProfanity('well played, good game!')).toBe(false);
  });

  it('does not flag a short word as a substring inside an innocent word', () => {
    expect(defaultProfanityFilter.containsProfanity('lets go to mcdonalds')).toBe(false);
  });

  it('still catches a short word when it appears as its own token', () => {
    expect(defaultProfanityFilter.containsProfanity('tu mc hai')).toBe(true);
  });
});
