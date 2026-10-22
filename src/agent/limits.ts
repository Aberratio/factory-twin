/** Size limits of a live chat request, shared by the browser (what it sends) and the server (what it accepts). */
export const CHAT_LIMITS = {
  question: 1000,
  historyTurns: 10,
  answer: 4000,
} as const;
