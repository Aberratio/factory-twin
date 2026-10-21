import { formatLocal } from './time';
import type { Dataset, DowntimeEvent, Machine, MachineStatus, Order } from './types';

// Pure read models over the dataset. Every number the agent reports comes from here,
// in recorded and in live mode alike.

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export interface MachineState {
  machine: Machine;
  status: MachineStatus;
  openEvent: DowntimeEvent | null;
  rejectRate: number;
  topDefect: string | null;
}

export function machineStates(ds: Dataset): MachineState[] {
  const quality = qualityByMachine(ds, ds.plant.thresholds.qualityWindowHours);
  return ds.machines.map((machine) => {
    const openEvent = ds.downtime.find((e) => e.machineId === machine.id && e.end === null) ?? null;
    const q = quality.get(machine.id);
    const rejectRate = q?.inspected ? q.rejected / q.inspected : 0;
    const status: MachineStatus = openEvent
      ? 'down'
      : rejectRate >= ds.plant.thresholds.qualityAlarmRejectRate
        ? 'quality_alarm'
        : 'running';
    return { machine, status, openEvent, rejectRate, topDefect: q?.topDefect ?? null };
  });
}

export function machineStatusRows(ds: Dataset, filter: { machineId?: string; lineId?: string }) {
  return machineStates(ds)
    .filter(
      (s) =>
        (!filter.machineId || s.machine.id === filter.machineId) &&
        (!filter.lineId || s.machine.line === filter.lineId),
    )
    .map((s) => ({
      id: s.machine.id,
      name: s.machine.name.en,
      line_id: s.machine.line,
      status: s.status,
      ...(s.openEvent
        ? {
            down_since: formatLocal(s.openEvent.start),
            down_minutes: ds.now - s.openEvent.start,
            reason: s.openEvent.cause,
          }
        : {}),
      reject_rate_8h: round(s.rejectRate, 4),
      ...(s.status === 'quality_alarm' ? { reason: s.topDefect } : {}),
    }));
}

export interface DowntimeFilter {
  machineId?: string;
  lineId?: string;
  category?: 'planned' | 'unplanned';
  days: number;
}

export function downtimeSummary(ds: Dataset, filter: DowntimeFilter) {
  const from = ds.now - filter.days * 24 * 60;
  const to = ds.now;
  const lineOf = new Map(ds.machines.map((m) => [m.id, m.line]));
  const events = ds.downtime
    .filter(
      (e) =>
        (!filter.machineId || e.machineId === filter.machineId) &&
        (!filter.lineId || lineOf.get(e.machineId) === filter.lineId) &&
        (!filter.category || e.category === filter.category),
    )
    .map((e) => {
      const start = Math.max(e.start, from);
      const end = Math.min(e.end ?? to, to);
      return { e, minutes: Math.max(0, end - start) };
    })
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.e.start - a.e.start);

  const group = (key: (e: DowntimeEvent) => string) => {
    const acc = new Map<string, { minutes: number; events: number }>();
    for (const { e, minutes } of events) {
      const g = acc.get(key(e)) ?? { minutes: 0, events: 0 };
      g.minutes += minutes;
      g.events += 1;
      acc.set(key(e), g);
    }
    return [...acc.entries()].sort(
      (a, b) => b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]),
    );
  };

  return {
    window: { from: formatLocal(from), to: formatLocal(to) },
    total_minutes: events.reduce((sum, x) => sum + x.minutes, 0),
    by_machine: group((e) => e.machineId).map(([machine_id, g]) => ({ machine_id, ...g })),
    by_cause: group((e) => e.cause).map(([cause, g]) => ({ cause, ...g })),
    events: events.map(({ e, minutes }) => ({
      id: e.id,
      machine_id: e.machineId,
      start: formatLocal(e.start),
      end: e.end === null ? null : formatLocal(e.end),
      ongoing: e.end === null,
      minutes,
      category: e.category,
      cause: e.cause,
    })),
  };
}

interface QualityAgg {
  inspected: number;
  rejected: number;
  topDefect: string | null;
}

function qualityByMachine(ds: Dataset, hours: number, machineIds?: Set<string>) {
  const from = ds.now - hours * 60;
  const acc = new Map<string, QualityAgg & { defects: Map<string, number> }>();
  for (const c of ds.quality) {
    if (c.timestamp <= from || c.timestamp > ds.now) continue;
    if (machineIds && !machineIds.has(c.machineId)) continue;
    const a = acc.get(c.machineId) ?? {
      inspected: 0,
      rejected: 0,
      topDefect: null,
      defects: new Map(),
    };
    a.inspected += c.inspected;
    a.rejected += c.rejected;
    if (c.defect && c.rejected > 0)
      a.defects.set(c.defect, (a.defects.get(c.defect) ?? 0) + c.rejected);
    acc.set(c.machineId, a);
  }
  const out = new Map<string, QualityAgg>();
  for (const [id, a] of acc) {
    const top = [...a.defects.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    out.set(id, { inspected: a.inspected, rejected: a.rejected, topDefect: top ? top[0] : null });
  }
  return out;
}

export function qualitySummary(
  ds: Dataset,
  filter: { machineId?: string; lineId?: string; hours: number },
) {
  const threshold = ds.plant.thresholds.qualityAlarmRejectRate;
  const scope = new Set(
    ds.machines
      .filter(
        (m) =>
          (!filter.machineId || m.id === filter.machineId) &&
          (!filter.lineId || m.line === filter.lineId),
      )
      .map((m) => m.id),
  );
  const from = ds.now - filter.hours * 60;
  const by_machine = [...qualityByMachine(ds, filter.hours, scope).entries()]
    .map(([machine_id, q]) => {
      const rate = q.inspected ? q.rejected / q.inspected : 0;
      return {
        machine_id,
        inspected: q.inspected,
        rejected: q.rejected,
        reject_rate: round(rate, 4),
        above_threshold: rate >= threshold,
        top_defect: q.topDefect,
      };
    })
    .sort((a, b) => b.reject_rate - a.reject_rate || a.machine_id.localeCompare(b.machine_id));

  return {
    window: { from: formatLocal(from), to: formatLocal(ds.now) },
    threshold,
    by_machine,
    ...(filter.machineId
      ? {
          checks: ds.quality
            .filter(
              (c) =>
                c.machineId === filter.machineId && c.timestamp > from && c.timestamp <= ds.now,
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((c) => ({
              id: c.id,
              timestamp: formatLocal(c.timestamp),
              order_id: c.orderId,
              inspected: c.inspected,
              rejected: c.rejected,
              defect: c.defect,
            })),
        }
      : {}),
  };
}

export type OrderRisk = 'done' | 'late' | 'at_risk' | 'on_track';

export function orderRows(
  ds: Dataset,
  filter: { orderId?: string; lineId?: string; status?: string },
) {
  const states = machineStates(ds);
  const lineProblems = (lineId: string) =>
    states
      .filter((s) => s.machine.line === lineId && s.status !== 'running')
      .map((s) =>
        s.status === 'down'
          ? `${s.machine.id} is down (${s.openEvent?.cause ?? 'unknown cause'})`
          : `${s.machine.id} has a quality alarm (${round(s.rejectRate * 100, 1)}% rejects)`,
      );

  // Queue model: each line works its open orders in due-date order at its nominal rate.
  const hoursNeeded = new Map<string, number>();
  for (const line of ds.lines) {
    let cumulative = 0;
    ds.orders
      .filter((o) => o.lineId === line.id && o.status !== 'done')
      .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))
      .forEach((o) => {
        cumulative += (o.quantity - o.completed) / line.ratePerHour;
        hoursNeeded.set(o.id, cumulative);
      });
  }

  const rate = (o: Order) => {
    const hoursToDue = (o.due - ds.now) / 60;
    if (o.status === 'done')
      return { hoursToDue, needed: 0, risk: 'done' as OrderRisk, reasons: [] };
    const needed = hoursNeeded.get(o.id) ?? 0;
    const reasons: string[] = [];
    let risk: OrderRisk = 'on_track';
    if (needed > hoursToDue) {
      risk = 'late';
      reasons.push(`needs ${round(needed, 1)} h of line time, ${round(hoursToDue, 1)} h left`);
    } else {
      if (needed > hoursToDue * ds.plant.thresholds.atRiskLoadFactor) {
        reasons.push(`line load ${Math.round((needed / hoursToDue) * 100)}% of the time left`);
      }
      reasons.push(...lineProblems(o.lineId));
      if (reasons.length) risk = 'at_risk';
    }
    return { hoursToDue, needed, risk, reasons };
  };

  return ds.orders
    .filter(
      (o) =>
        (!filter.orderId || o.id === filter.orderId) &&
        (!filter.lineId || o.lineId === filter.lineId) &&
        (!filter.status || o.status === filter.status),
    )
    .map((o) => {
      const r = rate(o);
      return {
        id: o.id,
        product: o.product,
        customer: o.customer,
        line_id: o.lineId,
        status: o.status,
        quantity: o.quantity,
        completed: o.completed,
        remaining: o.quantity - o.completed,
        due: formatLocal(o.due),
        hours_to_due: round(r.hoursToDue, 1),
        hours_needed_incl_queue: round(r.needed, 1),
        risk: r.risk,
        risk_reasons: r.reasons,
      };
    });
}

export function plantOverview(ds: Dataset) {
  const states = machineStates(ds);
  const count = (s: MachineStatus) => states.filter((x) => x.status === s).length;
  const orders = orderRows(ds, {});
  const riskCount = (r: OrderRisk) => orders.filter((o) => o.risk === r).length;
  return {
    company: ds.plant.company.name,
    site: ds.plant.company.site,
    snapshot: ds.plant.snapshot,
    lines: ds.lines.map((l) => ({
      id: l.id,
      name: l.name.en,
      rate_per_hour: l.ratePerHour,
      machines: states
        .filter((s) => s.machine.line === l.id)
        .map((s) => ({ id: s.machine.id, status: s.status })),
    })),
    status_counts: {
      running: count('running'),
      down: count('down'),
      quality_alarm: count('quality_alarm'),
    },
    machines_down: states.filter((s) => s.status === 'down').map((s) => s.machine.id),
    quality_alarms: states.filter((s) => s.status === 'quality_alarm').map((s) => s.machine.id),
    order_risk_counts: {
      late: riskCount('late'),
      at_risk: riskCount('at_risk'),
      on_track: riskCount('on_track'),
      done: riskCount('done'),
    },
    downtime_minutes_7d: downtimeSummary(ds, { days: 7 }).total_minutes,
  };
}
