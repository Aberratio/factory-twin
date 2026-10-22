import type { FocusTarget } from '../agent/actions';
import type { Dataset } from '../domain/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const LINE_SPACING = 7;
export const MACHINE_SPACING = 6.2;

/** Machines sit in rows: one row per line, front to back, evenly spaced along x. */
export function machinePosition(ds: Dataset, machineId: string): Vec3 {
  const machine = ds.machines.find((m) => m.id === machineId);
  if (!machine) throw new Error(`Unknown machine ${machineId}`);
  const lineIndex = ds.lines.findIndex((l) => l.id === machine.line);
  const onLine = ds.machines.filter((m) => m.line === machine.line);
  const i = onLine.indexOf(machine);
  return {
    x: (i - (onLine.length - 1) / 2) * MACHINE_SPACING,
    y: 0,
    z: (lineIndex - (ds.lines.length - 1) / 2) * LINE_SPACING,
  };
}

export function lineZ(ds: Dataset, lineId: string): number {
  const i = ds.lines.findIndex((l) => l.id === lineId);
  if (i < 0) throw new Error(`Unknown line ${lineId}`);
  return (i - (ds.lines.length - 1) / 2) * LINE_SPACING;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export const OVERVIEW: CameraPose = {
  position: { x: -2.2, y: 29, z: 31.5 },
  target: { x: -2.2, y: 0, z: -1.5 },
};

/**
 * How the overview is adjusted to the scene: `pullback` scales the camera distance (1 is the
 * base pose), `pan` moves camera and target along the hall's x axis (negative moves the hall
 * to the right on screen).
 */
export interface Framing {
  pullback: number;
  pan: number;
}

export const BASE_FRAMING: Framing = { pullback: 1, pan: 0 };
/** How far the overview may be pulled back on a narrow scene, as a multiple of its distance. */
export const MAX_OVERVIEW_PULLBACK = 1.6;
/** How far the overview may be panned to make room for the line labels, in world units. */
export const MAX_OVERVIEW_PAN = 8;
const PULLBACK_STEP = 0.02;

export function overviewPose(framing: Framing = BASE_FRAMING): CameraPose {
  const { pullback: k, pan } = framing;
  if (k === 1 && pan === 0) return OVERVIEW;
  const { position: p, target: t } = OVERVIEW;
  return {
    position: {
      x: t.x + (p.x - t.x) * k + pan,
      y: t.y + (p.y - t.y) * k,
      z: t.z + (p.z - t.z) * k,
    },
    target: { x: t.x + pan, y: t.y, z: t.z },
  };
}

/**
 * Room left on screen for a candidate framing, in pixels: `left` between the line labels and
 * the left edge, `right` between the hall and the right edge. Negative means it does not fit.
 */
export type Slack = (framing: Framing) => { left: number; right: number };

/**
 * The framing that fits the hall and its line labels with the least change: no pullback if
 * panning alone makes room, otherwise the smallest pullback (to PULLBACK_STEP) for which some
 * pan fits. Assumes panning towards negative x adds room on the left and takes it on the
 * right. Falls back to the largest pullback when nothing fits.
 */
export function findFraming(slack: Slack): Framing {
  for (let k = 1; k <= MAX_OVERVIEW_PULLBACK + 1e-9; k += PULLBACK_STEP) {
    const pullback = Math.round(k * 100) / 100;
    const at = (pan: number) => slack({ pullback, pan });
    if (at(0).left >= 0) return { pullback, pan: 0 };
    if (at(-MAX_OVERVIEW_PAN).left < 0) continue;
    let lo = -MAX_OVERVIEW_PAN; // fits on the left
    let hi = 0; // does not
    while (hi - lo > 0.05) {
      const mid = (lo + hi) / 2;
      if (at(mid).left >= 0) lo = mid;
      else hi = mid;
    }
    if (at(lo).right >= 0) return { pullback, pan: lo };
  }
  return { pullback: MAX_OVERVIEW_PULLBACK, pan: 0 };
}

/**
 * Where the camera goes for a focus action. Pure, so the replay test can reason about it.
 * The overview's framing is measured by the scene, so the hall and its line labels fit.
 */
export function cameraPose(
  ds: Dataset,
  target: FocusTarget,
  framing: Framing = BASE_FRAMING,
): CameraPose {
  if (target.kind === 'overview') return overviewPose(framing);
  if (target.kind === 'line') {
    const z = lineZ(ds, target.id);
    return { position: { x: 0, y: 14, z: z + 19 }, target: { x: 0, y: 0.5, z } };
  }
  const p = machinePosition(ds, target.id);
  return {
    position: { x: p.x + 5, y: 12.5, z: p.z + 11.5 },
    target: { x: p.x, y: 1, z: p.z },
  };
}

/**
 * Camera-to-target distance below which the view counts as a close-up. Close up, the far line
 * labels crowd the edges of the view, so they are hidden. Halfway between the line pose (~24)
 * and the overview (~44), so it holds for focus actions and for manual zoom alike.
 */
export const CLOSE_VIEW_DISTANCE = 34;

export function isCloseView(pose: CameraPose): boolean {
  const { position: p, target: t } = pose;
  return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) < CLOSE_VIEW_DISTANCE;
}
