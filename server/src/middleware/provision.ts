import { Request, Response, NextFunction } from 'express';
import { adminQuery } from '../db/pg';
import { seedCategories } from '../db/seed';
import { resolveMonthId } from '../db/months';

// Tracks users already provisioned this process lifetime, so we only hit the DB
// for the finance defaults once per user.
const provisioned = new Set<string>();

/**
 * Ensure a newly-authenticated user has default categories + the current month,
 * and claim any Bill Splitting seats that were invited to their email.
 */
export async function ensureProvisioned(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  try {
    if (!provisioned.has(userId)) {
      await seedCategories(userId);
      const now = new Date();
      await resolveMonthId(userId, now.getFullYear(), now.getMonth() + 1);
      // Link any bill participant seats invited to this email to the now-known user.
      // Runs on the admin (BYPASSRLS) path: the caller is not yet a participant of
      // those bills, so RLS would otherwise hide the very rows we need to claim.
      // Only needed once per user (and after every server restart for invited-before-
      // signup users), so it belongs inside the first-provision guard.
      if (req.userEmail) {
        await adminQuery(
          "UPDATE bill_participants SET user_id = $1, status = 'active' WHERE user_id IS NULL AND lower(email) = lower($2)",
          [userId, req.userEmail],
        );
      }
      provisioned.add(userId);
    }
    next();
  } catch (e) {
    console.error('Provisioning failed:', e);
    res.status(500).json({ error: 'Provisioning failed' });
  }
}
