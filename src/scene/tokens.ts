import { Color } from 'three';

export const SCENE_TOKENS = {
  bg: '--scene-bg',
  floor: '--scene-floor',
  lane: '--scene-lane',
  grid: '--scene-grid',
  machine: '--scene-machine',
  detail: '--scene-machine-detail',
  conveyor: '--scene-conveyor',
  highlight: '--scene-highlight',
  running: '--status-running',
  down: '--status-down',
  quality: '--status-quality',
  text: '--color-text',
} as const;

export type SceneColors = Record<keyof typeof SCENE_TOKENS, Color>;

/**
 * The brand's motion switch: tokens.css sets --motion-scale to 0 under prefers-reduced-motion.
 * Falls back to the media query itself when the token is missing.
 */
export function readMotionScale(root: Element = document.documentElement): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue('--motion-scale'));
  if (Number.isFinite(value)) return value;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : 1;
}

/** Scene colours come from the CSS tokens (tokens.css), never from literals in the scene code. */
export function readSceneColors(root: Element = document.documentElement): SceneColors {
  const style = getComputedStyle(root);
  const out = {} as SceneColors;
  for (const [key, prop] of Object.entries(SCENE_TOKENS) as [keyof typeof SCENE_TOKENS, string][]) {
    const value = style.getPropertyValue(prop).trim();
    if (!value) throw new Error(`Missing design token ${prop} (src/styles/tokens.css)`);
    out[key] = new Color(value);
  }
  return out;
}
