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

/** Where the camera goes for a focus action. Pure, so the replay test can reason about it. */
export function cameraPose(ds: Dataset, target: FocusTarget): CameraPose {
  if (target.kind === 'overview') return OVERVIEW;
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
