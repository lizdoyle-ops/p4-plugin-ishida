import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';

// dotenv never overwrites an already-set variable, so first load wins:
// real environment (Render) > backend/.env > repo-root .env shared with the plugin.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });
dotenv.config({ path: path.resolve(here, '../../.env') });

import { requireApiKey } from './auth.js';
import { seedFromCsv } from './db.js';
import { customersRouter } from './routes/customers.js';
import { machinesRouter } from './routes/machines.js';
import { ticketsRouter } from './routes/tickets.js';

const app = express();

// Wide open for the demo: the plugin iframe and Front's playbook runner both
// call this from origins we do not control.
app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'X-Api-Key'] }));
app.use(express.json({ limit: '1mb' }));

// Unauthenticated so Render's health check works without the key.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', requireApiKey);
app.use('/api/machines', machinesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/tickets', ticketsRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Malformed JSON from a mis-configured playbook step should read clearly.
app.use(
  (
    err: Error & { status?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
      return;
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  },
);

const port = Number(process.env.PORT ?? 4000);

seedFromCsv();

if (!process.env.API_KEY) {
  console.warn('[warn] API_KEY is not set — every /api request will return 500.');
}

app.listen(port, () => {
  console.log(`[p4-backend] listening on http://localhost:${port}`);
});
