import { isLang } from '../src/domain/langs';
import type { Lang } from '../src/domain/types';
import type { HistoryTurn } from './agent';

export interface ChatRequest {
  question: string;
  lang: Lang;
  history: HistoryTurn[];
}

const MAX_QUESTION = 1000;
const MAX_HISTORY = 10;
const MAX_ANSWER = 4000;

/** Validates the body of POST /api/chat. Everything from the browser is untrusted. */
export function parseChatRequest(
  body: unknown,
): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return { ok: false, error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;

  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) return { ok: false, error: 'question is required' };
  if (question.length > MAX_QUESTION)
    return { ok: false, error: `question is longer than ${MAX_QUESTION} characters` };

  const lang = b.lang ?? 'en';
  if (!isLang(lang)) return { ok: false, error: 'lang must be en or pl' };

  const history = b.history ?? [];
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    return { ok: false, error: `history must be a list of at most ${MAX_HISTORY} turns` };
  }
  for (const h of history) {
    if (
      typeof h !== 'object' ||
      h === null ||
      typeof h.question !== 'string' ||
      typeof h.answer !== 'string' ||
      h.question.length > MAX_QUESTION ||
      h.answer.length > MAX_ANSWER
    ) {
      return { ok: false, error: 'each history turn needs a question and an answer string' };
    }
  }
  return {
    ok: true,
    value: {
      question,
      lang,
      history: history.map((h: HistoryTurn) => ({ question: h.question, answer: h.answer })),
    },
  };
}
