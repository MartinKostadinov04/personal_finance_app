import './env';

import express from 'express';
import cors from 'cors';

import { getPool } from './db/pg';
import { requireAuth } from './middleware/auth';
import { ensureProvisioned } from './middleware/provision';

import categoriesRouter from './routes/categories';
import monthsRouter from './routes/months';
import transactionsRouter from './routes/transactions';
import budgetsRouter from './routes/budgets';
import stableBudgetsRouter from './routes/stable-budgets';
import importRouter from './routes/import';
import exportRouter from './routes/export';
import analyticsRouter from './routes/analytics';
import merchantRulesRouter from './routes/merchant-rules';
import groupsRouter from './routes/groups';
import billsRouter from './routes/bills';

const PORT = parseInt(process.env.PORT ?? '3001');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Public health check.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Everything below requires a valid token and provisions the user on first use.
app.use('/api', requireAuth, ensureProvisioned);

app.use('/api/categories', categoriesRouter);
app.use('/api/months', monthsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/stable-budgets', stableBudgetsRouter);
app.use('/api/import', importRouter);
app.use('/api/export', exportRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/merchant-rules', merchantRulesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/bills', billsRouter);

async function start() {
  // Verify DB connectivity before serving. Per-user data (categories, current
  // month) is provisioned lazily on each user's first authenticated request.
  await getPool().query('SELECT 1');

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
