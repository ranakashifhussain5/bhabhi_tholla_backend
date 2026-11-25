import { ChatError } from './errors.js';
import type { ProfanityFilter } from './profanityFilter.js';

export const QUICK_PHRASES = ['Thulla laga!', 'Jaldi karo', 'Well played'] as const;
export type QuickPhrase = (typeof QUICK_PHRASES)[number];

export const MAX_MESSAGE_LENGTH = 200;

export interface ChatMessage {
  seat: number;
  text: string;
  sentAt: string;
}

export function isQuickPhrase(text: string): text is QuickPhrase {
  return (QUICK_PHRASES as readonly string[]).includes(text);
}

/**
 * Quick phrases are pre-approved, so they skip length/profanity checks.
 * Everything else (free text, which may contain emoji) is validated and
 * run through the profanity filter.
 */
export function createChatMessage(seat: number, text: string, filter: ProfanityFilter): ChatMessage {
  const trimmed = text.trim();

  if (isQuickPhrase(trimmed)) {
    return { seat, text: trimmed, sentAt: new Date().toISOString() };
  }

  if (trimmed.length === 0) throw new ChatError('empty-message');
  if (trimmed.length > MAX_MESSAGE_LENGTH) throw new ChatError('message-too-long');
  if (filter.containsProfanity(trimmed)) throw new ChatError('profanity-blocked');

  return { seat, text: trimmed, sentAt: new Date().toISOString() };
}
