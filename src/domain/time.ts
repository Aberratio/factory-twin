// Plant-local wall-clock time as whole minutes. Deliberately free of time zones and DST:
// the app must compute the same numbers on every machine and in every browser.

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocal(value: string): number {
  const m = PATTERN.exec(value);
  if (!m) throw new Error(`Expected YYYY-MM-DDTHH:mm, got "${value}"`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
}

export function formatLocal(minutes: number): string {
  return new Date(minutes * 60_000).toISOString().slice(0, 16);
}
