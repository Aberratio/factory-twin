// Language guard: the repository is written in English. Polish text is allowed only in the
// Polish UI strings and in the sample data the app shows (plant names, scenarios, recordings).
// Scans every tracked text file and fails on Polish diacritics anywhere else.
// Run with `npm run check:language`. Exits 1 and lists every hit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/** Paths where Polish is expected: UI strings (PL side of the dictionary) and sample data. */
export const ALLOWED_PATHS: RegExp[] = [
  /^src\/ui\/i18n\.ts$/,
  /^src\/data\//,
  /^src\/recordings\/pl\//,
  /^scenarios\//,
];

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2']);
// Polish letters with diacritics, escaped so the guard does not flag itself.
const POLISH =
  /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/;

export function isChecked(path: string): boolean {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return false;
  if (path === 'package-lock.json') return false;
  return !ALLOWED_PATHS.some((re) => re.test(path));
}

export function findPolish(text: string): { line: number; text: string }[] {
  return text
    .split('\n')
    .map((t, i) => ({ line: i + 1, text: t }))
    .filter(({ text: t }) => POLISH.test(t));
}

function main(): void {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(isChecked);
  let hits = 0;
  for (const file of files) {
    for (const { line, text } of findPolish(readFileSync(file, 'utf8'))) {
      hits++;
      console.error(`${file}:${line}: ${text.trim().slice(0, 120)}`);
    }
  }
  if (hits > 0) {
    console.error(
      `\nLanguage check failed: ${hits} line(s) with Polish text outside the allowed paths.`,
    );
    process.exit(1);
  }
  console.info(`Language check passed: ${files.length} files scanned, English only.`);
}

if (process.argv[1]?.endsWith('check-language.ts')) main();
