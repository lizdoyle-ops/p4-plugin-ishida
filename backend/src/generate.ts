/**
 * Deterministic generation of the "custom objects" that hang off a machine —
 * the Front-side replacement for Zendesk's related-object lookup.
 *
 * Everything is seeded from the serial number, so the same serial always yields
 * the same work orders, parts and quotes. That matters: a demo that reshuffles
 * its data between rehearsal and the live call is worse than no demo.
 */

import { hasActiveContract } from './derive.js';
import type {
  AssociatedObjects,
  MachineRow,
  Quote,
  ServiceContractRecord,
  SparePart,
  WorkOrder,
} from './types.js';

/** FNV-1a — small, stable string hash to seed the PRNG. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG. */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

const intBetween = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

/** Deterministic date offset from a base date, in days. */
function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Machine-type flavour ─────────────────────────────────────────────────────
// Faults and parts differ by machine family, so the panel reads like real ERP
// data rather than lorem ipsum.

const FAULTS: Record<string, readonly string[]> = {
  CCW: [
    'Hopper cross-feed jam on weigh head 7',
    'Load cell drift outside tolerance on heads 3 and 11',
    'Radial feeder amplitude inconsistent at high speed',
    'Discharge chute timing out of sync with bagmaker',
  ],
  'X-RAY': [
    'Image contrast degradation — detector calibration required',
    'Conveyor belt tracking fault triggering reject alarm',
    'Reject air valve slow to actuate',
    'Generator warning: tube temperature above threshold',
  ],
  DACS: [
    'Weigh platform zero drift after washdown',
    'Reject flap sticking intermittently',
    'Load cell overload alarm on infeed',
    'Belt speed sensor reading erratic',
  ],
  CHECKWEIGHER: [
    'Weigh platform zero drift after washdown',
    'Reject flap sticking intermittently',
    'Belt speed sensor reading erratic',
  ],
  Bagmaker: [
    'Cross seal temperature instability',
    'Film tracking drift causing seal contamination',
    'Date coder misfiring on every fourth pack',
  ],
  Traysealer: [
    'Seal tool not reaching set temperature',
    'Vacuum pump not holding target pressure',
    'Tray indexing misalignment at high rate',
  ],
};

const PARTS: Record<string, ReadonlyArray<{ part_no: string; description: string }>> = {
  CCW: [
    { part_no: 'IS-CCW-LC-2201', description: 'Load cell assembly, 224W head' },
    { part_no: 'IS-CCW-HB-1140', description: 'Hopper bucket, radial feeder' },
    { part_no: 'IS-CCW-DR-3315', description: 'Drive unit, weigh head' },
    { part_no: 'IS-CCW-SP-0087', description: 'Spring pack, feeder pan' },
  ],
  'X-RAY': [
    { part_no: 'IS-IX-DET-4410', description: 'Detector array module, EN series' },
    { part_no: 'IS-IX-TUB-2205', description: 'X-ray tube assembly' },
    { part_no: 'IS-IX-BLT-1180', description: 'Conveyor belt, food-grade' },
    { part_no: 'IS-IX-VLV-0342', description: 'Reject air valve' },
  ],
  DACS: [
    { part_no: 'IS-DACS-LC-0912', description: 'Load cell, DACS-G series' },
    { part_no: 'IS-DACS-FLP-0455', description: 'Reject flap actuator' },
    { part_no: 'IS-DACS-BLT-0771', description: 'Weigh belt, 015 frame' },
  ],
  CHECKWEIGHER: [
    { part_no: 'IS-DACS-LC-0912', description: 'Load cell, DACS-W series' },
    { part_no: 'IS-DACS-FLP-0455', description: 'Reject flap actuator' },
    { part_no: 'IS-DACS-SNS-0233', description: 'Belt speed sensor' },
  ],
  Bagmaker: [
    { part_no: 'IS-ATL-SEAL-5501', description: 'Cross seal jaw, Atlas RS' },
    { part_no: 'IS-ATL-HTR-2210', description: 'Heater cartridge, 400W' },
    { part_no: 'IS-ATL-FLM-1099', description: 'Film tracking roller' },
  ],
  Traysealer: [
    { part_no: 'IS-QX-TOOL-7720', description: 'Seal tool insert, QX-1100' },
    { part_no: 'IS-QX-VAC-3310', description: 'Vacuum pump service kit' },
    { part_no: 'IS-QX-GSK-0410', description: 'Chamber gasket set' },
  ],
};

const GENERIC_FAULTS = [
  'Intermittent stop — no fault code logged',
  'Routine preventive maintenance visit',
  'Operator training follow-up after commissioning',
] as const;

const GENERIC_PARTS = [
  { part_no: 'IS-GEN-FLT-0100', description: 'Air filter element' },
  { part_no: 'IS-GEN-SNS-0210', description: 'Proximity sensor, M12' },
] as const;

const WO_STATUSES = ['Open', 'Awaiting parts', 'Scheduled', 'Completed', 'Completed'] as const;
const ENGINEERS = [
  'M. Ferreira',
  'J. Alvarez',
  'K. Nowak',
  'S. Dubois',
  'T. van Dijk',
  'A. Ricci',
  'D. Whitfield',
] as const;
const STOCK = ['In stock — EU hub', 'In stock — local', 'On order (5 days)', 'Backorder'] as const;
const QUOTE_STATUSES = ['Sent', 'Accepted', 'Pending approval', 'Expired'] as const;

function contractLevel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('ultimate')) return 'Ultimate';
  if (n.includes('365')) return 'Standard';
  return 'Basic';
}

function contractSla(level: string): string {
  if (level === 'Ultimate') return '4h remote / next business day on-site';
  if (level === 'Standard') return '8h remote / 2 business days on-site';
  return 'Next business day remote';
}

export function generateAssociatedObjects(machine: MachineRow): AssociatedObjects {
  const rng = makeRng(hashSeed(machine.serial_number));

  const faults = FAULTS[machine.machine_type] ?? GENERIC_FAULTS;
  const parts = PARTS[machine.machine_type] ?? GENERIC_PARTS;

  // Work orders: 1–3. Faults are drawn without replacement so a machine never
  // shows the same complaint twice — repeated rows read as a bug on screen.
  const workOrderCount = Math.min(intBetween(rng, 1, 3), faults.length);
  const remainingFaults = [...faults];
  const work_orders: WorkOrder[] = [];
  for (let i = 0; i < workOrderCount; i++) {
    const [summary] = remainingFaults.splice(Math.floor(rng() * remainingFaults.length), 1);
    work_orders.push({
      id: `WO-${intBetween(rng, 100000, 999999)}`,
      status: pick(rng, WO_STATUSES),
      summary,
      opened_date: shiftDate(machine.install_date, intBetween(rng, 30, 900)),
      engineer: pick(rng, ENGINEERS),
    });
  }
  work_orders.sort((a, b) => b.opened_date.localeCompare(a.opened_date));

  // Spare parts: 1–3 distinct entries from this machine family.
  const partCount = Math.min(intBetween(rng, 1, 3), parts.length);
  const chosen = [...parts];
  const spare_parts: SparePart[] = [];
  for (let i = 0; i < partCount; i++) {
    const [part] = chosen.splice(Math.floor(rng() * chosen.length), 1);
    spare_parts.push({
      part_no: part.part_no,
      description: part.description,
      qty: intBetween(rng, 1, 4),
      stock_status: pick(rng, STOCK),
    });
  }

  // Quotes: 0–2. Machines outside warranty are likelier to have one open.
  const quoteCount = machine.warranty_active ? intBetween(rng, 0, 1) : intBetween(rng, 1, 2);
  const quotes: Quote[] = [];
  for (let i = 0; i < quoteCount; i++) {
    quotes.push({
      id: `QT-${intBetween(rng, 10000, 99999)}`,
      amount: intBetween(rng, 4, 180) * 25,
      currency: machine.country === 'United Kingdom' ? 'GBP' : 'EUR',
      status: pick(rng, QUOTE_STATUSES),
      issued_date: shiftDate(machine.install_date, intBetween(rng, 60, 950)),
    });
  }

  // Service contract record, only when one is actually held.
  let service_contract: ServiceContractRecord | null = null;
  if (hasActiveContract(machine.service_contract)) {
    const name = machine.service_contract as string;
    const level = contractLevel(name);
    service_contract = {
      name,
      level,
      // Contracts renew annually; expiry sits ahead of the warranty expiry.
      expiry: shiftDate(machine.warranty_expiry, intBetween(rng, 180, 730)),
      response_sla: contractSla(level),
    };
  }

  return { work_orders, spare_parts, quotes, service_contract };
}
