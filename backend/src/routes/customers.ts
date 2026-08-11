import { Router } from 'express';
import { findMachinesByAccount } from '../db.js';
import { toMachineResponse } from './machines.js';

export const customersRouter = Router();

/**
 * GET /api/customers/:account/objects
 *
 * Every machine and related object for one customer account. Powers the
 * "related items" list in the plugin — the equivalent of clicking through to a
 * Zendesk custom object and seeing everything else that customer owns.
 */
customersRouter.get('/:account/objects', (req, res) => {
  const account = req.params.account.trim();
  const machines = findMachinesByAccount(account);

  if (machines.length === 0) {
    res.status(404).json({ error: 'account_not_found', account });
    return;
  }

  res.json({
    customer_account: machines[0].customer_account,
    country: machines[0].country,
    key_account: machines[0].key_account,
    machine_count: machines.length,
    machines: machines.map(toMachineResponse),
  });
});
