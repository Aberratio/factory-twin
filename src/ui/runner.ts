import type { TimelineEvent } from '../agent/player';

/** Plays a timeline with setTimeout. Returns a cancel function; a cancelled run fires nothing more. */
export function runTimeline(
  events: TimelineEvent[],
  onEvent: (e: TimelineEvent) => void,
): () => void {
  const timers = events.map((e) => window.setTimeout(() => onEvent(e), e.at));
  return () => timers.forEach((t) => window.clearTimeout(t));
}

/** Reveals text word by word over `ms`, then calls done. Instant when ms is 0. */
export function revealText(
  el: HTMLElement,
  text: string,
  ms: number,
  done: () => void,
): () => void {
  const words = text.split(/(\s+)/);
  if (ms <= 0 || words.length < 2) {
    done();
    return () => undefined;
  }
  const steps = Math.ceil(words.length / 2);
  const stepMs = ms / steps;
  let i = 0;
  el.style.whiteSpace = 'pre-wrap';
  const timer = window.setInterval(() => {
    i++;
    el.textContent = words.slice(0, i * 2).join('');
    if (i >= steps) {
      window.clearInterval(timer);
      el.style.whiteSpace = '';
      done();
    }
  }, stepMs);
  return () => window.clearInterval(timer);
}
