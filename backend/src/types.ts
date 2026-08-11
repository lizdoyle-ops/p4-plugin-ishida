/** Shapes returned by the API. The Front playbook maps these field names directly. */

export type BillingStatus = 'warranty' | 'contract' | 'chargeable';

/** One row of Ishida_ERP_Serial_Lookup.csv, after type coercion. */
export interface MachineRow {
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
}

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

/** The full payload for GET /api/machines/:serial. */
export interface MachineResponse extends MachineRow {
  billing_status: BillingStatus;
  associated_objects: AssociatedObjects;
}

export interface SerialNotFound {
  error: 'serial_not_found';
  serial: string;
}

/** Free-form field map written back by the playbook. */
export interface TicketSnapshot {
  conversation_id: string;
  fields: Record<string, unknown>;
  updated_at: string;
}
