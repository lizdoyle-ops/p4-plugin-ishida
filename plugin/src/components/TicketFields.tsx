/**
 * Section 1 — every ticket field for the type, in one scannable place.
 *
 * This is the "no more hidden fields" half of the story. Three value sources are
 * merged, and which one won is visible:
 *   - Front custom field  -> plain text
 *   - backend snapshot    -> "AI-filled" badge (what the playbook wrote back)
 *   - neither             -> em dash
 *
 * Every field renders whether or not it exists in Front yet, so the panel is
 * legible before the custom fields have been created in Settings.
 */

import type { FieldDef, FieldSet } from '../fieldSets';
import type { CustomFieldValue } from '../hooks/useFrontContext';

interface Props {
  fieldSet: FieldSet;
  customFields: CustomFieldValue[];
  snapshotFields: Record<string, unknown> | null;
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
function lookupSnapshot(
  snapshot: Record<string, unknown> | null,
  frontName: string,
): unknown | undefined {
  if (!snapshot) return undefined;
  if (frontName in snapshot) return snapshot[frontName];
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalise(frontName);
  const hit = Object.keys(snapshot).find((key) => normalise(key) === target);
  return hit === undefined ? undefined : snapshot[hit];
}

function FieldRow({
  def,
  frontValue,
  snapshotValue,
}: {
  def: FieldDef;
  frontValue: string | null;
  snapshotValue: string | null;
}) {
  // Front's own value wins when both exist — the playbook has already written
  // through to Front in that case, and the snapshot is only the audit trail.
  const isAiFilled = frontValue === null && snapshotValue !== null;
  const display = frontValue ?? snapshotValue;

  return (
    <div className={def.long ? 'field field-long' : 'field'}>
      <div className="field-label">{def.frontName}</div>
      <div className={display === null ? 'field-value field-empty' : 'field-value'}>
        {display ?? '—'}
        {isAiFilled && <span className="ai-badge">AI-filled</span>}
      </div>
    </div>
  );
}

export default function TicketFields({ fieldSet, customFields, snapshotFields }: Props) {
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

  const filledCount = fieldSet.fields.filter((def) => {
    const front = formatValue(byName.get(def.frontName.trim().toLowerCase())?.value);
    const snap = formatValue(lookupSnapshot(snapshotFields, def.frontName));
    return front !== null || snap !== null;
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
          {group.fields.map((def) => (
            <FieldRow
              key={def.frontName}
              def={def}
              frontValue={formatValue(byName.get(def.frontName.trim().toLowerCase())?.value)}
              snapshotValue={formatValue(lookupSnapshot(snapshotFields, def.frontName))}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
