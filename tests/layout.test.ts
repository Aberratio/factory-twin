import { describe, expect, it } from 'vitest';
import {
  cameraPose,
  findFraming,
  isCloseView,
  machinePosition,
  MAX_OVERVIEW_PULLBACK,
  OVERVIEW,
  overviewPose,
} from '../src/scene/layout';
import { sampleDataset } from './helpers';

const ds = sampleDataset();

describe('scene layout', () => {
  it('places every machine at a distinct spot', () => {
    const spots = ds.machines.map((m) => {
      const p = machinePosition(ds, m.id);
      return `${p.x},${p.z}`;
    });
    expect(new Set(spots).size).toBe(ds.machines.length);
  });

  it('centres the hall on the origin', () => {
    const xs = ds.machines.map((m) => machinePosition(ds, m.id).x);
    const zs = ds.machines.map((m) => machinePosition(ds, m.id).z);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0);
  });

  it('aims the camera at the machine, the line or the hall', () => {
    const p = machinePosition(ds, 'L2-M2');
    expect(cameraPose(ds, { kind: 'machine', id: 'L2-M2' }).target).toMatchObject({
      x: p.x,
      z: p.z,
    });
    expect(cameraPose(ds, { kind: 'line', id: 'L3' }).target.z).toBe(
      machinePosition(ds, 'L3-M1').z,
    );
    expect(cameraPose(ds, { kind: 'overview' })).toEqual(OVERVIEW);
  });

  it('treats line and machine poses as close-ups and the overview as far', () => {
    expect(isCloseView(cameraPose(ds, { kind: 'overview' }))).toBe(false);
    expect(isCloseView(cameraPose(ds, { kind: 'line', id: 'L2' }))).toBe(true);
    expect(isCloseView(cameraPose(ds, { kind: 'machine', id: 'L2-M2' }))).toBe(true);
  });

  it('brings the line labels back after a manual zoom out from a close-up', () => {
    const close = cameraPose(ds, { kind: 'machine', id: 'L1-M2' });
    const zoomedOut = {
      target: close.target,
      position: {
        x: close.target.x + (close.position.x - close.target.x) * 3,
        y: close.target.y + (close.position.y - close.target.y) * 3,
        z: close.target.z + (close.position.z - close.target.z) * 3,
      },
    };
    expect(isCloseView(close)).toBe(true);
    expect(isCloseView(zoomedOut)).toBe(false);
  });

  it('pulls the overview back along its line of sight and pans it along x', () => {
    const pose = overviewPose({ pullback: 1.5, pan: -2 });
    const d = (p: typeof OVERVIEW) =>
      Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);
    expect(d(pose)).toBeCloseTo(d(OVERVIEW) * 1.5);
    expect(pose.target).toEqual({ ...OVERVIEW.target, x: OVERVIEW.target.x - 2 });
    expect(overviewPose()).toEqual(OVERVIEW);
    expect(cameraPose(ds, { kind: 'overview' }, { pullback: 1.5, pan: -2 })).toEqual(pose);
  });

  describe('findFraming', () => {
    // a toy screen: panning by -1 gives 10 px on the left and takes 10 px on the right,
    // pulling back by 0.1 gives 5 px on each side
    const toy = (left0: number, right0: number) => (f: { pullback: number; pan: number }) => ({
      left: left0 - f.pan * 10 + (f.pullback - 1) * 50,
      right: right0 + f.pan * 10 + (f.pullback - 1) * 50,
    });

    it('keeps the base pose when everything fits', () => {
      expect(findFraming(toy(5, 5))).toEqual({ pullback: 1, pan: 0 });
    });

    it('pans before pulling back when the right side has room', () => {
      const f = findFraming(toy(-20, 40));
      expect(f.pullback).toBe(1);
      expect(f.pan).toBeCloseTo(-2, 1);
    });

    it('pulls back only as far as needed when panning alone is not enough', () => {
      const f = findFraming(toy(-30, 0));
      expect(f.pullback).toBeGreaterThan(1);
      expect(f.pullback).toBeLessThan(1.4);
      const slack = toy(-30, 0)(f);
      expect(slack.left).toBeGreaterThanOrEqual(0);
      expect(slack.right).toBeGreaterThanOrEqual(0);
    });

    it('falls back to the largest pullback when nothing fits', () => {
      expect(findFraming(() => ({ left: -1, right: -1 })).pullback).toBe(MAX_OVERVIEW_PULLBACK);
    });
  });
});
