import { parseCsv } from './csv';
import { parseLocal } from './time';
import type { Dataset, DowntimeEvent, Order, OrderStatus, Plant, QualityCheck } from './types';

export interface RawDataset {
  plant: Plant;
  downtimeCsv: string;
  qualityCsv: string;
  ordersCsv: string;
}

const ORDER_STATUSES: readonly string[] = ['queued', 'in_progress', 'done'];

/** Parses and cross-checks the demo data. Throws on anything inconsistent: bad data must not reach the agent. */
export function buildDataset(raw: RawDataset): Dataset {
  const { plant } = raw;
  const machineIds = new Set(plant.machines.map((m) => m.id));
  const lineIds = new Set(plant.lines.map((l) => l.id));
  const knownMachine = (id: string, where: string) => {
    if (!machineIds.has(id)) throw new Error(`${where}: unknown machine ${id}`);
    return id;
  };
  for (const m of plant.machines) {
    if (!lineIds.has(m.line)) throw new Error(`machine ${m.id}: unknown line ${m.line}`);
  }

  const downtime: DowntimeEvent[] = parseCsv(raw.downtimeCsv).map((r) => {
    const category = r.category;
    if (category !== 'planned' && category !== 'unplanned') {
      throw new Error(`downtime ${r.id}: bad category ${category}`);
    }
    return {
      id: req(r, 'id'),
      machineId: knownMachine(req(r, 'machine_id'), `downtime ${r.id}`),
      start: parseLocal(req(r, 'start')),
      end: r.end ? parseLocal(r.end) : null,
      category,
      cause: req(r, 'cause'),
    };
  });

  const quality: QualityCheck[] = parseCsv(raw.qualityCsv).map((r) => ({
    id: req(r, 'id'),
    timestamp: parseLocal(req(r, 'timestamp')),
    machineId: knownMachine(req(r, 'machine_id'), `quality ${r.id}`),
    orderId: req(r, 'order_id'),
    inspected: int(r, 'inspected'),
    rejected: int(r, 'rejected'),
    defect: r.defect ? r.defect : null,
  }));

  const orders: Order[] = parseCsv(raw.ordersCsv).map((r) => {
    const status = req(r, 'status');
    if (!ORDER_STATUSES.includes(status)) throw new Error(`order ${r.id}: bad status ${status}`);
    const lineId = req(r, 'line_id');
    if (!lineIds.has(lineId)) throw new Error(`order ${r.id}: unknown line ${lineId}`);
    return {
      id: req(r, 'id'),
      product: req(r, 'product'),
      customer: req(r, 'customer'),
      quantity: int(r, 'quantity'),
      completed: int(r, 'completed'),
      lineId,
      due: parseLocal(req(r, 'due')),
      status: status as OrderStatus,
    };
  });

  return {
    plant,
    now: parseLocal(plant.snapshot),
    lines: plant.lines,
    machines: plant.machines,
    downtime,
    quality,
    orders,
  };
}

function req(r: Record<string, string>, key: string): string {
  const v = r[key];
  if (!v) throw new Error(`missing ${key} in ${JSON.stringify(r)}`);
  return v;
}

function int(r: Record<string, string>, key: string): number {
  const n = Number(req(r, key));
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`);
  return n;
}
