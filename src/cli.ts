/**
 * CLI entry point — run a one-shot sync without starting the HTTP server.
 * Usage:
 *   npx ts-node src/cli.ts [--full]
 */
import { config } from "./config.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { StravaClient } from "./strava.js";
import { SyncDatabase } from "./db.js";
import { syncWorkouts, SyncDestinations } from "./sync.js";
import { parseSince, formatSyncLabel } from "./utils.js";

const fullSync = process.argv.includes("--full");

const sinceIdx = process.argv.indexOf("--since");
let sinceDate: string | undefined;
if (sinceIdx !== -1) {
  const sinceArg = process.argv[sinceIdx + 1];
  if (!sinceArg) {
    console.error("--since requires a value (e.g. --since 7d or --since 2026-03-18)");
    process.exit(1);
  }
  try {
    sinceDate = parseSince(sinceArg);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const liftosaur = new LiftosaurClient(config.liftosaur.apiKey);
const db = new SyncDatabase(config.db.path);

const destinations: SyncDestinations = {};

if (config.intervals.enabled) {
  destinations.intervals = new IntervalsClient(
    config.intervals.athleteId,
    config.intervals.apiKey
  );
}

if (config.strava.enabled) {
  const tokens = db.getStravaTokens();
  if (tokens) {
    destinations.strava = new StravaClient(
      config.strava.clientId,
      config.strava.clientSecret,
      tokens,
      (refreshed) => db.saveStravaTokens(refreshed)
    );
  } else {
    console.warn(
      "Strava is configured but not yet authorized. Start the server and visit /auth/strava to connect."
    );
  }
}

if (Object.keys(destinations).length === 0) {
  console.error("No sync destinations configured or authorized. Check your .env file.");
  db.close();
  process.exit(1);
}

console.log(`Starting ${formatSyncLabel(fullSync, sinceDate)} sync to: ${Object.keys(destinations).join(", ")}…`);

syncWorkouts(liftosaur, destinations, db, {
  fullSync,
  since: sinceDate,
  timezone: config.timezone,
  loadWindowWeeks: config.load.enabled ? config.load.windowWeeks : undefined,
})
  .then((result) => {
    console.log(
      `\nDone — synced: ${result.synced}, skipped: ${result.skipped}, errors: ${result.errors.length}`
    );
    if (result.errors.length > 0) {
      console.error("\nErrors:");
      for (const e of result.errors) {
        console.error(`  ${e.id}: ${e.error}`);
      }
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => db.close());
