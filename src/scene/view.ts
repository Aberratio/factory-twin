import type { FocusTarget, SceneAction } from '../agent/actions';
import type { Lang } from '../domain/types';

/** What the chat and the page need from the hall view: the 3D scene or its no-WebGL fallback. */
export interface SceneView {
  apply(action: SceneAction): void;
  reset(): void;
  focus(target: FocusTarget): void;
  select(machineId: string | null): void;
  setLang(lang: Lang): void;
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
