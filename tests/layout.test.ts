import { describe, expect, it } from 'vitest';
import { cameraPose, machinePosition, OVERVIEW } from '../src/scene/layout';
import { demoDataset } from './helpers';

const ds = demoDataset();

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
});
