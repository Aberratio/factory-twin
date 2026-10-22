export type Lang = 'en' | 'pl';
export type Localized = Record<Lang, string>;

export interface Line {
  id: string;
  name: Localized;
  /** Nominal output of the whole line, pieces per hour. */
  ratePerHour: number;
}

export interface Machine {
  id: string;
  line: string;
  kind: string;
  name: Localized;
}

export interface Plant {
  company: { name: string; site: Localized; fictional: boolean };
  /** "Now" for the whole app, in plant-local time. Every query is relative to it. */
  snapshot: string;
  thresholds: {
    qualityAlarmRejectRate: number;
    qualityWindowHours: number;
    atRiskLoadFactor: number;
  };
  lines: Line[];
  machines: Machine[];
}

export interface DowntimeEvent {
  id: string;
  machineId: string;
  start: number;
  /** null while the machine is still stopped. */
  end: number | null;
  category: 'planned' | 'unplanned';
  cause: string;
}

export interface QualityCheck {
  id: string;
  timestamp: number;
  machineId: string;
  orderId: string;
  inspected: number;
  rejected: number;
  defect: string | null;
}

export type OrderStatus = 'queued' | 'in_progress' | 'done';

export interface Order {
  id: string;
  product: string;
  customer: string;
  quantity: number;
  completed: number;
  lineId: string;
  due: number;
  status: OrderStatus;
}

export interface Dataset {
  plant: Plant;
  /** Snapshot in minutes (see time.ts). */
  now: number;
  lines: Line[];
  machines: Machine[];
  downtime: DowntimeEvent[];
  quality: QualityCheck[];
  orders: Order[];
}

export type MachineStatus = 'running' | 'down' | 'quality_alarm';
