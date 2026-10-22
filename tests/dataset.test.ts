import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/domain/csv';
import { formatLocal, parseLocal } from '../src/domain/time';
import { buildDataset } from '../src/domain/dataset';
import { sampleDataset } from './helpers';

describe('parseCsv', () => {
  it('reads a header row into keyed records and keeps empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3\n')).toEqual([{ a: '1', b: '', c: '3' }]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([{ a: 'x, y', b: 'say "hi"' }]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('rejects a row with the wrong number of fields', () => {
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/line 2/);
  });
});

describe('plant-local time', () => {
  it('measures minutes between two timestamps independently of the host time zone', () => {
    expect(parseLocal('2026-10-21T10:00') - parseLocal('2026-10-21T08:45')).toBe(75);
    // 2026-10-25 is the EU DST switch; plant time ignores it on purpose
    expect(parseLocal('2026-10-26T00:00') - parseLocal('2026-10-25T00:00')).toBe(1440);
  });

  it('round-trips a timestamp', () => {
    expect(formatLocal(parseLocal('2026-10-14T07:05'))).toBe('2026-10-14T07:05');
  });

  it('rejects anything that is not YYYY-MM-DDTHH:mm', () => {
    expect(() => parseLocal('21.10.2026 10:00')).toThrow();
  });
});

describe('buildDataset', () => {
  it('loads the sample plant: 3 lines, 12 machines, 13 downtime events, 13 checks, 7 orders', () => {
    const ds = sampleDataset();
    expect(ds.lines).toHaveLength(3);
    expect(ds.machines).toHaveLength(12);
    expect(ds.downtime).toHaveLength(13);
    expect(ds.quality).toHaveLength(13);
    expect(ds.orders).toHaveLength(7);
  });

  it('marks an event without an end time as ongoing', () => {
    const open = sampleDataset().downtime.filter((e) => e.end === null);
    expect(open.map((e) => e.id)).toEqual(['DT-113']);
  });

  it('refuses data that references a machine the plant does not have', () => {
    const ds = sampleDataset();
    expect(() =>
      buildDataset({
        plant: ds.plant,
        downtimeCsv:
          'id,machine_id,start,end,category,cause\nX,L9-M9,2026-10-14T07:00,,planned,x\n',
        qualityCsv: 'id,timestamp,machine_id,order_id,inspected,rejected,defect\n',
        ordersCsv: 'id,product,customer,quantity,completed,line_id,due,status\n',
      }),
    ).toThrow(/L9-M9/);
  });
});
