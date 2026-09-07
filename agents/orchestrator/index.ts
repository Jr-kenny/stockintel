/**
 * The orchestrator, as a long-lived service.
 *
 * StockIntel has exactly one orchestrator — the admin that forms hypotheses,
 * dispatches the ten specialists, grades what comes back, connects it and writes
 * the report. It belongs on a machine that stays awake. Running it inside a web
 * request made it a visitor: the request set the clock, and on Vercel that clock
 * is a hard 300 seconds. Since collection alone spends 300 seconds, the report
 * pass had no budget left and was killed every time, which is why runs completed
 * carrying evidence but no analysis.
 *
 * Here it owns its own time. It watches the database for work and takes as long
 * as each pass needs.
 *
 *   bun run agents/orchestrator/index.ts
 *
 * Env:
 *   DATABASE_URL / DATABASE_AUTH_TOKEN   the shared run store
 *   PUBLIC_SUBMIT_URL                    where agents post claims back
 *   ORCHESTRATOR_ID                      lease identity (default hostname:pid)
 *   ORCHESTRATOR_TICK_MS                 poll interval (default 5000)
 *   ORCHESTRATOR_PORT                    health + wake listener (default 8789)
 *
 * Safety: every run is taken under a lease, so this can be deployed while the
 * old in-request path is still live without two workers touching one run.
 */

import { db, ensureSchema, nowIso } from "@/lib/db";
import { inquiries } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { runInquiry, tryGradeIfReady } from "@/lib/orchestrator/run";
import { acquireLease, releaseLease, WORKER_ID } from "@/lib/orchestrator/lease";

const TICK_MS = Number(process.env["ORCHESTRATOR_TICK_MS"] ?? 5000);
const PORT = Number(process.env["ORCHESTRATOR_PORT"] ?? 8789);
const SUBMIT_BASE = process.env["PUBLIC_SUBMIT_URL"] ?? "http://localhost:8080";
const SUBMIT_URL = `${SUBMIT_BASE}/api/claims/submit`;

/** Runs this worker is mid-way through, so a slow pass is never started twice. */
const inFlight = new Set<string>();

let ticks = 0;
let handled = 0;
let failures = 0;

/**
 * Work waiting to be done: fresh runs to dispatch, and open runs whose window
 * may have closed. Oldest first so nothing starves behind a busy stretch.
 *
 * Terminal rows are excluded, and rows another worker holds a live lease on are
 * left alone — the lease is re-checked atomically before we act, so this filter
 * is only about not wasting a tick.
 */
async function findWork(): Promise<string[]> {
  const now = nowIso();
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(
      and(
        inArray(inquiries.status, ["dispatching", "collecting", "grading"]),
        or(
          isNull(inquiries.leaseOwner),
          isNull(inquiries.leaseExpiresAt),
          lt(inquiries.leaseExpiresAt, now),
          eq(inquiries.leaseOwner, WORKER_ID),
        ),
      ),
    )
    .orderBy(asc(inquiries.createdAt))
    .limit(20);
  return rows.map((r) => r.id).filter((id) => !inFlight.has(id));
}

/**
 * Move one run forward by exactly one step, under lease.
 *
 * Dispatch and advance are both idempotent and both re-read the row, so calling
 * this repeatedly is how a run progresses: dispatch, wave two, grade, report.
 * The lease is released in `finally` so a thrown pass does not park the run for a
 * full lease period.
 */
async function advance(inquiryId: string): Promise<void> {
  if (!(await acquireLease(inquiryId))) return;
  inFlight.add(inquiryId);
  try {
    const [row] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!row) return;

    if (row.status === "dispatching") {
      console.log(`→ dispatch ${inquiryId}`);
      await runInquiry(inquiryId, SUBMIT_URL);
      handled++;
      return;
    }

    // collecting or grading: advance the wave, grade, or finish a stalled
    // report. tryGradeIfReady decides which, and returns false when the run is
    // simply not ready yet, which is the common case on most ticks.
    const moved = await tryGradeIfReady(inquiryId);
    if (moved) {
      const [after] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
      console.log(`→ advanced ${inquiryId} to ${after?.status ?? "?"}`);
      handled++;
    }
  } catch (err) {
    failures++;
    console.error(`✗ ${inquiryId}:`, err instanceof Error ? err.message : err);
  } finally {
    inFlight.delete(inquiryId);
    await releaseLease(inquiryId).catch(() => {});
  }
}

/**
 * One pass over the queue.
 *
 * Runs advance in parallel because a slow report pass on one must not hold up
 * dispatch on another. Each is independently leased, so parallelism here cannot
 * produce two workers on one run.
 */
async function tick(): Promise<void> {
  ticks++;
  const work = await findWork();
  if (work.length === 0) return;
  await Promise.all(work.map((id) => advance(id)));
}

/**
 * Health, plus an optional wake.
 *
 * The loop alone is enough to run the system: a submitted row is picked up on
 * the next tick. POST /wake exists so the app can say "there is work now" and
 * shave the polling delay off the start. It is an optimization, never a
 * requirement — if this endpoint is unreachable the run still starts, just a few
 * seconds later, so a network blip cannot lose work.
 */
function serve() {
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({
          ok: true,
          service: "stockintel-orchestrator",
          worker: WORKER_ID,
          ticks,
          handled,
          failures,
          inFlight: [...inFlight],
        });
      }
      if (req.method === "POST" && url.pathname === "/wake") {
        void tick().catch((err) => console.error("wake tick failed:", err));
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.log(`✓ listening on http://localhost:${PORT}/health`);
}

async function main() {
  await ensureSchema();
  console.log(`✓ orchestrator ${WORKER_ID} · tick ${TICK_MS}ms · claims → ${SUBMIT_URL}`);
  serve();

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (stopping) process.exit(0);
      stopping = true;
      // Release what we hold so a restart resumes immediately instead of
      // waiting out the lease on rows this worker was mid-way through.
      console.log(`\n${sig} — releasing ${inFlight.size} lease(s)`);
      void Promise.all([...inFlight].map((id) => releaseLease(id).catch(() => {}))).then(() =>
        process.exit(0),
      );
      setTimeout(() => process.exit(0), 5000);
    });
  }

  for (;;) {
    if (stopping) return;
    try {
      await tick();
    } catch (err) {
      // Never let one bad tick kill the service. systemd would restart it, but a
      // transient database blip should not count as a crash.
      console.error("tick failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

await main();
