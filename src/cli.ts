/**
 * CLI entry point — run a one-shot sync without starting the HTTP server.
 * Usage:
 *   npx ts-node src/cli.ts [--full]
 */
import { config } from "./config.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { SyncDatabase } from "./db.js";
import { syncWorkouts } from "./sync.js";

const fullSync = process.argv.includes("--full");

const liftosaur = new LiftosaurClient(config.liftosaur.apiKey);
const intervals = new IntervalsClient(
  config.intervals.athleteId,
  config.intervals.apiKey
);
const db = new SyncDatabase(config.db.path);

console.log(`Starting ${fullSync ? "full" : "incremental"} sync…`);

syncWorkouts(liftosaur, intervals, db, { fullSync })
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
