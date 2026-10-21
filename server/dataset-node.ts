import { readFileSync } from 'node:fs';
import { buildDataset } from '../src/domain/dataset';
import type { Dataset, Plant } from '../src/domain/types';

const dataDir = new URL('../src/data/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dataDir), 'utf8');

/** Same files the browser bundles, read from disk for the live server, scripts and tests. */
export function loadDatasetFromDisk(): Dataset {
  return buildDataset({
    plant: JSON.parse(read('plant.json')) as Plant,
    downtimeCsv: read('downtime.csv'),
    qualityCsv: read('quality.csv'),
    ordersCsv: read('orders.csv'),
  });
}
