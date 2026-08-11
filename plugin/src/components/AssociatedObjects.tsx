/**
 * Section 2 — the Zendesk custom-object replacement.
 *
 * Work orders, spare parts, quotes and the customer's other machines, all hung
 * off the serial. In Zendesk this is a related-objects lookup; here it comes
 * from the same backend the playbook queries, so panel and automation cannot
 * disagree with each other.
 */

import { useEffect, useState } from 'react';
import { fetchCustomerObjects } from '../api/client';
import type { CustomerObjects, Machine } from '../api/types';
import MachineCard from './MachineCard';

interface Props {
  machine: Machine;
  context: any | null;
}

function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('accepted')) return 'pill-green';
  if (s.includes('await') || s.includes('order') || s.includes('pending')) return 'pill-amber';
  if (s.includes('backorder') || s.includes('expired')) return 'pill-red';
  if (s.includes('open') || s.includes('sent') || s.includes('scheduled')) return 'pill-blue';
  return 'pill-grey';
}

const money = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

/** The customer's other machines — related items, minus the one already shown. */
function RelatedMachines({ machine }: { machine: Machine }) {
  const [data, setData] = useState<CustomerObjects | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);

    fetchCustomerObjects(machine.customer_account)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [machine.customer_account]);

  if (failed) return null;

  const others = (data?.machines ?? []).filter(
    (m) => m.serial_number !== machine.serial_number,
  );

  if (!data) {
    return (
      <>
        <div className="group-label">Other machines at this account</div>
        <div className="skeleton" style={{ width: '70%' }} />
        <div className="skeleton" style={{ width: '50%' }} />
      </>
    );
  }

  if (others.length === 0) return null;

  return (
    <>
      <div className="group-label">
        Other machines at {data.customer_account} ({others.length})
      </div>
      {others.map((other) => (
        <div className="row" key={other.serial_number}>
          <div className="row-main">
            <div className="row-title">
              {other.model_code} · {other.machine_type}
            </div>
            <div className="row-meta">
              {other.serial_number} · installed {other.install_date}
            </div>
          </div>
          <div className="row-side">
            <span className={`pill ${other.warranty_active ? 'pill-green' : 'pill-red'}`}>
              {other.warranty_active ? 'In warranty' : 'Out of warranty'}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

export default function AssociatedObjects({ machine, context }: Props) {
  const { work_orders, spare_parts, quotes, service_contract } = machine.associated_objects;
  const total = work_orders.length + spare_parts.length + quotes.length + (service_contract ? 1 : 0);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Associated objects</h2>
        <span className="section-count">{total} records</span>
      </div>

      <MachineCard machine={machine} context={context} />

      {service_contract && (
        <>
          <div className="group-label">Service contract</div>
          <div className="row">
            <div className="row-main">
              <div className="row-title">{service_contract.name}</div>
              <div className="row-meta">{service_contract.response_sla}</div>
            </div>
            <div className="row-side">
              <span className="pill pill-blue">{service_contract.level}</span>
              <div style={{ marginTop: 2 }}>to {service_contract.expiry}</div>
            </div>
          </div>
        </>
      )}

      <div className="group-label">Work orders ({work_orders.length})</div>
      {work_orders.length === 0 ? (
        <div className="row-meta">None on record.</div>
      ) : (
        work_orders.map((wo) => (
          <div className="row" key={wo.id}>
            <div className="row-main">
              <div className="row-title">{wo.summary}</div>
              <div className="row-meta">
                {wo.id} · {wo.opened_date} · {wo.engineer}
              </div>
            </div>
            <div className="row-side">
              <span className={`pill ${statusPill(wo.status)}`}>{wo.status}</span>
            </div>
          </div>
        ))
      )}

      <div className="group-label">Spare parts ({spare_parts.length})</div>
      {spare_parts.length === 0 ? (
        <div className="row-meta">None on record.</div>
      ) : (
        spare_parts.map((part) => (
          <div className="row" key={part.part_no}>
            <div className="row-main">
              <div className="row-title">{part.description}</div>
              <div className="row-meta">
                {part.part_no} · qty {part.qty}
              </div>
            </div>
            <div className="row-side">
              <span className={`pill ${statusPill(part.stock_status)}`}>{part.stock_status}</span>
            </div>
          </div>
        ))
      )}

      <div className="group-label">Quotes ({quotes.length})</div>
      {quotes.length === 0 ? (
        <div className="row-meta">None on record.</div>
      ) : (
        quotes.map((quote) => (
          <div className="row" key={quote.id}>
            <div className="row-main">
              <div className="row-title">{money(quote.amount, quote.currency)}</div>
              <div className="row-meta">
                {quote.id} · issued {quote.issued_date}
              </div>
            </div>
            <div className="row-side">
              <span className={`pill ${statusPill(quote.status)}`}>{quote.status}</span>
            </div>
          </div>
        ))
      )}

      <RelatedMachines machine={machine} />
    </section>
  );
}
