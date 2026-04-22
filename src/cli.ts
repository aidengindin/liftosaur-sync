/**
 * CLI entry point — run a one-shot sync without starting the HTTP server.
 * Usage:
 *   npx ts-node src/cli.ts [--full]
 */
import fs from "fs/promises";
import { config } from "./config.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { StravaClient } from "./strava.js";
import { GarminClient } from "./garmin.js";
import { SyncDatabase } from "./db.js";
import { syncWorkouts, SyncDestinations } from "./sync.js";
import { parseSince, formatSyncLabel } from "./utils.js";

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // --garmin-login flag: interactive login, saves tokens, then exit
  // -------------------------------------------------------------------------

  if (process.argv.includes("--garmin-login")) {
    const { username, password } = config.garmin;
    if (!username || !password) {
      console.error(
        "GARMIN_USERNAME and GARMIN_PASSWORD must be set in your .env to use --garmin-login."
      );
      process.exit(1);
    }
    const db = new SyncDatabase(config.db.path);
    try {
      console.log(`Logging in to Garmin Connect as ${username}…`);
      const tokens = await GarminClient.loginAndSaveTokens(username, password);
      db.saveGarminTokens(tokens);
      console.log("✓ Garmin Connect authorized. Tokens saved.");
    } catch (err) {
      console.error("Garmin login failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    } finally {
      db.close();
    }
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // --garmin-dump-fit <liftosaur_id>: build a FIT file and write it locally
  // -------------------------------------------------------------------------

  const dumpFitIdx = process.argv.indexOf("--garmin-dump-fit");
  if (dumpFitIdx !== -1) {
    const recordId = process.argv[dumpFitIdx + 1];
    if (!recordId) {
      console.error("--garmin-dump-fit requires a liftosaur record ID");
      process.exit(1);
    }

    const liftosaur = new LiftosaurClient(config.liftosaur.apiKey);
    console.log(`Fetching all Liftosaur history to find record ${recordId}…`);
    const allRecords = await liftosaur.getAllHistory();
    const record = allRecords.find((r) => r.id === recordId);
    if (!record) {
      console.error(`Record ${recordId} not found in Liftosaur history.`);
      process.exit(1);
    }

    await GarminClient.loadFitSdk();
    const client = new GarminClient(null, null, () => {});
    const fitData = client.buildFitFile(record);
    const outPath = `./${recordId}.fit`;
    await fs.writeFile(outPath, fitData);
    console.log(`Wrote ${recordId}.fit`);
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Normal sync flow
  // -------------------------------------------------------------------------

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

  if (config.garmin.enabled) {
    await GarminClient.loadFitSdk();
    const tokens = db.getGarminTokens() ?? null;
    const credentials = config.garmin.password
      ? { username: config.garmin.username, password: config.garmin.password }
      : null;
    if (tokens !== null || credentials !== null) {
      destinations.garmin = new GarminClient(
        credentials,
        tokens,
        (t) => db.saveGarminTokens(t)
      );
    } else {
      console.warn(
        "Garmin is configured but not yet authorized. Run: npm run sync -- --garmin-login"
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
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
