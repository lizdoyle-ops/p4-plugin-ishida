/**
 * Serial-number detection, in the order the demo script walks through:
 *
 *   1. the "Serial Number(s)" Front custom field
 *   2. a regex scan of the conversation's message bodies
 *   3. whatever you type into the manual box
 *
 * First path to yield anything wins, and the panel names which one fired so the
 * detection is visible rather than magic.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CustomFieldValue } from './useFrontContext';

/** Ishida serials in this dataset are 5600xxxxx. */
export const SERIAL_PATTERN = /\b5600\d{5}\b/g;

export const SERIAL_FIELD_NAME = 'Serial Number(s)';

export type SerialSource = 'customField' | 'messageScan' | 'manual' | null;

const unique = (values: string[]): string[] => [...new Set(values)];

/** Strip tags and decode the few entities that matter, so regex sees real text. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function extractSerials(text: string): string[] {
  return unique(text.match(SERIAL_PATTERN) ?? []);
}

/** Accept a hand-typed serial even if it does not match the 5600xxxxx shape. */
function parseLoose(input: string): string[] {
  return unique(
    input
      .split(/[,;/\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Path 1: read the custom field and split on commas / whitespace / slashes. */
export function serialsFromCustomFields(fields: CustomFieldValue[]): string[] {
  const field = fields.find((f) => f.name.trim().toLowerCase() === SERIAL_FIELD_NAME.toLowerCase());
  if (!field || field.value === null || field.value === undefined) return [];
  return parseLoose(String(field.value));
}

export interface SerialState {
  serials: string[];
  source: SerialSource;
  scanning: boolean;
  manual: string;
  setManual: (value: string) => void;
  submitManual: () => void;
  clearManual: () => void;
  /** Look up a specific serial straight away, bypassing the input box. */
  applySerial: (serial: string) => void;
}

export function useSerials(
  context: any | null,
  customFields: CustomFieldValue[],
  conversationId: string | null,
): SerialState {
  const [manual, setManual] = useState('');
  const [manualSerials, setManualSerials] = useState<string[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  // A new conversation invalidates anything carried over from the previous one.
  useEffect(() => {
    setManual('');
    setManualSerials([]);
    setScanned([]);
  }, [conversationId]);

  const fromFields = serialsFromCustomFields(customFields);
  const hasFieldSerials = fromFields.length > 0;

  // Path 2 runs only when path 1 found nothing — no point scanning otherwise.
  useEffect(() => {
    let cancelled = false;

    if (hasFieldSerials || !context?.listMessages) {
      setScanning(false);
      return;
    }

    setScanning(true);
    Promise.resolve(context.listMessages())
      .then((result: any) => {
        if (cancelled) return;
        const messages: any[] = result?.results ?? [];
        // Newest first, so a serial quoted in the latest reply leads the list.
        const found: string[] = [];
        for (const message of [...messages].reverse()) {
          const content = message?.content;
          if (!content?.body) continue;
          const text = content.type === 'html' ? htmlToText(content.body) : content.body;
          found.push(...extractSerials(text));
        }
        setScanned(unique(found));
      })
      .catch(() => {
        if (!cancelled) setScanned([]);
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context, conversationId, hasFieldSerials]);

  const submitManual = useCallback(() => {
    const strict = extractSerials(manual);
    setManualSerials(strict.length > 0 ? strict : parseLoose(manual));
  }, [manual]);

  const clearManual = useCallback(() => {
    setManual('');
    setManualSerials([]);
  }, []);

  // Takes the serial as an argument rather than reading `manual` state, so a
  // caller can set and submit in one go without waiting for a re-render.
  const applySerial = useCallback((serial: string) => {
    setManual(serial);
    setManualSerials([serial]);
  }, []);

  // Manual entry is the override: if you typed something, that is what you meant.
  let serials: string[] = [];
  let source: SerialSource = null;
  if (manualSerials.length > 0) {
    serials = manualSerials;
    source = 'manual';
  } else if (hasFieldSerials) {
    serials = fromFields;
    source = 'customField';
  } else if (scanned.length > 0) {
    serials = scanned;
    source = 'messageScan';
  }

  return { serials, source, scanning, manual, setManual, submitManual, clearManual, applySerial };
}
