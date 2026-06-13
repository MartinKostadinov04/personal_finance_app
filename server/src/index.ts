import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';

const PORT = parseInt(process.env.PORT ?? '3001');
const DB_PATH = path.resolve(process.env.DATABASE_PATH ?? './data/finance.db');

// Must happen before importing db
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

import { initDb, getDb } from './db/index';
import { resolveMonthId } from './db/months';
initDb(DB_PATH);

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

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Ensure the current real-world month exists on boot
  const now = new Date();
  resolveMonthId(getDb(), now.getFullYear(), now.getMonth() + 1);
});
