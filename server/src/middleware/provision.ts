import { Request, Response, NextFunction } from 'express';
import { seedCategories } from '../db/seed';
import { resolveMonthId } from '../db/months';

// Tracks users already provisioned this process lifetime, so we only hit the DB
// for the check once per user. (A fresh process re-checks, but seedCategories is
// a no-op when the user already has categories, so it stays correct.)
const provisioned = new Set<string>();

/** Ensure a newly-authenticated user has default categories + the current month. */
export async function ensureProvisioned(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  if (provisioned.has(userId)) {
    next();
    return;
  }
  try {
    await seedCategories(userId);
    const now = new Date();
    await resolveMonthId(userId, now.getFullYear(), now.getMonth() + 1);
    provisioned.add(userId);
    next();
  } catch (e) {
    console.error('Provisioning failed:', e);
    res.status(500).json({ error: 'Provisioning failed' });
  }
}
