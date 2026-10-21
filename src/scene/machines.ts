import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, type Material } from 'three';

export interface MachineModel {
  group: Group;
  /** Top of the model, for the beacon and the label. */
  height: number;
}

type Part = [
  geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
  x: number,
  y: number,
  z: number,
  detail?: boolean,
];

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const cyl = (r: number, h: number) => new CylinderGeometry(r, r, h, 24);

/** Simple, recognisable silhouettes per machine kind, built from primitives (no model files). */
const KINDS: Record<string, { height: number; parts: () => Part[] }> = {
  lathe: {
    height: 2.1,
    parts: () => [
      [box(3.4, 1.3, 1.7), 0.2, 0.9, 0],
      [box(0.9, 1.9, 1.7), -1.4, 1.2, 0],
      [rotZ(cyl(0.35, 0.5)), -0.75, 1.3, 0, true],
      [box(2.2, 0.15, 0.6), 0.5, 1.62, 0.3, true],
    ],
  },
  mill: {
    height: 3.2,
    parts: () => [
      [box(2.6, 1.9, 2.2), 0, 1.2, 0],
      [box(0.9, 1.2, 0.9), -0.4, 2.7, -0.3],
      [cyl(0.18, 0.6), -0.4, 1.95, 0.25, true],
      [box(1.8, 0.12, 1.2), 0.3, 2.2, 0.3, true],
    ],
  },
  deburr: {
    height: 2.2,
    parts: () => [
      [box(2.6, 1.7, 2.2), 0, 1.1, 0],
      [box(1.6, 0.9, 0.05), 0, 1.25, 1.12, true],
    ],
  },
  washer: {
    height: 2.2,
    parts: () => [
      [box(3.0, 1.6, 2.0), 0.3, 1.05, 0],
      [cyl(0.55, 1.9), -1.45, 1.2, -0.3, true],
    ],
  },
  press: {
    height: 3.6,
    parts: () => [
      [box(0.5, 3.0, 1.6), -1.1, 1.75, 0],
      [box(0.5, 3.0, 1.6), 1.1, 1.75, 0],
      [box(2.8, 0.6, 1.8), 0, 3.3, 0],
      [box(1.7, 0.5, 1.4), 0, 0.5, 0, true],
      [box(1.4, 0.5, 1.1), 0, 2.3, 0, true],
    ],
  },
  robot: {
    height: 2.9,
    parts: () => [
      [box(1.8, 0.8, 1.6), 0.9, 0.65, 0],
      [cyl(0.5, 0.6), -0.8, 0.55, 0],
      [box(0.45, 1.6, 0.45), -0.8, 1.6, 0, true],
      [rotZ(box(0.4, 1.5, 0.4), -0.9), -0.15, 2.45, 0, true],
      [cyl(0.15, 0.4), 0.4, 2.1, 0, true],
    ],
  },
  assembly: {
    height: 1.9,
    parts: () => [
      [box(3.0, 0.9, 1.8), 0, 0.7, 0],
      [box(0.3, 1.0, 0.3), -1.1, 1.65, -0.6, true],
      [box(1.6, 0.15, 0.3), -0.4, 2.1, -0.6, true],
      [box(0.6, 0.3, 0.6), 0.6, 1.3, 0.2, true],
    ],
  },
  tester: {
    height: 2.0,
    parts: () => [
      [box(2.4, 1.2, 1.8), 0, 0.85, 0],
      [new SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.45, 0, true],
    ],
  },
  booth: {
    height: 2.9,
    parts: () => [
      [box(3.4, 2.5, 2.4), 0, 1.5, 0],
      [box(1.9, 1.7, 0.05), 0, 1.3, 1.22, true],
    ],
  },
  oven: {
    height: 2.6,
    parts: () => [
      [box(3.6, 1.9, 2.4), 0, 1.2, 0],
      [cyl(0.22, 1.4), 1.2, 2.6, -0.6, true],
      [box(3.0, 0.1, 0.05), 0, 1.6, 1.22, true],
    ],
  },
  vision: {
    height: 2.8,
    parts: () => [
      [box(0.3, 2.3, 0.3), -1.3, 1.3, 0],
      [box(0.3, 2.3, 0.3), 1.3, 1.3, 0],
      [box(2.9, 0.3, 0.4), 0, 2.5, 0],
      [box(0.5, 0.4, 0.5), 0, 2.15, 0, true],
      [box(2.4, 0.4, 1.0), 0, 0.45, 0, true],
    ],
  },
  packer: {
    height: 2.2,
    parts: () => [
      [box(3.0, 1.5, 2.0), 0.2, 1.0, 0],
      [rotX(cyl(0.45, 1.6)), -1.3, 1.95, 0, true],
    ],
  },
};

const FALLBACK = { height: 2, parts: (): Part[] => [[box(2.6, 1.7, 2.2), 0, 1.1, 0]] };

function rotZ<T extends BoxGeometry | CylinderGeometry>(g: T, angle = Math.PI / 2): T {
  g.rotateZ(angle);
  return g;
}

function rotX<T extends CylinderGeometry>(g: T): T {
  g.rotateX(Math.PI / 2);
  return g;
}

export function buildMachine(
  kind: string,
  body: Material,
  detail: Material,
  plinth: Material,
): MachineModel {
  const spec = KINDS[kind] ?? FALLBACK;
  const group = new Group();
  const base = new Mesh(box(3.9, 0.25, 2.9), plinth);
  base.position.y = 0.125;
  base.receiveShadow = true;
  group.add(base);
  for (const [geometry, x, y, z, isDetail] of spec.parts()) {
    const mesh = new Mesh(geometry, isDetail ? detail : body);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, height: spec.height };
}
