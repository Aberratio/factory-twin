import { buildDataset } from '../domain/dataset';
import type { Dataset, Plant } from '../domain/types';
import plant from './plant.json';
import downtimeCsv from './downtime.csv?raw';
import qualityCsv from './quality.csv?raw';
import ordersCsv from './orders.csv?raw';

/** The sample data bundled into the static build: no server, no network. */
export function loadDataset(): Dataset {
  return buildDataset({ plant: plant as Plant, downtimeCsv, qualityCsv, ordersCsv });
}
