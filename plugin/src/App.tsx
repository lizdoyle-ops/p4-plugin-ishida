import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchMachine, fetchSnapshot } from './api/client';
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
  const [loading, setLoading] = useState(false);
  const [notFoundSerial, setNotFoundSerial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [overrideSetId, setOverrideSetId] = useState<FieldSetId | null>(null);

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

  // Snapshot written back by the playbook. Absent is normal, so no error state.
  useEffect(() => {
    let cancelled = false;

    if (!front.conversationId) {
      setSnapshot(null);
      return;
    }

    fetchSnapshot(front.conversationId).then((result) => {
      if (!cancelled) setSnapshot(result);
    });

    return () => {
      cancelled = true;
    };
  }, [front.conversationId, reloadToken]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

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

        <div className="segmented" role="group" aria-label="Ticket type">
          {(Object.keys(FIELD_SETS) as FieldSetId[]).map((id) => (
            <button
              key={id}
              aria-pressed={fieldSetId === id}
              onClick={() => setOverrideSetId(id)}
            >
              {FIELD_SETS[id].label}
              {autoDetected && fieldSetId === id ? ' ·auto' : ''}
            </button>
          ))}
        </div>

        <div className="input-row" style={{ marginTop: 8 }}>
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

      {!loading && !error && (
        <>
          <TicketFields
            fieldSet={fieldSet}
            customFields={front.customFields}
            snapshotFields={snapshot?.fields ?? null}
          />
          {machine && <AssociatedObjects machine={machine} context={front.context} />}
        </>
      )}
    </div>
  );
}
