import { loadDatasetFromDisk } from '../server/dataset-node';
import type { Dataset } from '../src/domain/types';

let cached: Dataset | undefined;

/** The real sample dataset from src/data — tests assert against hand-computed figures from those files. */
export function sampleDataset(): Dataset {
  cached ??= loadDatasetFromDisk();
  return cached;
}
