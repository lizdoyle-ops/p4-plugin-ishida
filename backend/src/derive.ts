import type { BillingStatus, MachineRow } from './types.js';

/** Treated as "no contract" when deriving billing status. */
const NO_CONTRACT = new Set(['', 'none', 'n/a', 'null', '-']);

export function hasActiveContract(serviceContract: string | null | undefined): boolean {
  if (!serviceContract) return false;
  return !NO_CONTRACT.has(serviceContract.trim().toLowerCase());
}

/**
 * Who pays for the visit. The Front playbook branches on this.
 *   warranty_active            -> "warranty"
 *   else active contract       -> "contract"
 *   else                       -> "chargeable"
 */
export function deriveBillingStatus(machine: MachineRow): BillingStatus {
  if (machine.warranty_active) return 'warranty';
  if (hasActiveContract(machine.service_contract)) return 'contract';
  return 'chargeable';
}
