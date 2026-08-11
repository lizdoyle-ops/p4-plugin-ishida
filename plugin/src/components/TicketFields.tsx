/**
 * Section 1 — every ticket field for the type, in one scannable place, editable
 * in place.
 *
 * Four value sources are merged, highest precedence first, and which one won is
 * visible rather than implied:
 *   - a manual edit made here      -> "Edited" badge
 *   - a Front custom field value   -> plain text
 *   - the playbook's snapshot      -> "AI-filled" badge
 *   - nothing                      -> em dash
 *
 * Every field renders whether or not it exists in Front yet, so the panel is
 * legible before the custom fields have been created in Settings — and an edit
 * still persists locally even when Front rejects the write-through.
 */

import { useEffect, useRef, useState } from 'react';
import type { FieldDef, FieldSet } from '../fieldSets';
import type { CustomFieldValue } from '../hooks/useFrontContext';

interface Props {
  fieldSet: FieldSet;
  customFields: CustomFieldValue[];
  snapshotFields: Record<string, unknown> | null;
  editedFields: Record<string, unknown>;
  onSave: (name: string, value: unknown) => Promise<void>;
  /** Null outside a conversation — editing is disabled without somewhere to save. */
  conversationId: string | null;
  /** Live ticket status from Front, for fields marked derived: 'ticketStatus'. */
  ticketStatus: { label: string | null; category: string | null };
}

/** Colour the status pill by Front's own status category. */
function statusPillClass(category: string | null): string {
  if (category === 'resolved') return 'pill-green';
  if (category === 'waiting') return 'pill-amber';
  if (category === 'open') return 'pill-blue';
  return 'pill-grey';
}

/** Render any custom-field type as something readable. */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatValue(v)).filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Snapshot keys come from the playbook, so tolerate case/spacing drift. */
function lookupLoose(
  source: Record<string, unknown> | null,
  frontName: string,
): unknown | undefined {
  if (!source) return undefined;
  if (frontName in source) return source[frontName];
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalise(frontName);
  const hit = Object.keys(source).find((key) => normalise(key) === target);
  return hit === undefined ? undefined : source[hit];
}

/** Turn the raw input string back into the type the field expects. */
function coerce(def: FieldDef, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (def.kind === 'boolean') return trimmed === 'true' || trimmed.toLowerCase() === 'yes';
  if (def.kind === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  return trimmed;
}

/** Seed the input with the value currently on screen. */
function toInputValue(def: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (def.kind === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return /^(yes|true)$/i.test(String(value)) ? 'true' : 'false';
  }
  if (def.kind === 'date') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toISOString().slice(0, 10);
  }
  return String(value);
}

type Status = 'idle' | 'saving' | 'localOnly' | 'error';

/**
 * A field Front owns. Read-only by design: the agent changes the ticket status
 * using Front's own control, and this reflects it — a second editable copy would
 * only be able to disagree with the real thing.
 */
function DerivedStatusRow({
  def,
  ticketStatus,
}: {
  def: FieldDef;
  ticketStatus: { label: string | null; category: string | null };
}) {
  return (
    <div className="field">
      <div className="field-label">{def.frontName}</div>
      <div className="field-value">
        {ticketStatus.label ? (
          <span className={`pill ${statusPillClass(ticketStatus.category)}`}>
            {ticketStatus.label}
          </span>
        ) : (
          <span className="field-empty">—</span>
        )}
        <span className="field-note">from Front</span>
      </div>
    </div>
  );
}

function FieldRow({
  def,
  frontValue,
  snapshotValue,
  editedValue,
  onSave,
  editable,
}: {
  def: FieldDef;
  frontValue: string | null;
  snapshotValue: string | null;
  editedValue: unknown | undefined;
  onSave: (name: string, value: unknown) => Promise<void>;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  const hasEdit = editedValue !== undefined;
  const editedText = hasEdit ? formatValue(editedValue) : null;

  // Edits win, then Front's own value, then whatever the playbook resolved.
  const display = hasEdit ? editedText : (frontValue ?? snapshotValue);
  const isAiFilled = !hasEdit && frontValue === null && snapshotValue !== null;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function begin() {
    if (!editable) return;
    const current = hasEdit ? editedValue : (frontValue ?? snapshotValue);
    setDraft(toInputValue(def, current));
    setNote(null);
    setStatus('idle');
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const next = coerce(def, draft);
    const unchanged = toInputValue(def, hasEdit ? editedValue : (frontValue ?? snapshotValue));
    if (toInputValue(def, next) === unchanged) return;

    setStatus('saving');
    try {
      await onSave(def.frontName, next);
      setStatus('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed.';
      // A missing custom field is expected until they are created in Settings,
      // and the value is still stored — so that case gets a calm note. Anything
      // else shows the real reason rather than a reassuring guess.
      // The value is stored either way, so these are markers, not alarms. The
      // full reason goes to the banner at the top rather than being repeated
      // under every edited row.
      if (/custom field not found/i.test(message)) {
        setStatus('localOnly');
        setNote('not a Front field yet');
      } else {
        setStatus('error');
        setNote('not synced to Front');
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !(def.long && e.shiftKey)) {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  }

  const editor = def.kind === 'boolean' ? (
    <select
      ref={inputRef as React.RefObject<HTMLSelectElement>}
      className="input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
    >
      <option value="">—</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  ) : def.long ? (
    <textarea
      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
      className="input"
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
    />
  ) : (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      className="input"
      type={def.kind === 'date' ? 'date' : def.kind === 'number' ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <div className={def.long ? 'field field-long' : 'field'}>
      <div className="field-label">{def.frontName}</div>
      <div className="field-value">
        {editing ? (
          editor
        ) : (
          <span
            className={`field-display${editable ? ' field-editable' : ''}${display === null ? ' field-empty' : ''}`}
            onClick={begin}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            title={editable ? 'Click to edit' : undefined}
            onKeyDown={(e) => {
              if (editable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                begin();
              }
            }}
          >
            {status === 'saving' ? 'Saving…' : (display ?? '—')}
          </span>
        )}
        {!editing && hasEdit && status !== 'saving' && <span className="edit-badge">Edited</span>}
        {!editing && isAiFilled && <span className="ai-badge">AI-filled</span>}
        {note && !editing && (
          <span className={status === 'error' ? 'field-note field-note-error' : 'field-note'}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TicketFields({
  fieldSet,
  customFields,
  snapshotFields,
  editedFields,
  onSave,
  conversationId,
  ticketStatus,
}: Props) {
  const byName = new Map<string, CustomFieldValue>();
  for (const field of customFields) {
    byName.set(field.name.trim().toLowerCase(), field);
  }

  const groups: Array<{ name: string; fields: FieldDef[] }> = [];
  for (const def of fieldSet.fields) {
    const last = groups[groups.length - 1];
    if (last && last.name === def.group) last.fields.push(def);
    else groups.push({ name: def.group, fields: [def] });
  }

  const resolve = (def: FieldDef) => ({
    frontValue: formatValue(byName.get(def.frontName.trim().toLowerCase())?.value),
    snapshotValue: formatValue(lookupLoose(snapshotFields, def.frontName)),
    editedValue: lookupLoose(editedFields, def.frontName),
  });

  const filledCount = fieldSet.fields.filter((def) => {
    if (def.derived === 'ticketStatus') return ticketStatus.label !== null;
    const { frontValue, snapshotValue, editedValue } = resolve(def);
    return editedValue !== undefined || frontValue !== null || snapshotValue !== null;
  }).length;

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Ticket fields</h2>
        <span className="section-count">
          {filledCount} of {fieldSet.fields.length} set
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.name}>
          <div className="group-label">{group.name}</div>
          {group.fields.map((def) => {
            if (def.derived === 'ticketStatus') {
              return (
                <DerivedStatusRow key={def.frontName} def={def} ticketStatus={ticketStatus} />
              );
            }
            const { frontValue, snapshotValue, editedValue } = resolve(def);
            return (
              <FieldRow
                key={def.frontName}
                def={def}
                frontValue={frontValue}
                snapshotValue={snapshotValue}
                editedValue={editedValue}
                onSave={onSave}
                editable={conversationId !== null}
              />
            );
          })}
        </div>
      ))}
    </section>
  );
}
