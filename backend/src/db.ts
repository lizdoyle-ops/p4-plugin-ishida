/**
 * SQLite store, rebuilt from data/Ishida_ERP_Serial_Lookup.csv on every boot.
 *
 * Ishida's real ERP is on-prem and can only push data out, never be queried.
 * This is the "duplicated object table" that stands in for it — the same pattern
 * their Zendesk custom objects use today.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MachineRow, TicketSnapshot } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve data/ whether running from src/ (tsx) or dist/ (compiled). */
function resolveCsvPath(): string {
  const candidates = [
    process.env.SEED_CSV_PATH,
    path.resolve(__dirname, '../../data/Ishida_ERP_Serial_Lookup.csv'),
    path.resolve(__dirname, '../../../data/Ishida_ERP_Serial_Lookup.csv'),
    path.resolve(process.cwd(), 'data/Ishida_ERP_Serial_Lookup.csv'),
    path.resolve(process.cwd(), '../data/Ishida_ERP_Serial_Lookup.csv'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Seed CSV not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
      'Set SEED_CSV_PATH to override.',
  );
}

/**
 * Minimal RFC-4180 parser: handles quoted fields and embedded commas.
 * Small enough to keep here rather than pull in a dependency.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = (cells[idx] ?? '').trim();
    });
    return record;
  });
}

const truthy = new Set(['true', 'yes', '1', 'y', 'active']);
/** Empty CSV cells become null, not the string "". */
const orNull = (value: string): string | null => (value === '' ? null : value);

export const db = new Database(process.env.DB_PATH ?? ':memory:');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    serial_number    TEXT PRIMARY KEY,
    model_code       TEXT NOT NULL,
    machine_type     TEXT NOT NULL,
    customer_account TEXT NOT NULL,
    country          TEXT NOT NULL,
    region_inbox     TEXT NOT NULL,
    install_date     TEXT NOT NULL,
    warranty_active  INTEGER NOT NULL,
    warranty_expiry  TEXT NOT NULL,
    service_contract TEXT,
    ln_reference     TEXT NOT NULL,
    key_account      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_machines_account ON machines (customer_account);

  CREATE TABLE IF NOT EXISTS ticket_snapshots (
    conversation_id TEXT PRIMARY KEY,
    fields_json     TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  -- Manual edits made by an agent in the plugin. Kept apart from snapshots so
  -- the panel can tell "the AI filled this" from "a person changed this".
  CREATE TABLE IF NOT EXISTS ticket_edits (
    conversation_id TEXT PRIMARY KEY,
    fields_json     TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
`);

/** Wipe and reload the machines table from the CSV. Called once at boot. */
export function seedFromCsv(): number {
  const csvPath = resolveCsvPath();
  const records = parseCsv(fs.readFileSync(csvPath, 'utf8'));

  const insert = db.prepare(`
    INSERT INTO machines (
      serial_number, model_code, machine_type, customer_account, country,
      region_inbox, install_date, warranty_active, warranty_expiry,
      service_contract, ln_reference, key_account
    ) VALUES (
      @serial_number, @model_code, @machine_type, @customer_account, @country,
      @region_inbox, @install_date, @warranty_active, @warranty_expiry,
      @service_contract, @ln_reference, @key_account
    )
  `);

  const load = db.transaction((rows: Array<Record<string, string>>) => {
    db.prepare('DELETE FROM machines').run();
    for (const r of rows) {
      if (!r.serial_number) continue;
      insert.run({
        serial_number: r.serial_number,
        model_code: r.model_code,
        machine_type: r.machine_type,
        customer_account: r.customer_account,
        country: r.country,
        region_inbox: r.region_inbox,
        install_date: r.install_date,
        warranty_active: truthy.has(r.warranty_active.toLowerCase()) ? 1 : 0,
        warranty_expiry: r.warranty_expiry,
        service_contract: orNull(r.service_contract),
        ln_reference: r.ln_reference,
        key_account: orNull(r.key_account),
      });
    }
  });

  load(records);
  console.log(`[seed] loaded ${records.length} machines from ${csvPath}`);
  return records.length;
}

/** SQLite has no boolean type; convert the stored 0/1 back on the way out. */
function toMachineRow(raw: Record<string, unknown>): MachineRow {
  return { ...raw, warranty_active: raw.warranty_active === 1 } as MachineRow;
}

export function findMachine(serial: string): MachineRow | null {
  const raw = db
    .prepare('SELECT * FROM machines WHERE serial_number = ?')
    .get(serial.trim()) as Record<string, unknown> | undefined;
  return raw ? toMachineRow(raw) : null;
}

/** Case-insensitive on account name — the playbook may pass it in any casing. */
export function findMachinesByAccount(account: string): MachineRow[] {
  const raws = db
    .prepare(
      'SELECT * FROM machines WHERE LOWER(customer_account) = LOWER(?) ORDER BY serial_number',
    )
    .all(account.trim()) as Array<Record<string, unknown>>;
  return raws.map(toMachineRow);
}

export function listMachines(): MachineRow[] {
  const raws = db
    .prepare('SELECT * FROM machines ORDER BY serial_number')
    .all() as Array<Record<string, unknown>>;
  return raws.map(toMachineRow);
}

export function saveSnapshot(conversationId: string, fields: Record<string, unknown>): TicketSnapshot {
  const updated_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO ticket_snapshots (conversation_id, fields_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       fields_json = excluded.fields_json,
       updated_at  = excluded.updated_at`,
  ).run(conversationId, JSON.stringify(fields), updated_at);

  return { conversation_id: conversationId, fields, updated_at };
}

/** Merge new edits over whatever is already stored for this conversation. */
export function saveEdits(
  conversationId: string,
  fields: Record<string, unknown>,
): TicketSnapshot {
  const existing = getEdits(conversationId);
  const merged = { ...(existing?.fields ?? {}), ...fields };

  // An explicit null clears a field rather than storing a null value.
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete merged[key];
  }

  const updated_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO ticket_edits (conversation_id, fields_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       fields_json = excluded.fields_json,
       updated_at  = excluded.updated_at`,
  ).run(conversationId, JSON.stringify(merged), updated_at);

  return { conversation_id: conversationId, fields: merged, updated_at };
}

export function getEdits(conversationId: string): TicketSnapshot | null {
  const row = db
    .prepare('SELECT * FROM ticket_edits WHERE conversation_id = ?')
    .get(conversationId) as { fields_json: string; updated_at: string } | undefined;
  if (!row) return null;
  return {
    conversation_id: conversationId,
    fields: JSON.parse(row.fields_json) as Record<string, unknown>,
    updated_at: row.updated_at,
  };
}

export function getSnapshot(conversationId: string): TicketSnapshot | null {
  const row = db
    .prepare('SELECT * FROM ticket_snapshots WHERE conversation_id = ?')
    .get(conversationId) as { fields_json: string; updated_at: string } | undefined;
  if (!row) return null;
  return {
    conversation_id: conversationId,
    fields: JSON.parse(row.fields_json) as Record<string, unknown>,
    updated_at: row.updated_at,
  };
}
