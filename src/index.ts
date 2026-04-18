import express, { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { StravaClient } from "./strava.js";
import { GarminClient } from "./garmin.js";
import { SyncDatabase } from "./db.js";
import { syncWorkouts, SyncDestinations } from "./sync.js";
import { parseSince, formatSyncLabel } from "./utils.js";

const app = express();
app.use(express.json());

const liftosaur = new LiftosaurClient(config.liftosaur.apiKey);
const db = new SyncDatabase(config.db.path);

const intervals = config.intervals.enabled
  ? new IntervalsClient(config.intervals.athleteId, config.intervals.apiKey)
  : undefined;

function makeStravaClient(): StravaClient | undefined {
  if (!config.strava.enabled) return undefined;
  const tokens = db.getStravaTokens();
  if (!tokens) return undefined;
  return new StravaClient(
    config.strava.clientId,
    config.strava.clientSecret,
    tokens,
    (refreshed) => db.saveStravaTokens(refreshed)
  );
}

function makeGarminClient(): GarminClient | undefined {
  if (!config.garmin.enabled) return undefined;
  const tokens = db.getGarminTokens();
  return new GarminClient(
    config.garmin.password
      ? { username: config.garmin.username, password: config.garmin.password }
      : null,
    tokens ?? null,
    (t) => db.saveGarminTokens(t)
  );
}

/** Optional bearer-token auth for sync/status endpoints */
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

// Pre-load the FIT SDK at startup if Garmin is enabled
if (config.garmin.enabled) {
  GarminClient.loadFitSdk().catch((err) => {
    console.error("Failed to load Garmin FIT SDK:", err instanceof Error ? err.message : String(err));
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    destinations: {
      intervals: config.intervals.enabled,
      strava: config.strava.enabled && db.getStravaTokens() !== undefined,
      garmin: config.garmin.enabled && db.getGarminTokens() !== undefined,
    },
  });
});

/**
 * POST /sync
 * Triggers an incremental sync to all configured destinations.
 * Body (optional): { "full": true } to re-sync everything from the beginning.
 */
app.post("/sync", authenticate, async (req: Request, res: Response) => {
  const fullSync = req.body?.full === true;

  let sinceDate: string | undefined;
  if (req.body?.since) {
    try {
      sinceDate = parseSince(String(req.body.since));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
      return;
    }
  }

  const strava = makeStravaClient();
  const garmin = makeGarminClient();
  const destinations: SyncDestinations = {
    ...(intervals ? { intervals } : {}),
    ...(strava ? { strava } : {}),
    ...(garmin ? { garmin } : {}),
  };

  try {
    console.log(`Starting ${formatSyncLabel(fullSync, sinceDate)} sync…`);
    const result = await syncWorkouts(liftosaur, destinations, db, { fullSync, since: sinceDate, timezone: config.timezone, loadWindowWeeks: config.load.enabled ? config.load.windowWeeks : undefined });
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
  const lastSyncedAt = db.getLastSyncedAt();
  res.json({
    totalSynced: db.getSyncedWorkoutsCount(),
    lastSyncedAt: lastSyncedAt ?? null,
    recentWorkouts: db.getRecentSyncedWorkouts(10),
  });
});

// ---------------------------------------------------------------------------
// Strava OAuth flow
// ---------------------------------------------------------------------------

/**
 * GET /auth/strava
 * Redirects the user to Strava's authorization page.
 */
app.get("/auth/strava", (_req, res) => {
  if (!config.strava.enabled) {
    res.status(503).json({ error: "Strava is not configured" });
    return;
  }
  const redirectUri = `${config.server.baseUrl}/auth/strava/callback`;
  const url = StravaClient.authorizationUrl(config.strava.clientId, redirectUri);
  res.redirect(url);
});

/**
 * GET /auth/strava/callback
 * Handles the OAuth callback from Strava, exchanges the code for tokens,
 * and saves them to the database.
 */
app.get("/auth/strava/callback", async (req: Request, res: Response) => {
  if (!config.strava.enabled) {
    res.status(503).json({ error: "Strava is not configured" });
    return;
  }

  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  if (error || !code) {
    res.status(400).json({ error: error ?? "Missing authorization code" });
    return;
  }

  try {
    const tokens = await StravaClient.exchangeCode(
      config.strava.clientId,
      config.strava.clientSecret,
      code
    );
    db.saveStravaTokens(tokens);
    res.json({ ok: true, message: "Strava connected successfully. You can now trigger a sync." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(config.server.port, () => {
  console.log(`liftosaur-sync listening on port ${config.server.port}`);
  console.log(`  POST /sync               — trigger sync`);
  console.log(`  GET  /status             — view sync status`);
  console.log(`  GET  /health             — health check`);
  if (config.strava.enabled) {
    console.log(`  GET  /auth/strava        — connect Strava account`);
    if (!db.getStravaTokens()) {
      console.warn("  ⚠ Strava is configured but not yet authorized. Visit /auth/strava to connect.");
    }
  }
  if (config.garmin.enabled) {
    if (!db.getGarminTokens()) {
      console.warn("  ⚠ Garmin enabled but not authorized — run: npm run sync -- --garmin-login");
    } else {
      console.log("  ✓ Garmin Connect ready");
    }
  }
});

process.on("SIGTERM", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
