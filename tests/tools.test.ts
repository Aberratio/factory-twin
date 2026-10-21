import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, executeTool } from '../src/agent/tools';
import { demoDataset } from './helpers';

// Every expected figure below was worked out by hand from src/data/*.csv,
// with the plant snapshot at 2026-10-21T10:00 (src/data/plant.json).
const ds = demoDataset();
const run = (name: string, input: unknown = {}) => executeTool(ds, name, input);

function ok<T = Record<string, unknown>>(name: string, input: unknown = {}): T {
  const r = run(name, input);
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  return r.data as T;
}

describe('tool definitions', () => {
  it('exposes the five data tools and the two scene tools', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([
      'focus_camera',
      'get_downtime',
      'get_machine_status',
      'get_orders',
      'get_plant_overview',
      'get_quality',
      'highlight_machines',
    ]);
  });

  it('gives every tool an object schema that forbids unknown fields', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
});

describe('executeTool: input handling', () => {
  it('reports an unknown tool as an error, not an exception', () => {
    expect(run('drop_tables')).toEqual({ ok: false, error: 'Unknown tool: drop_tables' });
  });

  it('rejects unknown fields', () => {
    const r = run('get_downtime', { machine: 'L2-M2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/machine/);
  });

  it('rejects an unknown machine id with the list of valid ids', () => {
    const r = run('get_machine_status', { machine_id: 'L7-M1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/L7-M1.*L1-M1/);
  });

  it('rejects out-of-range and non-integer numbers', () => {
    expect(run('get_downtime', { days: 0 }).ok).toBe(false);
    expect(run('get_downtime', { days: 8 }).ok).toBe(false);
    expect(run('get_downtime', { days: 1.5 }).ok).toBe(false);
    expect(run('get_quality', { hours: 169 }).ok).toBe(false);
  });

  it('rejects a value outside an enum', () => {
    expect(run('get_downtime', { category: 'scheduled' }).ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    expect(run('get_orders', 'ZL-2041').ok).toBe(false);
  });
});

describe('get_machine_status', () => {
  it('derives status from data: open downtime -> down, reject rate >= 3% in 8 h -> quality_alarm', () => {
    const { machines } = ok<{ machines: { id: string; status: string }[] }>('get_machine_status');
    const byStatus = (s: string) => machines.filter((m) => m.status === s).map((m) => m.id);
    expect(byStatus('down')).toEqual(['L2-M2']);
    expect(byStatus('quality_alarm')).toEqual(['L1-M2']);
    expect(byStatus('running')).toHaveLength(10);
  });

  it('explains a stopped machine with its open event', () => {
    const { machines } = ok<{ machines: Record<string, unknown>[] }>('get_machine_status', {
      machine_id: 'L2-M2',
    });
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({
      id: 'L2-M2',
      status: 'down',
      down_since: '2026-10-21T08:45',
      down_minutes: 75,
      reason: 'Servo fault',
    });
  });

  it('explains a quality alarm with the reject rate', () => {
    const { machines } = ok<{ machines: Record<string, unknown>[] }>('get_machine_status', {
      machine_id: 'L1-M2',
    });
    expect(machines[0]).toMatchObject({
      status: 'quality_alarm',
      reject_rate_8h: 0.04,
      reason: 'Bore diameter out of tolerance',
    });
  });

  it('filters by line', () => {
    const { machines } = ok<{ machines: { id: string }[] }>('get_machine_status', {
      line_id: 'L3',
    });
    expect(machines.map((m) => m.id)).toEqual(['L3-M1', 'L3-M2', 'L3-M3', 'L3-M4']);
  });
});

describe('get_downtime', () => {
  interface Downtime {
    window: { from: string; to: string };
    total_minutes: number;
    by_machine: { machine_id: string; minutes: number; events: number }[];
    by_cause: { cause: string; minutes: number; events: number }[];
    events: { id: string; minutes: number; ongoing: boolean }[];
  }

  it('sums the last 7 days, clipping to the window and counting the open event up to now', () => {
    const d = ok<Downtime>('get_downtime');
    expect(d.window).toEqual({ from: '2026-10-14T10:00', to: '2026-10-21T10:00' });
    expect(d.total_minutes).toBe(680); // DT-101 ends before the window opens
    expect(d.by_machine[0]).toEqual({ machine_id: 'L2-M2', minutes: 290, events: 4 });
    expect(d.by_machine.map((m) => m.minutes)).toEqual([290, 170, 70, 45, 40, 35, 30]);
    expect(d.events.find((e) => e.id === 'DT-113')).toMatchObject({ minutes: 75, ongoing: true });
    expect(d.events.some((e) => e.id === 'DT-101')).toBe(false);
  });

  it('clips an event that straddles the window start', () => {
    // 1-day window opens 2026-10-20T10:00; DT-111 (09:00-09:30) is out, DT-112 and DT-113 are in
    const d = ok<Downtime>('get_downtime', { days: 1 });
    expect(d.events.map((e) => e.id)).toEqual(['DT-113', 'DT-112']);
    expect(d.total_minutes).toBe(125);
  });

  it('separates planned from unplanned', () => {
    expect(ok<Downtime>('get_downtime', { category: 'unplanned' }).total_minutes).toBe(500);
    expect(ok<Downtime>('get_downtime', { category: 'planned' }).total_minutes).toBe(180);
  });

  it('groups by cause, longest first', () => {
    const d = ok<Downtime>('get_downtime');
    expect(d.by_cause.slice(0, 2)).toEqual([
      { cause: 'Preventive maintenance', minutes: 150, events: 2 },
      { cause: 'Servo overheating', minutes: 140, events: 2 },
    ]);
  });

  it('narrows the scope by line and by machine', () => {
    expect(ok<Downtime>('get_downtime', { line_id: 'L3' }).total_minutes).toBe(205);
    expect(ok<Downtime>('get_downtime', { machine_id: 'L1-M2' }).total_minutes).toBe(70);
  });
});

describe('get_quality', () => {
  interface Quality {
    window: { from: string; to: string };
    threshold: number;
    by_machine: {
      machine_id: string;
      inspected: number;
      rejected: number;
      reject_rate: number;
      above_threshold: boolean;
      top_defect: string | null;
    }[];
    checks?: { timestamp: string; rejected: number }[];
  }

  it('reports the 8-hour window with the worst reject rate first', () => {
    const q = ok<Quality>('get_quality');
    expect(q.window).toEqual({ from: '2026-10-21T02:00', to: '2026-10-21T10:00' });
    expect(q.threshold).toBe(0.03);
    expect(q.by_machine[0]).toEqual({
      machine_id: 'L1-M2',
      inspected: 200,
      rejected: 8,
      reject_rate: 0.04,
      above_threshold: true,
      top_defect: 'Bore diameter out of tolerance',
    });
    expect(q.by_machine.filter((m) => m.above_threshold)).toHaveLength(1);
    expect(q.checks).toBeUndefined();
  });

  it('lists the individual checks when asked about one machine', () => {
    const q = ok<Quality>('get_quality', { machine_id: 'L1-M2' });
    expect(q.checks?.map((c) => c.rejected)).toEqual([0, 1, 3, 4]);
  });

  it('a week-long window dilutes the same machine below the threshold', () => {
    const q = ok<Quality>('get_quality', { hours: 168, machine_id: 'L1-M2' });
    expect(q.by_machine[0]).toMatchObject({ inspected: 350, rejected: 9, above_threshold: false });
  });
});

describe('get_orders', () => {
  interface Orders {
    orders: {
      id: string;
      risk: string;
      remaining: number;
      hours_to_due: number;
      hours_needed_incl_queue: number;
      risk_reasons: string[];
    }[];
  }

  it('rates every order against line capacity, the queue ahead and the line state', () => {
    const { orders } = ok<Orders>('get_orders');
    const risk = Object.fromEntries(orders.map((o) => [o.id, o.risk]));
    expect(risk).toEqual({
      'ZL-2035': 'done',
      'ZL-2038': 'at_risk',
      'ZL-2041': 'at_risk',
      'ZL-2043': 'late',
      'ZL-2044': 'on_track',
      'ZL-2047': 'at_risk',
      'ZL-2050': 'at_risk',
    });
  });

  it('explains ZL-2041: enough capacity, but the welding cell on its line is down', () => {
    const { orders } = ok<Orders>('get_orders', { order_id: 'ZL-2041' });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      remaining: 420,
      hours_to_due: 28,
      hours_needed_incl_queue: 7,
      risk: 'at_risk',
      risk_reasons: ['L2-M2 is down (Servo fault)'],
    });
  });

  it('flags ZL-2043 as late: 800 pcs at 40/h need 20 h, 8 h remain', () => {
    const { orders } = ok<Orders>('get_orders', { order_id: 'ZL-2043' });
    expect(orders[0]).toMatchObject({ hours_to_due: 8, hours_needed_incl_queue: 20, risk: 'late' });
  });

  it('counts the queue ahead: ZL-2047 waits behind ZL-2041 on L2 (7 h + 13.3 h)', () => {
    const { orders } = ok<Orders>('get_orders', { order_id: 'ZL-2047' });
    expect(orders[0]?.hours_needed_incl_queue).toBe(20.3);
  });

  it('keeps a healthy line under 80% load on track (ZL-2044: 22 h of 48 h)', () => {
    // pin: the at-risk load-factor arm itself is tested in rules.test.ts
    const { orders } = ok<Orders>('get_orders', { order_id: 'ZL-2044' });
    expect(orders[0]).toMatchObject({ hours_needed_incl_queue: 22, risk: 'on_track' });
  });

  it('filters by status and line', () => {
    expect(ok<Orders>('get_orders', { status: 'queued' }).orders.map((o) => o.id)).toEqual([
      'ZL-2047',
      'ZL-2050',
    ]);
    expect(ok<Orders>('get_orders', { line_id: 'L3' }).orders.map((o) => o.id)).toEqual([
      'ZL-2035',
      'ZL-2043',
      'ZL-2044',
    ]);
  });

  it('rejects an unknown order id', () => {
    expect(run('get_orders', { order_id: 'ZL-9999' }).ok).toBe(false);
  });
});

describe('get_plant_overview', () => {
  it('summarises the shift in one call', () => {
    expect(ok('get_plant_overview')).toMatchObject({
      company: 'Veldra Components',
      site: 'Hall A',
      snapshot: '2026-10-21T10:00',
      status_counts: { running: 10, down: 1, quality_alarm: 1 },
      machines_down: ['L2-M2'],
      quality_alarms: ['L1-M2'],
      order_risk_counts: { late: 1, at_risk: 4, on_track: 1, done: 1 },
      downtime_minutes_7d: 680,
    });
  });
});

describe('scene tools', () => {
  it('highlight_machines accepts known ids and echoes them', () => {
    expect(run('highlight_machines', { machine_ids: ['L2-M2'], tone: 'alert' })).toEqual({
      ok: true,
      data: { highlighted: ['L2-M2'], tone: 'alert' },
    });
  });

  it('highlight_machines defaults the tone to info', () => {
    expect(run('highlight_machines', { machine_ids: ['L1-M1'] })).toEqual({
      ok: true,
      data: { highlighted: ['L1-M1'], tone: 'info' },
    });
  });

  it('highlight_machines refuses an empty or unknown list', () => {
    expect(run('highlight_machines', { machine_ids: [] }).ok).toBe(false);
    expect(run('highlight_machines', { machine_ids: ['X-1'] }).ok).toBe(false);
  });

  it('focus_camera takes a machine, a line or the overview', () => {
    expect(run('focus_camera', { target: 'L1-M2' })).toEqual({
      ok: true,
      data: { focused: 'L1-M2' },
    });
    expect(run('focus_camera', { target: 'L3' }).ok).toBe(true);
    expect(run('focus_camera', { target: 'overview' }).ok).toBe(true);
    expect(run('focus_camera', { target: 'roof' }).ok).toBe(false);
    expect(run('focus_camera', {}).ok).toBe(false);
  });
});

describe('determinism', () => {
  it('returns identical results on repeated calls, for every tool with valid input', () => {
    const inputs: Record<string, unknown> = {
      highlight_machines: { machine_ids: ['L2-M2'], tone: 'alert' },
      focus_camera: { target: 'L2' },
    };
    for (const t of TOOL_DEFINITIONS) {
      const first = run(t.name, inputs[t.name] ?? {});
      expect(first.ok, t.name).toBe(true);
      expect(JSON.stringify(run(t.name, inputs[t.name] ?? {}))).toBe(JSON.stringify(first));
    }
  });

  it('does not treat Object prototype keys as tools', () => {
    for (const name of ['constructor', 'hasOwnProperty', 'toString', '__proto__']) {
      expect(run(name)).toEqual({ ok: false, error: `Unknown tool: ${name}` });
    }
  });
});
