// Wording guard: the shipped build and the public docs never call this project a "demo".
// Scans every text file in dist/ plus README.md and docs/**/*.md. Run after `npm run build`:
// `npm run check:wording`. Exits 1 and lists every hit.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const FORBIDDEN = /demo/gi;
/** Words that merely contain the letters, e.g. "demographic". */
const ALLOWED = /demograph\w*/gi;
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.md', '.map']);

function walk(dir: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

function findForbidden(text: string): { index: number; match: string }[] {
  const cleaned = text.replace(ALLOWED, (m) => ' '.repeat(m.length));
  return [...cleaned.matchAll(FORBIDDEN)].map((m) => ({ index: m.index, match: m[0] }));
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

const root = process.cwd();
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/index.html not found: run `npm run build` first.');
  process.exit(1);
}

const files = [
  ...walk(join(root, 'dist'), (f) => TEXT_EXT.has(extname(f))),
  join(root, 'README.md'),
  ...walk(join(root, 'docs'), (f) => extname(f) === '.md'),
];

let hits = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { index, match } of findForbidden(text)) {
    hits++;
    const context = text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ');
    console.error(`${relative(root, file)}:${lineOf(text, index)}: "${match}" in …${context}…`);
  }
}

if (hits > 0) {
  console.error(`\nWording check failed: ${hits} hit(s) of /demo/i.`);
  process.exit(1);
}
console.info(`Wording check passed: ${files.length} files scanned, no /demo/i.`);
