// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDataset } from '../src/data/browser';
import { FallbackScene } from '../src/scene/fallback-scene';
import { readMotionScale } from '../src/scene/tokens';

// The board that replaces the 3D view when WebGL is unavailable (e.g. inside some iframes).

const ds = loadDataset();

function mount(onSelect = vi.fn()) {
  document.body.innerHTML = '<div id="scene"></div>';
  const container = document.getElementById('scene') as HTMLElement;
  const scene = new FallbackScene(container, ds, {
    lang: 'en',
    onSelect,
    message: (l) => (l === 'en' ? 'no 3D here' : 'brak 3D'),
  });
  const chip = (id: string) => container.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
  return { scene, container, chip, onSelect };
}

describe('FallbackScene', () => {
  it('shows every machine with its status from the data, grouped by line', () => {
    const { container, chip } = mount();
    expect(container.querySelectorAll('.fallback-line')).toHaveLength(3);
    expect(container.querySelectorAll('.fallback-machine')).toHaveLength(12);
    expect(chip('L2-M2')?.dataset.status).toBe('down');
    expect(chip('L1-M2')?.dataset.status).toBe('quality_alarm');
    expect(container.querySelector('.scene-fallback-note')?.textContent).toBe('no 3D here');
  });

  it('applies the agent highlights and clears them on reset', () => {
    const { scene, chip } = mount();
    scene.apply({ type: 'highlight', machineIds: ['L2-M2', 'L1-M2'], tone: 'alert' });
    expect(chip('L2-M2')?.classList.contains('is-highlighted')).toBe(true);
    expect(chip('L2-M2')?.dataset.tone).toBe('alert');
    expect(chip('L1-M1')?.classList.contains('is-highlighted')).toBe(false);
    scene.reset();
    expect(chip('L2-M2')?.classList.contains('is-highlighted')).toBe(false);
    expect(chip('L2-M2')?.dataset.tone).toBeUndefined();
  });

  it('accepts focus actions without failing', () => {
    const { scene } = mount();
    expect(() => {
      scene.apply({ type: 'focus', target: { kind: 'machine', id: 'L2-M2' } });
      scene.apply({ type: 'focus', target: { kind: 'line', id: 'L3' } });
      scene.apply({ type: 'focus', target: { kind: 'overview' } });
    }).not.toThrow();
  });

  it('selects a machine on click and reports it, like the 3D view', () => {
    const { chip, onSelect } = mount();
    chip('L3-M2')?.click();
    expect(onSelect).toHaveBeenCalledWith('L3-M2');
    expect(chip('L3-M2')?.classList.contains('is-selected')).toBe(true);
  });

  it('switches language', () => {
    const { scene, container, chip } = mount();
    scene.setLang('pl');
    expect(container.querySelector('.scene-fallback-note')?.textContent).toBe('brak 3D');
    // Polish names come from the plant data, so the test does not repeat UI copy.
    const machine = ds.plant.machines.find((m) => m.id === 'L3-M2');
    const line = ds.plant.lines.find((l) => l.id === 'L1');
    expect(chip('L3-M2')?.textContent).toContain(machine?.name.pl);
    expect(container.querySelector('.fallback-line h3')?.textContent).toBe(`L1 · ${line?.name.pl}`);
  });
});

describe('readMotionScale', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('reads the brand --motion-scale token', () => {
    document.documentElement.style.setProperty('--motion-scale', '0');
    expect(readMotionScale()).toBe(0);
    document.documentElement.style.setProperty('--motion-scale', '1');
    expect(readMotionScale()).toBe(1);
  });

  it('falls back to the reduced-motion media query when the token is missing', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(readMotionScale()).toBe(0);
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    expect(readMotionScale()).toBe(1);
    spy.mockRestore();
  });
});
