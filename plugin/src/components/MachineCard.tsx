/**
 * The machine card, plus the one interactive flourish: a button that turns the
 * ERP record into a Front draft. That is the "records can act on the
 * conversation" point — the panel is not just a read-only sidebar.
 */

import { useState } from 'react';
import type { BillingStatus, Machine } from '../api/types';

interface Props {
  machine: Machine;
  /** Raw SDK context. Null outside Front, which disables the draft button. */
  context: any | null;
}

const BILLING_LABEL: Record<BillingStatus, string> = {
  warranty: 'Under warranty',
  contract: 'Covered by contract',
  chargeable: 'Chargeable',
};

const BILLING_PILL: Record<BillingStatus, string> = {
  warranty: 'pill-green',
  contract: 'pill-blue',
  chargeable: 'pill-amber',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSummaryHtml(machine: Machine): string {
  const open = machine.associated_objects.work_orders.filter(
    (wo) => wo.status.toLowerCase() !== 'completed',
  );

  const rows: Array<[string, string]> = [
    ['Serial number', machine.serial_number],
    ['Model', `${machine.model_code} (${machine.machine_type})`],
    ['Installed', machine.install_date],
    [
      'Warranty',
      machine.warranty_active
        ? `Active until ${machine.warranty_expiry}`
        : `Expired ${machine.warranty_expiry}`,
    ],
    ['Service contract', machine.service_contract ?? 'None'],
    ['Billing status', BILLING_LABEL[machine.billing_status]],
    ['LN reference', machine.ln_reference],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${escapeHtml(label)}</td>` +
        `<td style="padding:2px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`,
    )
    .join('');

  const openHtml =
    open.length > 0
      ? `<p><strong>Open work orders</strong></p><ul>${open
          .map(
            (wo) =>
              `<li>${escapeHtml(wo.id)} — ${escapeHtml(wo.summary)} (${escapeHtml(wo.status)}, opened ${escapeHtml(wo.opened_date)})</li>`,
          )
          .join('')}</ul>`
      : '<p>No open work orders on this machine.</p>';

  return (
    `<p>Machine record for <strong>${escapeHtml(machine.customer_account)}</strong>:</p>` +
    `<table style="border-collapse:collapse;font-size:13px;">${rowHtml}</table>` +
    openHtml
  );
}

export default function MachineCard({ machine, context }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canDraft = Boolean(context?.createDraft);

  async function createDraft() {
    if (!canDraft) return;
    setDrafting(true);
    setResult(null);

    try {
      // Reply to the latest inbound message when we can find one, so the draft
      // lands threaded rather than as a bare new message.
      let replyOptions: { type: 'reply'; originalMessageId: string } | undefined;
      try {
        const messages = await context.listMessages();
        const list: any[] = messages?.results ?? [];
        const latestInbound = [...list]
          .reverse()
          .find((m) => m?.status === 'inbound' && m?.id);
        if (latestInbound) {
          replyOptions = { type: 'reply', originalMessageId: latestInbound.id };
        }
      } catch {
        // Fall through to a plain draft.
      }

      await context.createDraft({
        content: { body: buildSummaryHtml(machine), type: 'html' },
        ...(replyOptions ? { replyOptions } : {}),
      });

      setResult({ ok: true, message: 'Draft created — check the composer.' });
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Could not create the draft.',
      });
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="row-main">
          <div className="card-title">
            {machine.model_code}
            <span className="pill pill-grey" style={{ marginLeft: 6 }}>
              {machine.machine_type}
            </span>
          </div>
          <div className="card-sub">
            {machine.serial_number} · {machine.customer_account}
          </div>
        </div>
        <span className={`pill ${machine.warranty_active ? 'pill-green' : 'pill-red'}`}>
          {machine.warranty_active ? 'In warranty' : 'Out of warranty'}
        </span>
      </div>

      <dl className="machine-grid">
        <div>
          <dt>Installed</dt>
          <dd>{machine.install_date}</dd>
        </div>
        <div>
          <dt>Warranty {machine.warranty_active ? 'expires' : 'expired'}</dt>
          <dd>{machine.warranty_expiry}</dd>
        </div>
        <div>
          <dt>Service contract</dt>
          <dd>{machine.service_contract ?? '—'}</dd>
        </div>
        <div>
          <dt>Billing</dt>
          <dd>
            <span className={`pill ${BILLING_PILL[machine.billing_status]}`}>
              {BILLING_LABEL[machine.billing_status]}
            </span>
          </dd>
        </div>
        <div>
          <dt>Country</dt>
          <dd>{machine.country}</dd>
        </div>
        <div>
          <dt>Routing</dt>
          <dd>{machine.region_inbox}</dd>
        </div>
        <div>
          <dt>LN reference</dt>
          <dd>{machine.ln_reference}</dd>
        </div>
        <div>
          <dt>Key account</dt>
          <dd>{machine.key_account ?? '—'}</dd>
        </div>
      </dl>

      <button
        className="btn btn-primary btn-block"
        onClick={createDraft}
        disabled={!canDraft || drafting}
        title={canDraft ? undefined : 'Available when the panel runs inside Front'}
      >
        {drafting ? 'Creating draft…' : 'Draft machine summary'}
      </button>

      {result && (
        <div
          className={`notice ${result.ok ? 'notice-info' : 'notice-error'}`}
          style={{ marginTop: 8, marginBottom: 0 }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
