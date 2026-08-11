/**
 * Client for the ERP replica backend.
 *
 * Security note: the API key ships inside this bundle, because the plugin calls
 * the backend directly from the iframe. That is acceptable here — the data is
 * entirely fabricated and the demo backend holds nothing real. For a production
 * build you would proxy through Front's `context.sendHttp` relay so the
 * credential stays server-side. See README "Security note".
 */

import {
  SerialNotFoundError,
  type CustomerObjects,
  type EditResponse,
  type Machine,
  type TicketSnapshot,
} from './types';

const BASE_URL = (import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': API_KEY,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch only rejects on network-level failure — the usual causes here are
    // the backend being asleep on Render's free tier, or a mixed-content block.
    throw new Error(`Cannot reach the ERP backend at ${BASE_URL}.`);
  }

  if (response.status === 401) {
    throw new Error('Rejected by the backend (401). Check VITE_API_KEY matches the server API_KEY.');
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (body.message) detail = body.message;
      else if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

/** Throws SerialNotFoundError on 404 so the UI can show the "re-check serial" state. */
export async function fetchMachine(serial: string): Promise<Machine> {
  const encoded = encodeURIComponent(serial);
  const response = await fetch(`${BASE_URL}/api/machines/${encoded}`, {
    headers: { 'X-Api-Key': API_KEY },
  }).catch(() => {
    throw new Error(`Cannot reach the ERP backend at ${BASE_URL}.`);
  });

  if (response.status === 404) throw new SerialNotFoundError(serial);
  if (response.status === 401) {
    throw new Error('Rejected by the backend (401). Check VITE_API_KEY matches the server API_KEY.');
  }
  if (!response.ok) throw new Error(`Lookup failed: ${response.status} ${response.statusText}`);

  return (await response.json()) as Machine;
}

export function fetchCustomerObjects(account: string): Promise<CustomerObjects> {
  return request<CustomerObjects>(`/api/customers/${encodeURIComponent(account)}/objects`);
}

/** Resolves to null when the playbook has not written a snapshot yet (404). */
export async function fetchSnapshot(conversationId: string): Promise<TicketSnapshot | null> {
  try {
    return await request<TicketSnapshot>(
      `/api/tickets/${encodeURIComponent(conversationId)}/snapshot`,
    );
  } catch {
    return null;
  }
}

/** Manual edits made in the panel. Returns an empty map rather than 404. */
export async function fetchEdits(conversationId: string): Promise<Record<string, unknown>> {
  try {
    const result = await request<TicketSnapshot>(
      `/api/tickets/${encodeURIComponent(conversationId)}/fields`,
    );
    return result.fields ?? {};
  } catch {
    return {};
  }
}

/**
 * Save one edited field. Pass null to clear it.
 *
 * The backend stores the edit and then tries to write it through to Front's own
 * custom fields; `front` reports what actually landed there. Storing always
 * succeeds, so a rejected write-through still leaves the value on screen.
 */
export function saveFieldEdit(
  conversationId: string,
  name: string,
  value: unknown,
): Promise<EditResponse> {
  return request<EditResponse>(`/api/tickets/${encodeURIComponent(conversationId)}/fields`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { [name]: value } }),
  });
}

export { BASE_URL };
