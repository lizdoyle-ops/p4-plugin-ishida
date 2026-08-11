/**
 * Resolves the conversation's ticket status into something displayable.
 *
 * The SDK hands over `statusId` and `statusCategory` but not the status *name*,
 * so the name has to be looked up via `listTicketStatuses()` and matched by id.
 * That call is made once per context and cached, since the status list only
 * changes when someone edits it in Settings.
 *
 * Falls back through: status name -> status category -> conversation status. On
 * an inbox without ticketing enabled there is no statusId at all, so the
 * category or plain conversation status is all there is to show.
 */

import { useEffect, useState } from 'react';

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Shared across hook instances — the list is workspace-wide. */
let statusNameCache: Map<string, string> | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

async function loadStatusNames(context: any): Promise<Map<string, string>> {
  if (statusNameCache) return statusNameCache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const names = new Map<string, string>();
    try {
      let token: string | undefined;
      // Paginate: a workspace can have more statuses than one page holds.
      for (let page = 0; page < 10; page++) {
        const result = await context.listTicketStatuses(token);
        for (const status of result?.results ?? []) {
          if (status?.id) names.set(String(status.id), String(status.name ?? ''));
        }
        token = result?.pagination?.next ?? undefined;
        if (!token) break;
      }
    } catch {
      // Leave the map empty; the caller falls back to the category.
    }
    statusNameCache = names;
    inFlight = null;
    return names;
  })();

  return inFlight;
}

export function useTicketStatus(
  context: any | null,
  statusId: string | null,
  statusCategory: string | null,
  status: string | null,
): { label: string | null; category: string | null } {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setName(null);

    if (!context?.listTicketStatuses || !statusId) return;

    loadStatusNames(context).then((names) => {
      if (!cancelled) setName(names.get(statusId) ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [context, statusId]);

  const label =
    name ??
    (statusCategory ? titleCase(statusCategory) : null) ??
    (status ? titleCase(status) : null);

  return { label, category: statusCategory };
}
