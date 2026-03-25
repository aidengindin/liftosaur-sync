import express, { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { SyncDatabase } from "./db.js";
import { syncWorkouts } from "./sync.js";

const app = express();
app.use(express.json());

const liftosaur = new LiftosaurClient(config.liftosaur.apiKey);
const intervals = new IntervalsClient(
  config.intervals.athleteId,
  config.intervals.apiKey
);
const db = new SyncDatabase(config.db.path);

/** Optional bearer-token auth for the sync endpoints */
function authenticate(req: Request, res: Response, next: NextFunction): void {
  if (!config.server.syncSecret) {
    next();
    return;
  }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== config.server.syncSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * POST /sync
 * Triggers an incremental sync (only workouts newer than the last sync).
 * Body (optional): { "full": true } to re-sync everything from the beginning.
 */
app.post("/sync", authenticate, async (req: Request, res: Response) => {
  const fullSync = req.body?.full === true;
  try {
    console.log(`Starting ${fullSync ? "full" : "incremental"} sync…`);
    const result = await syncWorkouts(liftosaur, intervals, db, { fullSync });
    console.log(
      `Sync complete — synced: ${result.synced}, skipped: ${result.skipped}, errors: ${result.errors.length}`
    );
    res.json({
      ok: true,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Sync failed:", message);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * GET /status
 * Returns information about previously synced workouts.
 */
app.get("/status", authenticate, (_req, res) => {
  const synced = db.getSyncedWorkouts();
  const lastSyncedAt = db.getLastSyncedAt();
  res.json({
    totalSynced: synced.length,
    lastSyncedAt: lastSyncedAt ?? null,
    recentWorkouts: synced.slice(0, 10),
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(config.server.port, () => {
  console.log(`liftosaur-sync listening on port ${config.server.port}`);
  console.log(`  POST /sync    — trigger sync (add Authorization: Bearer <SYNC_SECRET>)`);
  console.log(`  GET  /status  — view sync status`);
  console.log(`  GET  /health  — health check`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
