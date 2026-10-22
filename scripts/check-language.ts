// Language guard: the repository is written in English. Polish text is allowed only in the
// Polish side of the UI dictionary and in the sample data the app shows (plant names, scenarios,
// recordings). Scans every tracked text file and fails on Polish diacritics anywhere else.
// Run with `npm run check:language`. Exits 1 and lists every hit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export interface Allowance {
  path: RegExp;
  /** The lines (1-based) where Polish is allowed; the whole file when omitted. */
  lines?: (text: string) => Set<number>;
}

/**
 * The lines strictly inside the block that opens on a line matching `opener` and closes on the
 * next line with the same indentation that starts with "}".
 */
export function blockLines(text: string, opener: RegExp): Set<number> {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => opener.test(l));
  const inside = new Set<number>();
  if (start < 0) return inside;
  const indent = /^\s*/.exec(lines[start] ?? '')?.[0] ?? '';
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith(`${indent}}`)) break;
    inside.add(i + 1);
  }
  return inside;
}

/** Where Polish is expected: the PL UI dictionary and the sample data files. */
export const ALLOWED: Allowance[] = [
  { path: /^src\/ui\/i18n\.ts$/, lines: (text) => blockLines(text, /^\s*pl: \{$/) },
  { path: /^src\/data\/[^/]+\.(json|csv)$/ },
  { path: /^src\/recordings\/pl\/[^/]+\.json$/ },
  { path: /^scenarios\/[^/]+\.json$/ },
];

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2']);
// Polish letters with diacritics, built from code points so the guard does not flag itself.
const POLISH_LETTERS = [
  0x105, 0x107, 0x119, 0x142, 0x144, 0xf3, 0x15b, 0x17a, 0x17c, 0x104, 0x106, 0x118, 0x141, 0x143,
  0xd3, 0x15a, 0x179, 0x17b,
];
const POLISH = new RegExp(`[${String.fromCodePoint(...POLISH_LETTERS)}]`);

export function isText(path: string): boolean {
  return !BINARY_EXT.has(extname(path).toLowerCase()) && path !== 'package-lock.json';
}

export function findPolish(text: string): { line: number; text: string }[] {
  return text
    .split('\n')
    .map((t, i) => ({ line: i + 1, text: t }))
    .filter(({ text: t }) => POLISH.test(t));
}

/** Lines with Polish text that the allowances do not cover. */
export function findViolations(path: string, text: string): { line: number; text: string }[] {
  if (!isText(path)) return [];
  const allowance = ALLOWED.find((a) => a.path.test(path));
  if (allowance && !allowance.lines) return [];
  const allowed = allowance?.lines?.(text) ?? new Set<number>();
  return findPolish(text).filter(({ line }) => !allowed.has(line));
}

function main(): void {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(isText);
  let hits = 0;
  for (const file of files) {
    for (const { line, text } of findViolations(file, readFileSync(file, 'utf8'))) {
      hits++;
      console.error(`${file}:${line}: ${text.trim().slice(0, 120)}`);
    }
  }
  if (hits > 0) {
    console.error(
      `\nLanguage check failed: ${hits} line(s) with Polish text outside the allowed places.`,
    );
    process.exit(1);
  }
  console.info(`Language check passed: ${files.length} files scanned, English only.`);
}

if (process.argv[1]?.endsWith('check-language.ts')) main();
