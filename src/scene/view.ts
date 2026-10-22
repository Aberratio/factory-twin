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
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    // a probe context counts against the browser's limit until garbage collection: free it now
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}
