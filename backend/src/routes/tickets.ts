import { Router } from 'express';
import { getSnapshot, saveSnapshot } from '../db.js';

export const ticketsRouter = Router();

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
  const body = req.body as unknown;

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      error: 'invalid_body',
      message: 'Expected a JSON object of field name -> value.',
    });
    return;
  }

  const record = body as Record<string, unknown>;
  const nested = record.fields;
  const fields =
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;

  res.status(201).json(saveSnapshot(conversationId, fields));
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
