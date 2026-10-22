import type { Group } from 'three';
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Color,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { FocusTarget, SceneAction } from '../agent/actions';
import { machineStates } from '../domain/queries';
import type { Dataset, Lang, MachineStatus } from '../domain/types';
import { cameraPose, lineZ, machinePosition, OVERVIEW, type CameraPose } from './layout';
import { buildMachine } from './machines';
import { readSceneColors, type SceneColors } from './tokens';

const MAX_DPR = 1.75;
const FLY_MS = 1300;
const CONVEYOR_LENGTH = 25;

interface MachineView {
  id: string;
  status: MachineStatus;
  root: Group;
  beacon: MeshStandardMaterial;
  ring: Mesh;
  halo: Mesh;
  hit: Mesh;
  label: HTMLDivElement;
  nameEl: HTMLSpanElement;
}

interface Part {
  mesh: Mesh;
  offset: number;
}

export interface FactorySceneOptions {
  reducedMotion: boolean;
  lang: Lang;
  onSelect?: (machineId: string | null) => void;
}

/** The hall in Three.js. It only knows how to show state and play scene actions; data lives elsewhere. */
export class FactoryScene {
  private readonly renderer: WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 1, 0.5, 200);
  private readonly controls: OrbitControls;
  private readonly colors: SceneColors;
  private readonly machines = new Map<string, MachineView>();
  private readonly lineLabels: { id: string; el: HTMLDivElement }[] = [];
  private readonly parts: { lineStopped: boolean; items: Part[] }[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly visibility = { tab: !document.hidden, onScreen: true };
  private intersection?: IntersectionObserver;
  private highlighted = new Set<string>();
  private selected: string | null = null;
  private fly: { from: CameraPose; to: CameraPose; start: number } | null = null;
  private frame = 0;
  private dirty = true;
  private clock = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly ds: Dataset,
    private readonly opts: FactorySceneOptions,
  ) {
    this.colors = readSceneColors();
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(this.colors.bg);
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'scene-labels';
    container.appendChild(this.labels.domElement);

    this.scene.fog = new Fog(this.colors.bg, 45, 95);
    this.setPose(OVERVIEW);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 55;
    this.controls.target.set(OVERVIEW.target.x, OVERVIEW.target.y, OVERVIEW.target.z);
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => (this.fly = null));

    this.buildHall();
    this.bindPointer();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    document.addEventListener('visibilitychange', this.onVisibility);
    if ('IntersectionObserver' in window) {
      this.intersection = new IntersectionObserver(([entry]) => {
        this.visibility.onScreen = entry?.isIntersecting ?? true;
        this.updateLoop();
      });
      this.intersection.observe(container);
    }
    this.updateLoop();
  }

  // ---------- public API ----------

  apply(action: SceneAction): void {
    if (action.type === 'highlight') this.highlight(action.machineIds, action.tone);
    else this.focus(action.target);
  }

  /** Clears highlights before a new answer; the camera stays where it is. */
  reset(): void {
    this.highlighted.clear();
    for (const m of this.machines.values()) {
      m.halo.visible = false;
      m.label.classList.remove('is-highlighted');
      delete m.label.dataset.tone;
    }
    this.container.classList.remove('has-highlight');
    this.dirty = true;
  }

  focus(target: FocusTarget): void {
    const to = cameraPose(this.ds, target);
    // close up, the far line labels crowd the edges of the view; they return with the overview
    this.container.classList.toggle('is-close', target.kind !== 'overview');
    if (this.opts.reducedMotion) {
      this.fly = null;
      this.setPose(to);
      this.controls.target.set(to.target.x, to.target.y, to.target.z);
      this.dirty = true;
      return;
    }
    const c = this.controls.target;
    this.fly = {
      from: {
        position: {
          x: this.camera.position.x,
          y: this.camera.position.y,
          z: this.camera.position.z,
        },
        target: { x: c.x, y: c.y, z: c.z },
      },
      to,
      start: performance.now(),
    };
    this.updateLoop();
  }

  select(machineId: string | null): void {
    if (this.selected) this.machines.get(this.selected)?.label.classList.remove('is-selected');
    this.selected = machineId;
    if (machineId) this.machines.get(machineId)?.label.classList.add('is-selected');
    this.dirty = true;
  }

  setLang(lang: Lang): void {
    for (const m of this.ds.machines) {
      const view = this.machines.get(m.id);
      if (view) view.nameEl.textContent = m.name[lang];
    }
    for (const { id, el } of this.lineLabels) {
      const line = this.ds.lines.find((l) => l.id === id);
      if (line) el.textContent = `${line.id} · ${line.name[lang]}`;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ---------- building ----------

  private buildHall(): void {
    const c = this.colors;
    this.scene.add(new HemisphereLight(c.text, c.bg, 1.1));
    this.scene.add(new AmbientLight(c.text, 0.25));
    const sun = new DirectionalLight(c.text, 2.2);
    sun.position.set(-12, 24, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -22,
      right: 22,
      top: 16,
      bottom: -16,
      near: 1,
      far: 70,
    });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const floor = new Mesh(
      new PlaneGeometry(120, 80),
      new MeshStandardMaterial({ color: c.floor, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new GridHelper(120, 60, c.grid, c.grid);
    grid.position.y = 0.002;
    this.scene.add(grid);

    const body = new MeshStandardMaterial({ color: c.machine, roughness: 0.55, metalness: 0.35 });
    const detail = new MeshStandardMaterial({ color: c.detail, roughness: 0.4, metalness: 0.5 });
    const plinth = new MeshStandardMaterial({ color: c.conveyor, roughness: 0.8 });
    const laneMat = new MeshStandardMaterial({ color: c.lane, roughness: 0.9 });
    const conveyorMat = new MeshStandardMaterial({
      color: c.conveyor,
      roughness: 0.7,
      metalness: 0.2,
    });
    const partMat = new MeshStandardMaterial({ color: c.detail, roughness: 0.5, metalness: 0.6 });

    const states = new Map(machineStates(this.ds).map((s) => [s.machine.id, s.status]));

    for (const line of this.ds.lines) {
      const z = lineZ(this.ds, line.id);
      const lane = new Mesh(new PlaneGeometry(CONVEYOR_LENGTH + 3, 5.6), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(0, 0.005, z);
      lane.receiveShadow = true;
      this.scene.add(lane);

      const conveyor = new Mesh(new BoxGeometry(CONVEYOR_LENGTH, 0.45, 0.8), conveyorMat);
      conveyor.position.set(0, 0.45, z + 2.15);
      conveyor.castShadow = conveyor.receiveShadow = true;
      this.scene.add(conveyor);

      const lineStopped = this.ds.machines.some(
        (m) => m.line === line.id && states.get(m.id) === 'down',
      );
      const items: Part[] = [];
      for (let i = 0; i < 7; i++) {
        const mesh = new Mesh(new BoxGeometry(0.42, 0.28, 0.42), partMat);
        mesh.castShadow = true;
        mesh.position.set(0, 0.82, z + 2.15);
        this.scene.add(mesh);
        items.push({ mesh, offset: (i / 7) * CONVEYOR_LENGTH });
      }
      this.parts.push({ lineStopped, items });
      this.placeParts(0);

      const el = document.createElement('div');
      el.className = 'label-line';
      const label = new CSS2DObject(el);
      label.center.set(1, 0.5); // right-aligned, just left of its lane
      label.position.set(-CONVEYOR_LENGTH / 2 - 1.2, 0.3, z);
      this.scene.add(label);
      this.lineLabels.push({ id: line.id, el });
    }

    for (const m of this.ds.machines) {
      const status = states.get(m.id) ?? 'running';
      const p = machinePosition(this.ds, m.id);
      const model = buildMachine(m.kind, body, detail, plinth);
      const root = model.group;
      root.position.set(p.x, 0, p.z);
      this.scene.add(root);

      const statusColor = this.statusColor(status);
      const pole = new Mesh(new BoxGeometry(0.08, 0.9, 0.08), detail);
      pole.position.set(1.6, model.height + 0.1 - 0.45, -1.1);
      root.add(pole);
      const beacon = new MeshStandardMaterial({
        color: statusColor,
        emissive: statusColor,
        emissiveIntensity: status === 'running' ? 0.9 : 1.6,
      });
      const beaconMesh = new Mesh(new BoxGeometry(0.3, 0.42, 0.3), beacon);
      beaconMesh.position.set(1.6, model.height + 0.3, -1.1);
      root.add(beaconMesh);

      const ring = new Mesh(
        new RingGeometry(2.35, 2.6, 56),
        new MeshBasicMaterial({
          color: statusColor,
          transparent: true,
          opacity: status === 'running' ? 0.18 : 0.75,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      root.add(ring);

      const halo = new Mesh(
        new RingGeometry(2.85, 3.15, 56),
        new MeshBasicMaterial({
          color: c.highlight,
          transparent: true,
          opacity: 0.9,
          side: DoubleSide,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.03;
      halo.visible = false;
      root.add(halo);

      const hit = new Mesh(
        new BoxGeometry(3.9, model.height + 0.6, 2.9),
        new MeshBasicMaterial({ visible: false }),
      );
      hit.position.y = (model.height + 0.6) / 2;
      hit.userData.machineId = m.id;
      root.add(hit);

      const label = document.createElement('div');
      label.className = 'label-machine';
      label.dataset.status = status;
      label.textContent = m.id;
      const nameEl = document.createElement('span');
      nameEl.className = 'label-name';
      label.appendChild(nameEl);
      const labelObj = new CSS2DObject(label);
      labelObj.position.set(0, model.height + 1.0, 0);
      root.add(labelObj);

      this.machines.set(m.id, { id: m.id, status, root, beacon, ring, halo, hit, label, nameEl });
    }
    this.setLang(this.opts.lang);
  }

  private statusColor(status: MachineStatus): Color {
    return status === 'down'
      ? this.colors.down
      : status === 'quality_alarm'
        ? this.colors.quality
        : this.colors.running;
  }

  private highlight(ids: string[], tone: 'alert' | 'info'): void {
    const color = tone === 'alert' ? this.colors.down : this.colors.highlight;
    for (const id of ids) {
      const m = this.machines.get(id);
      if (!m) continue;
      this.highlighted.add(id);
      (m.halo.material as MeshBasicMaterial).color.copy(color);
      m.halo.visible = true;
      m.label.classList.add('is-highlighted');
      m.label.dataset.tone = tone;
    }
    this.container.classList.toggle('has-highlight', this.highlighted.size > 0);
    this.dirty = true;
    this.updateLoop();
  }

  // ---------- interaction ----------

  private bindPointer(): void {
    const el = this.renderer.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hits = () => [...this.machines.values()].map((m) => m.hit);
    const pick = (e: PointerEvent): string | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(hits(), false)[0];
      return (hit?.object.userData.machineId as string | undefined) ?? null;
    };
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const id = pick(e);
        this.select(id);
        this.opts.onSelect?.(id);
      }
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      el.style.cursor = pick(e) ? 'pointer' : 'grab';
    });
  }

  // ---------- loop ----------

  private readonly onVisibility = () => {
    this.visibility.tab = !document.hidden;
    this.updateLoop();
  };

  /** Runs the render loop only while the tab is visible and the canvas is on screen. */
  private updateLoop(): void {
    const shouldRun = this.visibility.tab && this.visibility.onScreen;
    if (shouldRun && !this.frame) this.frame = requestAnimationFrame(this.tick);
    if (!shouldRun && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    // observable state for the browser test and for an embedding page
    this.container.dataset.loop = shouldRun ? 'running' : 'paused';
  }

  private readonly tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.clock ? Math.min((now - this.clock) / 1000, 0.1) : 0;
    this.clock = now;

    if (this.fly) this.stepFly(now);
    if (this.controls.update()) this.dirty = true;

    if (!this.opts.reducedMotion) {
      this.animate(now, dt);
      this.dirty = true;
    }
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  private animate(now: number, dt: number): void {
    const t = now / 1000;
    for (const m of this.machines.values()) {
      if (m.status !== 'running') m.beacon.emissiveIntensity = 1.1 + Math.sin(t * 5) * 0.9;
      if (m.halo.visible) m.halo.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    }
    this.placeParts(dt);
  }

  private placeParts(dt: number): void {
    for (const line of this.parts) {
      for (const p of line.items) {
        if (!line.lineStopped) p.offset = (p.offset + dt * 1.6) % CONVEYOR_LENGTH;
        p.mesh.position.x = p.offset - CONVEYOR_LENGTH / 2 + 0.3;
      }
    }
  }

  private stepFly(now: number): void {
    if (!this.fly) return;
    const k = Math.min((now - this.fly.start) / FLY_MS, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    const lerp = (a: number, b: number) => a + (b - a) * e;
    const { from, to } = this.fly;
    this.camera.position.set(
      lerp(from.position.x, to.position.x),
      lerp(from.position.y, to.position.y),
      lerp(from.position.z, to.position.z),
    );
    this.controls.target.set(
      lerp(from.target.x, to.target.x),
      lerp(from.target.y, to.target.y),
      lerp(from.target.z, to.target.z),
    );
    this.dirty = true;
    if (k >= 1) this.fly = null;
  }

  private setPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(new Vector3(pose.target.x, pose.target.y, pose.target.z));
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole hall in view on narrow screens
    this.camera.fov = w / h < 1 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
}
