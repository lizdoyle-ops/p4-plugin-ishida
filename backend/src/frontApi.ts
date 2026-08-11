/**
 * Write-through to Front's REST API.
 *
 * The plugin SDK cannot set conversation custom fields — `customFieldAttributes`
 * is read-only with no setter. The REST API can, via
 * `PATCH /conversations/:id { custom_fields: { ... } }`.
 *
 * This runs on the server on purpose. A Front API token can read every
 * conversation in the company and send messages as the team, so it must never
 * reach the browser bundle. The plugin posts an edit here; this module holds the
 * token and does the write.
 *
 * IMPORTANT: that PATCH **replaces** the whole custom_fields object rather than
 * merging into it. Sending one field wipes every other field on the
 * conversation. So a write here always reads the current values first, merges,
 * and sends the complete set in a single call. Verified the hard way: sending
 * fields one at a time left only the last one standing.
 *
 * Write-through is optional. With no FRONT_API_TOKEN set, edits are still saved
 * locally and the panel still shows them — they just do not appear in Front's
 * own custom field UI.
 */

const FRONT_API = 'https://api2.frontapp.com';

export interface FieldWriteResult {
  attempted: boolean;
  written: string[];
  failed: Array<{ name: string; reason: string }>;
  /** Set when the whole call failed for a reason unrelated to any one field. */
  error?: string;
}

const NOT_CONFIGURED: FieldWriteResult = {
  attempted: false,
  written: [],
  failed: [],
  error: 'FRONT_API_TOKEN is not set — edit saved locally only.',
};

async function frontRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; message: string; body: any }> {
  const response = await fetch(`${FRONT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // 204s and empty bodies are fine.
  }

  if (response.ok) return { ok: true, status: response.status, message: '', body };

  const detail = body?._error?.details?.join('; ');
  return {
    ok: false,
    status: response.status,
    message: detail || body?._error?.message || `${response.status} ${response.statusText}`,
    body,
  };
}

/**
 * Names of every conversation custom field in the workspace.
 *
 * Note this is NOT /custom_fields — that endpoint returns *contact* fields.
 * Conversation fields live under their own path, and only those can be written
 * to a conversation.
 *
 * Cached briefly: it changes only when someone edits Settings, and refetching it
 * on every keystroke-driven save would be wasteful.
 */
let fieldNameCache: { names: Set<string>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function knownFieldNames(token: string): Promise<Set<string> | null> {
  if (fieldNameCache && Date.now() - fieldNameCache.fetchedAt < CACHE_TTL_MS) {
    return fieldNameCache.names;
  }

  const names = new Set<string>();
  let path: string | null = '/conversations/custom_fields?limit=100';

  while (path) {
    const result: { ok: boolean; body: any } = await frontRequest(path, token);
    if (!result.ok) return null;
    for (const field of result.body?._results ?? []) {
      if (field?.name) names.add(String(field.name));
    }
    const next: string | undefined = result.body?._pagination?.next;
    path = next ? next.replace(FRONT_API, '') : null;
  }

  fieldNameCache = { names, fetchedAt: Date.now() };
  return names;
}

/** Case-insensitive match back to the exact name Front expects. */
function resolveName(requested: string, known: Set<string>): string | null {
  if (known.has(requested)) return requested;
  const lower = requested.trim().toLowerCase();
  for (const name of known) {
    if (name.trim().toLowerCase() === lower) return name;
  }
  return null;
}

/**
 * Push field values to Front, preserving everything already set.
 *
 * A null value clears that field.
 */
export async function pushCustomFields(
  conversationId: string,
  fields: Record<string, unknown>,
): Promise<FieldWriteResult> {
  const token = process.env.FRONT_API_TOKEN;
  if (!token) return NOT_CONFIGURED;

  const requested = Object.keys(fields);
  if (requested.length === 0) return { attempted: false, written: [], failed: [] };

  const known = await knownFieldNames(token);
  if (!known) {
    const reason = 'Could not list Front custom fields — check FRONT_API_TOKEN.';
    return {
      attempted: true,
      written: [],
      failed: requested.map((name) => ({ name, reason })),
      error: reason,
    };
  }

  // Split into fields Front actually has and fields it does not.
  const writable: Record<string, unknown> = {};
  const failed: Array<{ name: string; reason: string }> = [];
  for (const name of requested) {
    const resolved = resolveName(name, known);
    if (resolved) writable[resolved] = fields[name];
    else failed.push({ name, reason: `Custom field not found: '${name}'` });
  }

  if (Object.keys(writable).length === 0) {
    return { attempted: true, written: [], failed };
  }

  // Read current values so the replace-semantics PATCH does not wipe them.
  const current = await frontRequest(`/conversations/${encodeURIComponent(conversationId)}`, token);
  if (!current.ok) {
    return {
      attempted: true,
      written: [],
      failed: [
        ...failed,
        ...Object.keys(writable).map((name) => ({ name, reason: current.message })),
      ],
      error: current.message,
    };
  }

  const merged: Record<string, unknown> = { ...(current.body?.custom_fields ?? {}), ...writable };
  for (const [key, value] of Object.entries(writable)) {
    if (value === null) delete merged[key];
  }

  const patch = await frontRequest(`/conversations/${encodeURIComponent(conversationId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ custom_fields: merged }),
  });

  if (!patch.ok) {
    return {
      attempted: true,
      written: [],
      failed: [
        ...failed,
        ...Object.keys(writable).map((name) => ({ name, reason: patch.message })),
      ],
      error: patch.message,
    };
  }

  return { attempted: true, written: Object.keys(writable), failed };
}
