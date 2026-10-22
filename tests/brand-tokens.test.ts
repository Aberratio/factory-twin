// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSceneColors, SCENE_TOKENS } from '../src/scene/tokens';

// The kokot.it brand tokens are the single source of every colour, including the 3D scene.
// These tests read src/styles/tokens.css itself, resolve its var() chains and pin the results.

const root = process.cwd();
const tokensCss = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');

/** Custom properties declared in the top-level :root blocks (not @media, not [data-theme]). */
function rootTokens(css: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  let depth = 0;
  let inRoot = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        const from = Math.max(text.lastIndexOf('}', i), text.lastIndexOf(';', i)) + 1;
        inRoot = text.slice(from, i).trim() === ':root';
        start = i + 1;
      }
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && inRoot) {
        for (const m of text.slice(start, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
          tokens.set(m[1] ?? '', (m[2] ?? '').trim().replace(/\s+/g, ' '));
        }
      }
    }
  }
  return tokens;
}

const tokens = rootTokens(tokensCss);

function resolve(name: string, seen = new Set<string>()): string {
  const raw = tokens.get(name);
  if (raw === undefined) throw new Error(`${name} is not defined in tokens.css`);
  if (seen.has(name)) throw new Error(`cycle at ${name}`);
  seen.add(name);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => resolve(ref, seen));
}

const HEX = /^#[0-9a-f]{6}$/i;

describe('kokot.it brand tokens', () => {
  it.each([
    ['--color-bg', '#0b0d12'],
    ['--color-bg-deep', '#07080b'],
    ['--color-surface', '#11141b'],
    ['--color-surface-raised', '#181c25'],
    ['--color-line', '#2a303c'],
    ['--color-line-strong', '#3d4452'],
    ['--color-text', '#eceef3'],
    ['--color-text-muted', '#a3a9b7'],
    ['--color-text-subtle', '#7f8697'],
    ['--color-accent', '#ffb547'], // Signal
    ['--color-accent-2', '#8fb3ff'], // Ion
    ['--color-success', '#4fd1a1'],
    ['--color-warning', '#ffd166'],
    ['--color-danger', '#ff7a7a'],
  ])('%s is %s', (name, hex) => {
    expect(resolve(name).toLowerCase()).toBe(hex);
  });

  it('uses the brand fonts, self-hosted', () => {
    expect(resolve('--font-sans')).toMatch(/^'Schibsted Grotesk'/);
    expect(resolve('--font-mono')).toMatch(/^'JetBrains Mono'/);
    const fontsCss = readFileSync(join(root, 'src/styles/fonts.css'), 'utf8');
    const files = [...fontsCss.matchAll(/url\('\.\.\/assets\/fonts\/([^']+)'\)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(files).toHaveLength(4);
    for (const f of files) expect(existsSync(join(root, 'src/assets/fonts', f)), f).toBe(true);
    for (const licence of ['OFL-SchibstedGrotesk.txt', 'OFL-JetBrainsMono.txt']) {
      expect(existsSync(join(root, 'src/assets/fonts', licence)), licence).toBe(true);
    }
  });

  it('loads nothing from Google Fonts', () => {
    for (const f of [
      'index.html',
      'src/styles/tokens.css',
      'src/styles/fonts.css',
      'src/styles/app.css',
    ]) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(
        /fonts\.(googleapis|gstatic)\.com/,
      );
    }
  });
});

describe('scene colours come from tokens.css', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('every token the scene reads resolves to a colour in tokens.css', () => {
    for (const name of Object.values(SCENE_TOKENS)) expect(resolve(name), name).toMatch(HEX);
  });

  it('machine status follows the brand state colours', () => {
    expect(resolve('--status-running')).toBe(resolve('--color-success'));
    expect(resolve('--status-down')).toBe(resolve('--color-danger'));
    expect(resolve('--status-quality')).toBe(resolve('--color-warning'));
    expect(resolve('--scene-highlight')).toBe(resolve('--color-accent-2'));
    expect(resolve('--scene-bg')).toBe(resolve('--color-bg-deep'));
  });

  it('readSceneColors gives each part of the scene its brand colour', () => {
    // Expected values written out by hand from the brand palette, so a crossed mapping in
    // src/scene/tokens.ts or a changed token both fail here.
    const expected = {
      bg: '#07080b', // deep
      floor: '#0b0d12', // bg
      lane: '#11141b', // surface
      grid: '#181c25', // raised
      machine: '#3d4452', // line strong
      detail: '#7f8697', // subtle
      conveyor: '#2a303c', // line
      highlight: '#8fb3ff', // Ion
      running: '#4fd1a1', // success
      down: '#ff7a7a', // danger
      quality: '#ffd166', // warning
      text: '#eceef3',
    };
    expect(Object.keys(SCENE_TOKENS).sort()).toEqual(Object.keys(expected).sort());
    for (const name of new Set(Object.values(SCENE_TOKENS))) {
      document.documentElement.style.setProperty(name, resolve(name));
    }
    const colors = readSceneColors();
    for (const [key, hex] of Object.entries(expected)) {
      expect(`#${colors[key as keyof typeof colors].getHexString()}`, key).toBe(hex);
    }
  });

  it('fails loudly when a scene token is missing', () => {
    expect(() => readSceneColors()).toThrow(/Missing design token --scene-bg/);
  });

  it('no colour literals in the scene, UI or app CSS (tokens.css is the only place)', () => {
    const files = [
      ...readdirSync(join(root, 'src/scene')).map((f) => `src/scene/${f}`),
      ...readdirSync(join(root, 'src/ui')).map((f) => `src/ui/${f}`),
      'src/main.ts',
      'src/styles/app.css',
    ];
    const literal = /#[0-9a-f]{3,8}\b|\b0x[0-9a-f]{6}\b|\b(rgb|rgba|hsl|hsla)\(/i;
    for (const f of files) {
      const code = readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(literal.exec(code)?.[0], f).toBeUndefined();
    }
  });
});
