/**
 * The two ticket-type field sets, and how the panel decides which to show.
 *
 * `frontName` must match the Front custom field name EXACTLY — that string is
 * how values are looked up in `conversation.customFieldAttributes`, and it is
 * also the key the playbook should use when POSTing a snapshot. If a field is
 * renamed in Front Settings, change it here too.
 *
 * As of writing, none of these fields exist in the demo instance yet. The panel
 * renders every row regardless, showing "—" for anything unset, so it stays
 * legible before the fields are created. See README "Front setup".
 */

export type FieldSetId = 'complaints' | 'techSupport';

/** Drives which input the panel shows when a field is edited. */
export type FieldKind = 'text' | 'boolean' | 'date' | 'number';

export interface FieldDef {
  /** Exact Front custom field name. */
  frontName: string;
  /** Grouping heading in the panel. */
  group: string;
  /** Renders in a full-width block instead of a label/value row. */
  long?: boolean;
  /** Defaults to 'text'. */
  kind?: FieldKind;
}

export interface FieldSet {
  id: FieldSetId;
  label: string;
  fields: FieldDef[];
}

export const COMPLAINTS: FieldSet = {
  id: 'complaints',
  label: 'Complaints',
  fields: [
    { frontName: 'Complaint Category', group: 'Classification' },
    { frontName: 'Complaint Type', group: 'Classification' },
    { frontName: 'Complaint Status', group: 'Classification' },
    { frontName: 'Commercial Impact', group: 'Classification' },
    { frontName: 'Serial Number(s)', group: 'Machine' },
    { frontName: 'Machine(s)', group: 'Machine' },
    // Country and LN reference are deliberately not here — both already show on
    // the machine card in section 2, and repeating them made the list longer
    // without telling the agent anything new.
    { frontName: 'Problem Statement', group: 'Detail', long: true },
    { frontName: 'Proposed Solution', group: 'Detail', long: true },
    { frontName: 'Latest Update', group: 'Detail', long: true },
    { frontName: 'Final Resolution', group: 'Detail', long: true },
  ],
};

export const TECH_SUPPORT: FieldSet = {
  id: 'techSupport',
  label: 'Tech Support',
  fields: [
    { frontName: 'Serial Number(s)', group: 'Machine' },
    { frontName: 'Machine(s)', group: 'Machine' },
    { frontName: 'Service Contract', group: 'Machine' },
    { frontName: 'Warranty Active?', group: 'Machine', kind: 'boolean' },
    { frontName: 'Request Type', group: 'Machine' },
    { frontName: 'Date of SightCall Intervention', group: 'SightCall', kind: 'date' },
    { frontName: 'SightCall Completed', group: 'SightCall', kind: 'boolean' },
    { frontName: 'Did SightCall Resolve the ticket?', group: 'SightCall', kind: 'boolean' },
    { frontName: 'Reason SightCall did not resolve', group: 'SightCall', long: true },
    { frontName: 'Machine Breakdown?', group: 'Effort', kind: 'boolean' },
    { frontName: 'Callback Required', group: 'Effort', kind: 'boolean' },
    { frontName: 'No. of Engineer Visits', group: 'Effort', kind: 'number' },
    { frontName: 'Total time spent', group: 'Effort' },
    { frontName: 'Time spent last update', group: 'Effort' },
    { frontName: 'Issue', group: 'Detail', long: true },
    { frontName: 'Solution', group: 'Detail', long: true },
  ],
};

export const FIELD_SETS: Record<FieldSetId, FieldSet> = {
  complaints: COMPLAINTS,
  techSupport: TECH_SUPPORT,
};

/**
 * Inbox IDs in the demo instance. Exact IDs beat name matching: "Support +
 * Complaints" contains both keywords, so a name-only rule would depend on which
 * pattern happens to be tested first.
 */
export const INBOX_FIELD_SETS: Record<string, FieldSetId> = {
  inb_51v4d: 'complaints', // Support + Complaints
  inb_51v65: 'techSupport', // Tech Support
};

/**
 * Name fallback, for conversations in an inbox not listed above. First match
 * wins, so the specific "complaint" test precedes the broad support test.
 */
const INBOX_NAME_RULES: Array<{ pattern: RegExp; setId: FieldSetId }> = [
  { pattern: /complaint/i, setId: 'complaints' },
  { pattern: /tech|support|service|aftersales/i, setId: 'techSupport' },
];

export interface InboxRef {
  id: string;
  name: string;
}

/** Returns null when nothing matches, so the caller can fall back to a default. */
export function detectFieldSet(inboxes: InboxRef[]): FieldSetId | null {
  for (const inbox of inboxes) {
    const byId = INBOX_FIELD_SETS[inbox.id];
    if (byId) return byId;
  }
  for (const rule of INBOX_NAME_RULES) {
    if (inboxes.some((inbox) => rule.pattern.test(inbox.name))) return rule.setId;
  }
  return null;
}
