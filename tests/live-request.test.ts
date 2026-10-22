import { describe, expect, it } from 'vitest';
import { parseChatRequest } from '../server/chat-request';

describe('parseChatRequest', () => {
  it('accepts a question with a language and short history', () => {
    expect(
      parseChatRequest({
        question: '  Which line is down? ',
        lang: 'en',
        history: [{ question: 'a', answer: 'b' }],
      }),
    ).toEqual({
      ok: true,
      value: {
        question: 'Which line is down?',
        lang: 'en',
        history: [{ question: 'a', answer: 'b' }],
      },
    });
  });

  it('defaults to English and empty history', () => {
    expect(parseChatRequest({ question: 'x' })).toEqual({
      ok: true,
      value: { question: 'x', lang: 'en', history: [] },
    });
  });

  it.each([
    ['not an object', 'hello'],
    ['empty question', { question: '   ' }],
    ['question too long', { question: 'x'.repeat(1001) }],
    ['unknown language', { question: 'x', lang: 'de' }],
    [
      'history too long',
      {
        question: 'x',
        history: Array.from({ length: 11 }, () => ({ question: 'a', answer: 'b' })),
      },
    ],
    ['malformed history', { question: 'x', history: [{ question: 1 }] }],
    // F1 regression: an empty assistant turn makes the Messages API reject every later request
    ['an empty answer in history', { question: 'x', history: [{ question: 'a', answer: '' }] }],
    [
      'a whitespace-only answer in history',
      { question: 'x', history: [{ question: 'a', answer: '  ' }] },
    ],
    ['an empty question in history', { question: 'x', history: [{ question: '', answer: 'b' }] }],
    ['a null history entry', { question: 'x', history: [null] }],
    [
      'an answer over the limit',
      { question: 'x', history: [{ question: 'a', answer: 'y'.repeat(4001) }] },
    ],
  ])('rejects %s', (_label, body) => {
    expect(parseChatRequest(body).ok).toBe(false);
  });
});
