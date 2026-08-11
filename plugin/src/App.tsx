import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEdits, fetchMachine, fetchSnapshot, saveFieldEdit } from './api/client';
import { SerialNotFoundError, type Machine, type TicketSnapshot } from './api/types';
import AssociatedObjects from './components/AssociatedObjects';
import TicketFields from './components/TicketFields';
import { FIELD_SETS, detectFieldSet, type FieldSetId } from './fieldSets';
import { useFrontContext } from './hooks/useFrontContext';
import { useSerials, type SerialSource } from './hooks/useSerials';

/** Serials offered as one-click buttons when running outside Front. */
const DEV_SERIALS = ['560020728', '560020727', '560020450', '560018221', '560019430', '999999999'];

const SOURCE_LABEL: Record<Exclude<SerialSource, null>, string> = {
  customField: 'from the "Serial Number(s)" custom field',
  messageScan: 'detected in the message body',
  manual: 'entered manually',
};

function Skeleton() {
  return (
    <div className="section">
      <div className="skeleton" style={{ width: '45%', height: 13 }} />
      <div style={{ height: 10 }} />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 7}%` }} />
      ))}
    </div>
  );
}

export default function App() {
  const front = useFrontContext();
  const { serials, source, scanning, manual, setManual, submitManual, clearManual, applySerial } =
    useSerials(front.context, front.customFields, front.conversationId);

  const [machine, setMachine] = useState<Machine | null>(null);
  const [snapshot, setSnapshot] = useState<TicketSnapshot | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [writeNotice, setWriteNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFoundSerial, setNotFoundSerial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [overrideSetId, setOverrideSetId] = useState<FieldSetId | null>(null);
  const [tab, setTab] = useState<'fields' | 'objects'>('fields');

  const primarySerial = serials[0] ?? null;

  const fieldSetId: FieldSetId =
    overrideSetId ?? detectFieldSet(front.inboxes) ?? 'techSupport';
  const fieldSet = FIELD_SETS[fieldSetId];
  const autoDetected = overrideSetId === null && detectFieldSet(front.inboxes) !== null;

  // Machine lookup.
  useEffect(() => {
    let cancelled = false;

    if (!primarySerial) {
      setMachine(null);
      setNotFoundSerial(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFoundSerial(null);

    fetchMachine(primarySerial)
      .then((result) => {
        if (cancelled) return;
        setMachine(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMachine(null);
        if (err instanceof SerialNotFoundError) setNotFoundSerial(err.serial);
        else setError(err instanceof Error ? err.message : 'Lookup failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primarySerial, reloadToken]);

  // Snapshot from the playbook, plus any manual edits made in this panel.
  // Both absent is normal, so neither produces an error state.
  useEffect(() => {
    let cancelled = false;

    if (!front.conversationId) {
      setSnapshot(null);
      setEdits({});
      return;
    }

    fetchSnapshot(front.conversationId).then((result) => {
      if (!cancelled) setSnapshot(result);
    });
    fetchEdits(front.conversationId).then((result) => {
      if (!cancelled) setEdits(result);
    });

    return () => {
      cancelled = true;
    };
  }, [front.conversationId, reloadToken]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  /**
   * Save one edited field. The value lands locally regardless; `front` reports
   * whether it also reached Front's own custom fields, which only works for
   * fields that exist in the workspace.
   */
  const saveField = useCallback(
    async (name: string, value: unknown) => {
      if (!front.conversationId) throw new Error('No conversation to save against.');

      const response = await saveFieldEdit(front.conversationId, name, value);
      setEdits(response.fields);

      const failure = response.front.failed[0];
      if (failure) {
        setWriteNotice(`Not written to Front — ${failure.reason}`);
        throw new Error(failure.reason);
      }
      if (!response.front.attempted) {
        setWriteNotice(response.front.error ?? 'Saved in the panel only.');
        return;
      }
      setWriteNotice(null);
    },
    [front.conversationId],
  );

  const relatedCount = useMemo(() => {
    if (!machine) return 0;
    const o = machine.associated_objects;
    return o.work_orders.length + o.spare_parts.length + o.quotes.length + (o.service_contract ? 1 : 0);
  }, [machine]);

  const subtitle = useMemo(() => {
    if (front.kind === 'dev') return 'Demo mode — not running inside Front';
    if (front.subject) return front.subject;
    if (front.inboxes.length > 0) return front.inboxes.map((i) => i.name).join(', ');
    return null;
  }, [front.kind, front.subject, front.inboxes]);

  // ── Contexts we do not render a full panel for ────────────────────────────
  if (front.kind === 'loading') {
    return (
      <div className="panel">
        <Skeleton />
      </div>
    );
  }

  if (front.kind === 'none') {
    return (
      <div className="panel">
        <div className="state">
          <div className="state-title">No conversation selected</div>
          <div className="state-body">
            Open a conversation to see its machine record and ticket fields.
          </div>
        </div>
      </div>
    );
  }

  if (front.kind === 'multi') {
    return (
      <div className="panel">
        <div className="state">
          <div className="state-title">Multiple conversations selected</div>
          <div className="state-body">
            Select a single conversation to look up its machine.
          </div>
        </div>
      </div>
    );
  }

  const isDev = front.kind === 'dev';

  return (
    <div className="panel">
      {isDev && (
        <div className="dev-banner">
          <div className="dev-banner-title">⚙ Demo mode — pick a serial</div>
          <div className="dev-serials">
            {DEV_SERIALS.map((serial) => (
              <button
                key={serial}
                aria-pressed={serials[0] === serial}
                onClick={() => applySerial(serial)}
              >
                {serial}
              </button>
            ))}
          </div>
        </div>
      )}

      <header className="header">
        <div className="header-row">
          <div className="row-main">
            <div className="header-title">Ishida after-sales</div>
            {subtitle && <div className="header-sub">{subtitle}</div>}
          </div>
          <button className="btn btn-icon" onClick={refresh} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>

        <div className="input-row" style={{ marginTop: 8 }}>
          <label className="inline-label" htmlFor="ticket-type">
            Ticket type
          </label>
          <select
            id="ticket-type"
            className="input"
            value={fieldSetId}
            onChange={(e) => setOverrideSetId(e.target.value as FieldSetId)}
          >
            {(Object.keys(FIELD_SETS) as FieldSetId[]).map((id) => (
              <option key={id} value={id}>
                {FIELD_SETS[id].label}
                {autoDetected && detectFieldSet(front.inboxes) === id ? ' (from inbox)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="input-row" style={{ marginTop: 6 }}>
          <input
            className="input"
            placeholder="Serial number, e.g. 560020728"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitManual();
            }}
          />
          <button className="btn" onClick={submitManual} disabled={manual.trim() === ''}>
            Look up
          </button>
        </div>

        {source && (
          <div className="source-note">
            {serials.length > 1
              ? `${serials.length} serials ${SOURCE_LABEL[source]} — showing ${primarySerial}`
              : `Serial ${SOURCE_LABEL[source]}`}
            {source === 'manual' && (
              <>
                {' · '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    clearManual();
                  }}
                >
                  clear
                </a>
              </>
            )}
          </div>
        )}

        <div className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'fields'}
            onClick={() => setTab('fields')}
          >
            Ticket fields
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'objects'}
            onClick={() => setTab('objects')}
          >
            Related objects
            {relatedCount > 0 && <span className="tab-count">{relatedCount}</span>}
          </button>
        </div>
      </header>

      {error && (
        <div className="section">
          <div className="notice notice-error">{error}</div>
          <button className="btn" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {!error && notFoundSerial && (
        <div className="section">
          <div className="notice notice-warn">
            Serial <strong>{notFoundSerial}</strong> is not in the ERP. Ask the customer to
            re-check the number on the machine plate.
          </div>
        </div>
      )}

      {!error && !notFoundSerial && !primarySerial && (
        <div className="state">
          <div className="state-title">
            {scanning ? 'Scanning the conversation…' : 'No serial detected'}
          </div>
          <div className="state-body">
            {scanning
              ? 'Looking for a 5600xxxxx serial in the message history.'
              : 'No "Serial Number(s)" field and nothing matching 5600xxxxx in the messages. Enter one above.'}
          </div>
        </div>
      )}

      {loading && primarySerial && <Skeleton />}

      {!loading && !error && tab === 'fields' && (
        <>
          {writeNotice && (
            <div className="section" style={{ paddingBottom: 0, borderBottom: 0 }}>
              <div className="notice notice-warn">{writeNotice}</div>
            </div>
          )}
          <TicketFields
            fieldSet={fieldSet}
            customFields={front.customFields}
            snapshotFields={snapshot?.fields ?? null}
            editedFields={edits}
            onSave={saveField}
            conversationId={front.conversationId}
          />
        </>
      )}

      {!loading && !error && tab === 'objects' &&
        (machine ? (
          <AssociatedObjects machine={machine} context={front.context} />
        ) : (
          <div className="state">
            <div className="state-title">No machine loaded</div>
            <div className="state-body">
              Enter or detect a serial number to see its work orders, parts and quotes.
            </div>
          </div>
        ))}
    </div>
  );
}
