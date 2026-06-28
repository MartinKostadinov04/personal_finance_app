import './env';
import 'express-async-errors';

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { getPool } from './db/pg';
import { requireAuth } from './middleware/auth';
import { ensureProvisioned } from './middleware/provision';
import { rlsContext } from './middleware/rlsContext';
import { errorHandler } from './middleware/errorHandler';

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

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const PORT = parseInt(process.env.PORT ?? '3001');

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('WARNING: CORS_ORIGIN is not set — API will only accept requests from http://localhost:5173');
}
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const app = express();

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate-limit all /api routes (including unauthenticated ones).
app.use('/api', apiLimiter);

// Public health check.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Everything below requires a valid token and provisions the user on first use.
// rlsContext then runs each request as the authenticated user so RLS is enforced
// at the database (it is mounted after provisioning, which needs the admin path).
app.use('/api', requireAuth, ensureProvisioned, rlsContext);

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

// Terminal error handler — must be last, after all routers.
app.use(errorHandler);

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
