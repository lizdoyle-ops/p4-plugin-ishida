/** Mirrors backend/src/types.ts — the shapes returned by the ERP replica API. */

export type BillingStatus = 'warranty' | 'contract' | 'chargeable';

export interface WorkOrder {
  id: string;
  status: string;
  summary: string;
  opened_date: string;
  engineer: string;
}

export interface SparePart {
  part_no: string;
  description: string;
  qty: number;
  stock_status: string;
}

export interface Quote {
  id: string;
  amount: number;
  currency: string;
  status: string;
  issued_date: string;
}

export interface ServiceContractRecord {
  name: string;
  level: string;
  expiry: string;
  response_sla: string;
}

export interface AssociatedObjects {
  work_orders: WorkOrder[];
  spare_parts: SparePart[];
  quotes: Quote[];
  service_contract: ServiceContractRecord | null;
}

export interface Machine {
  serial_number: string;
  model_code: string;
  machine_type: string;
  customer_account: string;
  country: string;
  region_inbox: string;
  install_date: string;
  warranty_active: boolean;
  warranty_expiry: string;
  service_contract: string | null;
  ln_reference: string;
  key_account: string | null;
  billing_status: BillingStatus;
  associated_objects: AssociatedObjects;
}

export interface CustomerObjects {
  customer_account: string;
  country: string;
  key_account: string | null;
  machine_count: number;
  machines: Machine[];
}

export interface TicketSnapshot {
  conversation_id: string;
  fields: Record<string, unknown>;
  updated_at: string;
}

/** Distinguishes "serial genuinely absent from the ERP" from "request failed". */
export class SerialNotFoundError extends Error {
  constructor(public readonly serial: string) {
    super(`Serial ${serial} not found in ERP`);
    this.name = 'SerialNotFoundError';
  }
}
