/**
 * Run ownership.
 *
 * One orchestrator owns a run end to end. That is a design rule, and this is
 * what enforces it — not deployment discipline, and not the older "was this
 * updated in the last 60 seconds" heuristic, which is a race check rather than
 * ownership: two workers reading the same row a millisecond apart both conclude
 * they may proceed.
 *
 * A worker takes a row by winning a single conditional UPDATE. SQLite/libsql
 * applies it atomically, so exactly one caller can observe rowsAffected === 1
 * for a given lease generation. The loser does nothing and moves on.
 *
 * Leases expire so a worker that dies mid-run (crash, redeploy, OOM) releases
 * its claim instead of stranding the row. Expiry is deliberately longer than the
 * slowest pass we expect: the report pass can run for minutes, and reclaiming a
 * run that is still being worked is worse than waiting.
 */
import { client, nowIso } from "@/lib/db";

/** Longer than the slowest report pass observed, so live work is never stolen. */
export const LEASE_MS = 15 * 60_000;

/** Identifies this process in lease_owner. Host plus pid is enough to debug with. */
export const WORKER_ID = `${process.env["ORCHESTRATOR_ID"] ?? process.env["HOSTNAME"] ?? "local"}:${process.pid}`;

/**
 * Try to take ownership of a run.
 *
 * Wins only when the run is unowned or its previous lease has expired. Returns
 * false when another worker holds it, which is the normal outcome under
 * contention and is not an error.
 */
export async function acquireLease(inquiryId: string, owner = WORKER_ID): Promise<boolean> {
  const now = nowIso();
  const expires = new Date(Date.now() + LEASE_MS).toISOString();
  const res = await client.execute({
    // The WHERE clause is the lock. Re-entrant for the same owner so a worker
    // resuming its own run extends rather than deadlocks against itself.
    sql: `UPDATE inquiries
             SET lease_owner = ?, lease_expires_at = ?
           WHERE id = ?
             AND (lease_owner IS NULL OR lease_expires_at IS NULL
                  OR lease_expires_at < ? OR lease_owner = ?)`,
    args: [owner, expires, inquiryId, now, owner],
  });
  return res.rowsAffected === 1;
}

/**
 * Push out the expiry while work is still running.
 *
 * Long passes call this so a slow-but-healthy run is not mistaken for a dead
 * one. Fails silently when the lease has already been lost, in which case the
 * caller should stop.
 */
export async function renewLease(inquiryId: string, owner = WORKER_ID): Promise<boolean> {
  const expires = new Date(Date.now() + LEASE_MS).toISOString();
  const res = await client.execute({
    sql: `UPDATE inquiries SET lease_expires_at = ? WHERE id = ? AND lease_owner = ?`,
    args: [expires, inquiryId, owner],
  });
  return res.rowsAffected === 1;
}

/**
 * Give the run back.
 *
 * Called when a pass finishes or fails, so the next stage is not blocked for a
 * full lease period. Only the holder can release, so a late call from a worker
 * that already lost the lease cannot clear someone else's claim.
 */
export async function releaseLease(inquiryId: string, owner = WORKER_ID): Promise<void> {
  await client.execute({
    sql: `UPDATE inquiries SET lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND lease_owner = ?`,
    args: [inquiryId, owner],
  });
}

/** Run `fn` only if this worker owns the row, releasing the lease afterwards. */
export async function withLease<T>(
  inquiryId: string,
  fn: () => Promise<T>,
  owner = WORKER_ID,
): Promise<T | null> {
  if (!(await acquireLease(inquiryId, owner))) return null;
  try {
    return await fn();
  } finally {
    await releaseLease(inquiryId, owner);
  }
}
