import { describe, expect, it } from 'vitest';
import { createWordlistProfanityFilter } from './profanityFilter.js';
import { createChatMessage, isQuickPhrase, MAX_MESSAGE_LENGTH, QUICK_PHRASES } from './messages.js';
import { ChatError } from './errors.js';

const filter = createWordlistProfanityFilter(['badword']);

describe('isQuickPhrase', () => {
  it('recognizes every fixed quick phrase', () => {
    for (const phrase of QUICK_PHRASES) {
      expect(isQuickPhrase(phrase)).toBe(true);
    }
  });

  it('rejects arbitrary free text', () => {
    expect(isQuickPhrase('hello there')).toBe(false);
  });
});

describe('createChatMessage', () => {
  it('passes through a quick phrase without running it through the filter', () => {
    const message = createChatMessage(0, 'Thulla laga!', filter);
    expect(message).toMatchObject({ seat: 0, text: 'Thulla laga!' });
  });

  it('accepts an ordinary free-text message, including emoji', () => {
    const message = createChatMessage(1, 'nice move 🔥', filter);
    expect(message.text).toBe('nice move 🔥');
  });

  it('rejects an empty message', () => {
    expect(() => createChatMessage(0, '', filter)).toThrow(ChatError);
  });

  it('rejects a message over the length limit', () => {
    expect(() => createChatMessage(0, 'a'.repeat(MAX_MESSAGE_LENGTH + 1), filter)).toThrow(/message-too-long/);
  });

  it('rejects a message caught by the profanity filter', () => {
    expect(() => createChatMessage(0, 'you badword', filter)).toThrow(/profanity-blocked/);
  });
});
