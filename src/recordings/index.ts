import type { Lang } from '../domain/types';
import { parseRecording, type Recording } from '../agent/transcript';

export { LANGS } from '../domain/langs';

// Bundled at build time: recorded runs need no server and no network.
const files = import.meta.glob<unknown>('./*/*.json', { eager: true, import: 'default' });

const all: Recording[] = Object.entries(files)
  .map(([path, json]) => {
    try {
      return parseRecording(json);
    } catch (err) {
      throw new Error(`${path}: ${(err as Error).message}`, { cause: err });
    }
  })
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export function listRecordings(lang: Lang): Recording[] {
  return all.filter((r) => r.lang === lang);
}
