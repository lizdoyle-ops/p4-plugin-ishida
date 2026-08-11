import { Router } from 'express';
import { getEdits, getSnapshot, saveEdits, saveSnapshot } from '../db.js';
import { pushCustomFields } from '../frontApi.js';

export const ticketsRouter = Router();

/** Accepts either a bare field map or { "fields": { ... } }. */
function extractFields(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const nested = record.fields;
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

/**
 * POST /api/tickets/:conversationId/snapshot
 *
 * The playbook's write-back step. Body is a free-form map of the ticket fields
 * the AI resolved. The plugin reads it back and badges those values "AI-filled",
 * which is what makes the automation visible on screen.
 *
 * A bare field map is accepted, and so is { "fields": { ... } } — Front's
 * request builder can produce either depending on how the step is configured.
 */
ticketsRouter.post('/:conversationId/snapshot', (req, res) => {
  const conversationId = req.params.conversationId.trim();
  const fields = extractFields(req.body);

  if (!fields) {
    res.status(400).json({
      error: 'invalid_body',
      message: 'Expected a JSON object of field name -> value.',
    });
    return;
  }

  res.status(201).json(saveSnapshot(conversationId, fields));
});

/**
 * PATCH /api/tickets/:conversationId/fields
 *
 * An agent edited a field in the panel. Two things happen, in this order:
 *   1. the edit is stored here, so it survives and the panel can show it
 *      immediately — this always succeeds
 *   2. we try to write it through to Front's own custom fields, which only
 *      works for fields that actually exist in the workspace
 *
 * Step 2 failing does not fail the request. The response reports exactly which
 * fields reached Front so the panel can say so honestly rather than implying a
 * write that did not happen.
 *
 * Send null as a value to clear a field.
 */
ticketsRouter.patch('/:conversationId/fields', async (req, res, next) => {
  try {
    const conversationId = req.params.conversationId.trim();
    const fields = extractFields(req.body);

    if (!fields || Object.keys(fields).length === 0) {
      res.status(400).json({
        error: 'invalid_body',
        message: 'Expected a non-empty JSON object of field name -> value.',
      });
      return;
    }

    const edits = saveEdits(conversationId, fields);
    const front = await pushCustomFields(conversationId, fields);

    res.json({ ...edits, front });
  } catch (error) {
    next(error);
  }
});

/** GET /api/tickets/:conversationId/fields — manual edits, empty map if none. */
ticketsRouter.get('/:conversationId/fields', (req, res) => {
  const conversationId = req.params.conversationId.trim();
  const edits = getEdits(conversationId);
  res.json(edits ?? { conversation_id: conversationId, fields: {}, updated_at: null });
});

/** GET /api/tickets/:conversationId/snapshot — last write-back, 404 if none. */
ticketsRouter.get('/:conversationId/snapshot', (req, res) => {
  const conversationId = req.params.conversationId.trim();
  const snapshot = getSnapshot(conversationId);

  if (!snapshot) {
    res.status(404).json({ error: 'snapshot_not_found', conversation_id: conversationId });
    return;
  }

  res.json(snapshot);
});
