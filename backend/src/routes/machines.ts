import { Router } from 'express';
import { findMachine, listMachines } from '../db.js';
import { deriveBillingStatus } from '../derive.js';
import { generateAssociatedObjects } from '../generate.js';
import type { MachineResponse, MachineRow, SerialNotFound } from '../types.js';

export const machinesRouter = Router();

/** Row -> full API payload, with derived status and generated related objects. */
export function toMachineResponse(machine: MachineRow): MachineResponse {
  return {
    ...machine,
    billing_status: deriveBillingStatus(machine),
    associated_objects: generateAssociatedObjects(machine),
  };
}

const notFound = (serial: string): SerialNotFound => ({
  error: 'serial_not_found',
  serial,
});

/**
 * GET /api/machines?serial=A&serial=B  — batch lookup.
 *
 * A ticket can name two serials (an X-ray and its DACS, say). Unknown serials
 * come back as serial_not_found entries in the array rather than failing the
 * whole request, so one bad serial cannot break a playbook run.
 *
 * Declared before /:serial so "machines?serial=..." is not swallowed by it.
 */
machinesRouter.get('/', (req, res) => {
  const raw = req.query.serial;

  if (raw === undefined) {
    // No filter: list the whole catalogue. Handy for demo prep.
    res.json(listMachines().map(toMachineResponse));
    return;
  }

  const serials = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value).split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  if (serials.length === 0) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Provide at least one non-empty serial, e.g. ?serial=560020728&serial=560020727',
    });
    return;
  }

  res.json(
    serials.map((serial) => {
      const machine = findMachine(serial);
      return machine ? toMachineResponse(machine) : notFound(serial);
    }),
  );
});

/** GET /api/machines/:serial — the core lookup the playbook calls. */
machinesRouter.get('/:serial', (req, res) => {
  const serial = req.params.serial.trim();
  const machine = findMachine(serial);

  if (!machine) {
    res.status(404).json(notFound(serial));
    return;
  }

  res.json(toMachineResponse(machine));
});
