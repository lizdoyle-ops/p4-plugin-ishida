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

async function patchConversation(
  conversationId: string,
  customFields: Record<string, unknown>,
  token: string,
): Promise<{ ok: boolean; status: number; message: string }> {
  const response = await fetch(`${FRONT_API}/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ custom_fields: customFields }),
  });

  if (response.ok) return { ok: true, status: response.status, message: '' };

  let message = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as {
      _error?: { message?: string; details?: string[] };
    };
    const detail = body._error?.details?.join('; ');
    message = detail || body._error?.message || message;
  } catch {
    // Non-JSON error body; keep the status line.
  }
  return { ok: false, status: response.status, message };
}

/**
 * Push field values to Front.
 *
 * Tries the whole set in one PATCH. If that is rejected — typically because one
 * field name does not exist in the workspace — it retries field by field so the
 * caller learns exactly which ones landed and which did not, rather than losing
 * every valid edit to one bad name.
 */
export async function pushCustomFields(
  conversationId: string,
  fields: Record<string, unknown>,
): Promise<FieldWriteResult> {
  const token = process.env.FRONT_API_TOKEN;
  if (!token) return NOT_CONFIGURED;

  const names = Object.keys(fields);
  if (names.length === 0) return { attempted: false, written: [], failed: [] };

  const batch = await patchConversation(conversationId, fields, token);
  if (batch.ok) return { attempted: true, written: names, failed: [] };

  // Auth and not-found failures apply to the whole request; splitting is pointless.
  if (batch.status === 401 || batch.status === 403 || batch.status === 404) {
    return {
      attempted: true,
      written: [],
      failed: names.map((name) => ({ name, reason: batch.message })),
      error: batch.message,
    };
  }

  const written: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const name of names) {
    const single = await patchConversation(conversationId, { [name]: fields[name] }, token);
    if (single.ok) written.push(name);
    else failed.push({ name, reason: single.message });
  }

  return { attempted: true, written, failed };
}
