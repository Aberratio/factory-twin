import { describe, expect, it } from 'vitest';
import { cameraPose, isCloseView, machinePosition, OVERVIEW } from '../src/scene/layout';
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
});
