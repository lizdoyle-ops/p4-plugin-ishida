import type { NextFunction, Request, Response } from 'express';

/**
 * Shared-secret check on the X-Api-Key header.
 *
 * Both callers send it: the Front playbook's "Send app request" node, and the
 * plugin iframe. /api/health is mounted before this so Render's health check
 * does not need the key.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_KEY;

  if (!expected) {
    res.status(500).json({
      error: 'server_misconfigured',
      message: 'API_KEY is not set on the server.',
    });
    return;
  }

  const provided = req.header('X-Api-Key');
  if (!provided || provided !== expected) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid X-Api-Key header.',
    });
    return;
  }

  next();
}
