import { describe, expect, it } from 'vitest';
import { buildDataset } from '../src/domain/dataset';
import { executeTool } from '../src/agent/tools';
import type { Plant } from '../src/domain/types';

// Small hand-made plants that hit the edges of each status / risk rule.
// The demo data never sits exactly on a boundary, so these pin the rules themselves.

const plant: Plant = {
  company: { name: 'Test Works', site: 'T', fictional: true },
  snapshot: '2026-01-10T12:00',
  thresholds: { qualityAlarmRejectRate: 0.03, qualityWindowHours: 8, atRiskLoadFactor: 0.8 },
  lines: [{ id: 'A', name: { en: 'A', pl: 'A' }, ratePerHour: 10 }],
  machines: [{ id: 'A-1', line: 'A', kind: 'mill', name: { en: 'Mill', pl: 'Frezarka' } }],
};
const DT = 'id,machine_id,start,end,category,cause\n';
const QC = 'id,timestamp,machine_id,order_id,inspected,rejected,defect\n';
const OR = 'id,product,customer,quantity,completed,line_id,due,status\n';

function statusOf(downtimeCsv: string, qualityCsv: string) {
  const ds = buildDataset({
    plant,
    downtimeCsv: DT + downtimeCsv,
    qualityCsv: QC + qualityCsv,
    ordersCsv: OR,
  });
  const r = executeTool(ds, 'get_machine_status', { machine_id: 'A-1' });
  if (!r.ok) throw new Error(r.error);
  return (r.data as { machines: { status: string }[] }).machines[0]?.status;
}

function riskOf(ordersCsv: string) {
  const ds = buildDataset({ plant, downtimeCsv: DT, qualityCsv: QC, ordersCsv: OR + ordersCsv });
  const r = executeTool(ds, 'get_orders', {});
  if (!r.ok) throw new Error(r.error);
  return (r.data as { orders: { id: string; risk: string; risk_reasons: string[] }[] }).orders;
}

describe('machine status rule', () => {
  it('raises the quality alarm at exactly the threshold (3 of 100)', () => {
    expect(statusOf('', 'Q1,2026-01-10T11:00,A-1,O,100,3,Burr\n')).toBe('quality_alarm');
  });

  it('stays running just below it (2 of 100)', () => {
    expect(statusOf('', 'Q1,2026-01-10T11:00,A-1,O,100,2,Burr\n')).toBe('running');
  });

  it('ignores a check exactly at the window start (8 h ago) and counts one inside it', () => {
    expect(statusOf('', 'Q1,2026-01-10T04:00,A-1,O,10,5,Burr\n')).toBe('running');
    expect(statusOf('', 'Q1,2026-01-10T04:01,A-1,O,10,5,Burr\n')).toBe('quality_alarm');
  });

  it('a check with nothing inspected does not produce NaN or an alarm', () => {
    const empty = 'Q1,2026-01-10T11:00,A-1,O,0,0,\n';
    expect(statusOf('', empty)).toBe('running');
    const ds = buildDataset({ plant, downtimeCsv: DT, qualityCsv: QC + empty, ordersCsv: OR });
    const r = executeTool(ds, 'get_machine_status', { machine_id: 'A-1' });
    expect(
      r.ok && (r.data as { machines: { reject_rate_8h: number }[] }).machines[0]?.reject_rate_8h,
    ).toBe(0);
  });

  it('down wins over a quality alarm', () => {
    expect(
      statusOf('D1,A-1,2026-01-10T11:00,,unplanned,Jam\n', 'Q1,2026-01-10T11:00,A-1,O,10,5,Burr\n'),
    ).toBe('down');
  });

  it('a closed stoppage does not make a machine down', () => {
    expect(statusOf('D1,A-1,2026-01-10T10:00,2026-01-10T11:00,unplanned,Jam\n', '')).toBe(
      'running',
    );
  });
});

describe('order risk rule (line A: 10 pcs/h, now 2026-01-10T12:00)', () => {
  it('late when the hours needed exceed the hours left', () => {
    // 110 pcs = 11 h, due in 10 h
    expect(riskOf('O1,P,C,110,0,A,2026-01-10T22:00,in_progress\n')[0]).toMatchObject({
      risk: 'late',
    });
  });

  it('exactly enough time is not late, but above 80% load it is at risk', () => {
    // 100 pcs = 10 h, due in 10 h -> 100% load
    expect(riskOf('O1,P,C,100,0,A,2026-01-10T22:00,in_progress\n')[0]).toMatchObject({
      risk: 'at_risk',
      risk_reasons: ['line load 100% of the time left'],
    });
  });

  it('on track at exactly 80% load', () => {
    // 80 pcs = 8 h, due in 10 h
    expect(riskOf('O1,P,C,80,0,A,2026-01-10T22:00,in_progress\n')[0]).toMatchObject({
      risk: 'on_track',
      risk_reasons: [],
    });
  });

  it('works the queue in due-date order, not by id or file order', () => {
    // ids sort opposite to due dates: A-due-later is listed first and sorts first by id, but is due later.
    const csv =
      'A-due-later,P,C,50,0,A,2026-01-11T12:00,queued\nZ-due-first,P,C,50,0,A,2026-01-10T20:00,in_progress\n';
    const ds = buildDataset({ plant, downtimeCsv: DT, qualityCsv: QC, ordersCsv: OR + csv });
    const hours = (id: string) => {
      const r = executeTool(ds, 'get_orders', { order_id: id });
      if (!r.ok) throw new Error(r.error);
      return (r.data as { orders: { hours_needed_incl_queue: number }[] }).orders[0]
        ?.hours_needed_incl_queue;
    };
    // Z-due-first is due first: 5 h. A-due-later waits behind it: 5 h + 5 h.
    expect(hours('Z-due-first')).toBe(5);
    expect(hours('A-due-later')).toBe(10);
  });

  it('done orders are never at risk, even past due', () => {
    expect(riskOf('O1,P,C,10,10,A,2026-01-01T00:00,done\n')[0]).toMatchObject({ risk: 'done' });
  });
});
