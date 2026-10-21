import {
  downtimeSummary,
  machineStatusRows,
  orderRows,
  plantOverview,
  qualitySummary,
} from '../domain/queries';
import type { Dataset } from '../domain/types';

// The agent's tools. One implementation serves both modes: the live server runs them for
// Claude, the recording script runs them to build the recorded scenarios, and a test checks
// that every recorded result still equals what the tool returns.

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
  [key: string]: unknown;
}

/** Same shape as Anthropic.Tool; kept SDK-free so the browser bundle never imports the SDK. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

const machineId = { type: 'string', description: 'Machine id such as "L2-M2".' };
const lineId = { type: 'string', description: 'Line id: "L1", "L2" or "L3".' };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_plant_overview',
    description:
      'Snapshot of the whole hall right now: lines, every machine with its status (running, down, quality_alarm), counts of orders by delivery risk, and total downtime over the last 7 days. Start here for broad questions.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_machine_status',
    description:
      'Current status of machines, optionally one machine or one line. A down machine includes since when, for how many minutes and why; a quality alarm includes the 8-hour reject rate and the main defect.',
    input_schema: {
      type: 'object',
      properties: { machine_id: machineId, line_id: lineId },
      additionalProperties: false,
    },
  },
  {
    name: 'get_downtime',
    description:
      'Downtime minutes over the last N days (default 7, max 7), grouped by machine and by cause, longest first, plus the individual events. An ongoing stoppage counts up to now. Filter by machine, line or category (planned / unplanned).',
    input_schema: {
      type: 'object',
      properties: {
        machine_id: machineId,
        line_id: lineId,
        category: { type: 'string', enum: ['planned', 'unplanned'] },
        days: { type: 'integer', minimum: 1, maximum: 7 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_quality',
    description:
      'Quality inspection results over the last N hours (default 8, max 168): inspected and rejected pieces, reject rate per machine against the alarm threshold, main defect. With machine_id it also lists the individual checks, which shows the trend.',
    input_schema: {
      type: 'object',
      properties: {
        machine_id: machineId,
        line_id: lineId,
        hours: { type: 'integer', minimum: 1, maximum: 168 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_orders',
    description:
      'Production orders with progress, hours left to the due date, line hours needed including the queue ahead, and a delivery risk (done, on_track, at_risk, late) with reasons. Filter by order id, line or status (queued, in_progress, done).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order id such as "ZL-2041".' },
        line_id: lineId,
        status: { type: 'string', enum: ['queued', 'in_progress', 'done'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'highlight_machines',
    description:
      'Highlights machines in the 3D view of the hall so the user sees what you are talking about. Use tone "alert" for problems and "info" otherwise. Call it whenever your answer is about specific machines.',
    input_schema: {
      type: 'object',
      properties: {
        machine_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
        tone: { type: 'string', enum: ['alert', 'info'] },
      },
      required: ['machine_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'focus_camera',
    description:
      'Flies the 3D camera to a machine (e.g. "L2-M2"), a line (e.g. "L2") or back to "overview". Use it once per answer, on the thing the answer is mainly about.',
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'Machine id, line id or "overview".' } },
      required: ['target'],
      additionalProperties: false,
    },
  },
];

class InputError extends Error {}

type Input = Record<string, unknown>;

function asInput(name: string, raw: unknown): Input {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InputError(`${name} expects an object input`);
  }
  const def = TOOL_DEFINITIONS.find((t) => t.name === name);
  const allowed = Object.keys(def?.input_schema.properties ?? {});
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new InputError(
      `Unknown field(s) ${unknown.join(', ')}; allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
  return raw as Input;
}

function optString(input: Input, key: string): string | undefined {
  const v = input[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new InputError(`${key} must be a string`);
  return v;
}

function optEnum<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
  const v = optString(input, key);
  if (v !== undefined && !values.includes(v as T)) {
    throw new InputError(`${key} must be one of ${values.join(', ')}`);
  }
  return v as T | undefined;
}

function optInt(input: Input, key: string, min: number, max: number, fallback: number): number {
  const v = input[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new InputError(`${key} must be an integer from ${min} to ${max}`);
  }
  return v;
}

function checkMachine(ds: Dataset, id: string | undefined) {
  if (id !== undefined && !ds.machines.some((m) => m.id === id)) {
    throw new InputError(
      `Unknown machine ${id}; valid ids: ${ds.machines.map((m) => m.id).join(', ')}`,
    );
  }
  return id;
}

function checkLine(ds: Dataset, id: string | undefined) {
  if (id !== undefined && !ds.lines.some((l) => l.id === id)) {
    throw new InputError(`Unknown line ${id}; valid ids: ${ds.lines.map((l) => l.id).join(', ')}`);
  }
  return id;
}

type Handler = (ds: Dataset, input: Input) => unknown;

const HANDLERS: Record<string, Handler> = {
  get_plant_overview: (ds) => plantOverview(ds),

  get_machine_status: (ds, input) => ({
    snapshot: ds.plant.snapshot,
    machines: machineStatusRows(ds, {
      machineId: checkMachine(ds, optString(input, 'machine_id')),
      lineId: checkLine(ds, optString(input, 'line_id')),
    }),
  }),

  get_downtime: (ds, input) =>
    downtimeSummary(ds, {
      machineId: checkMachine(ds, optString(input, 'machine_id')),
      lineId: checkLine(ds, optString(input, 'line_id')),
      category: optEnum(input, 'category', ['planned', 'unplanned'] as const),
      days: optInt(input, 'days', 1, 7, 7),
    }),

  get_quality: (ds, input) =>
    qualitySummary(ds, {
      machineId: checkMachine(ds, optString(input, 'machine_id')),
      lineId: checkLine(ds, optString(input, 'line_id')),
      hours: optInt(input, 'hours', 1, 168, ds.plant.thresholds.qualityWindowHours),
    }),

  get_orders: (ds, input) => {
    const orderId = optString(input, 'order_id');
    if (orderId !== undefined && !ds.orders.some((o) => o.id === orderId)) {
      throw new InputError(
        `Unknown order ${orderId}; valid ids: ${ds.orders.map((o) => o.id).join(', ')}`,
      );
    }
    return {
      snapshot: ds.plant.snapshot,
      orders: orderRows(ds, {
        orderId,
        lineId: checkLine(ds, optString(input, 'line_id')),
        status: optEnum(input, 'status', ['queued', 'in_progress', 'done'] as const),
      }),
    };
  },

  highlight_machines: (ds, input) => {
    const ids = input.machine_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 12) {
      throw new InputError('machine_ids must be a list of 1 to 12 machine ids');
    }
    for (const id of ids) {
      if (typeof id !== 'string') throw new InputError('machine_ids must contain strings');
      checkMachine(ds, id);
    }
    return { highlighted: ids, tone: optEnum(input, 'tone', ['alert', 'info'] as const) ?? 'info' };
  },

  focus_camera: (ds, input) => {
    const target = optString(input, 'target');
    if (target === undefined) throw new InputError('target is required');
    if (
      target !== 'overview' &&
      !ds.machines.some((m) => m.id === target) &&
      !ds.lines.some((l) => l.id === target)
    ) {
      throw new InputError(`Unknown target ${target}; use a machine id, a line id or "overview"`);
    }
    return { focused: target };
  },
};

/** Runs a tool by name. Bad input becomes an error result (sent back to Claude as is_error), never an exception. */
export function executeTool(ds: Dataset, name: string, rawInput: unknown): ToolResult {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    return { ok: true, data: handler(ds, asInput(name, rawInput)) };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}
