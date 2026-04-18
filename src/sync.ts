import { LiftosaurClient, LiftosaurHistoryRecord } from "./liftosaur.js";
import { IntervalsClient, IntervalsActivity } from "./intervals.js";
import { StravaClient, StravaConflictError, StravaCreateActivityParams } from "./strava.js";
import { GarminClient, GarminConflictError } from "./garmin.js";
import { SyncDatabase } from "./db.js";
import { toLocalDatetime, calculateKgLifted, calculateLoad } from "./utils.js";

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

function buildDescription(record: LiftosaurHistoryRecord): string {
  const lines: string[] = [];

  if (record.program) lines.push(`Program: ${record.program}`);
  if (record.week !== undefined && record.dayInWeek !== undefined) {
    lines.push(`Week ${record.week}, Day ${record.dayInWeek}`);
  }

  if (record.exercisesText) {
    lines.push("");
    lines.push("Exercises:");
    const exerciseLines = record.exercisesText.split("\n").filter((l) => l.trim());
    lines.push(exerciseLines.join("\n\n"));
  }

  lines.push("");
  lines.push("Synced from Liftosaur");
  return lines.join("\n");
}

function buildEventName(record: LiftosaurHistoryRecord): string {
  const parts: string[] = ["Liftosaur"];
  if (record.dayName) parts.push(record.dayName);
  else if (record.program) parts.push(record.program);
  return parts.join(": ");
}

// ---------------------------------------------------------------------------
// Destination-specific sync functions
// ---------------------------------------------------------------------------

async function syncToIntervals(
  record: LiftosaurHistoryRecord,
  client: IntervalsClient,
  db: SyncDatabase,
  timezone?: string,
  loadWindowWeeks?: number
): Promise<void> {
  const kgLifted = record.exercisesText ? calculateKgLifted(record.exercisesText) : undefined;

  let load: number | undefined;
  if (loadWindowWeeks !== undefined && kgLifted && kgLifted > 0) {
    const avg = db.getAvgTonnageKg(loadWindowWeeks);
    if (avg !== undefined) {
      load = calculateLoad(kgLifted, avg);
    }
  }

  const activity: IntervalsActivity = {
    start_date_local: toLocalDatetime(record.timestamp, timezone),
    name: buildEventName(record),
    type: "WeightTraining",
    description: buildDescription(record),
    external_id: `liftosaur:${record.id}`,
    ...(record.duration ? { moving_time: record.duration, elapsed_time: record.duration } : {}),
    ...(kgLifted ? { kg_lifted: kgLifted } : {}),
    ...(load !== undefined ? { load } : {}),
  };

  const created = await client.createActivity(activity);
  // Always store tonnage so it contributes to future rolling averages
  db.markSynced(record.id, "intervals", String(created.id), kgLifted);
}

async function syncToStrava(
  record: LiftosaurHistoryRecord,
  client: StravaClient,
  db: SyncDatabase,
  timezone?: string
): Promise<void> {
  const params: StravaCreateActivityParams = {
    name: buildEventName(record),
    sport_type: "WeightTraining",
    start_date_local: toLocalDatetime(record.timestamp, timezone),
    elapsed_time: record.duration ?? 0,
    description: buildDescription(record),
  };

  try {
    const created = await client.createActivity(params);
    db.markSynced(record.id, "strava", String(created.id));
  } catch (err) {
    if (err instanceof StravaConflictError) {
      console.log(`  ⚠ Activity already exists in Strava, marking as synced`);
      db.markSynced(record.id, "strava", "conflict");
      return;
    }
    throw err;
  }
}

async function syncToGarmin(
  record: LiftosaurHistoryRecord,
  client: GarminClient,
  db: SyncDatabase
): Promise<void> {
  try {
    await client.uploadWorkout(record);
    db.markSynced(record.id, "garmin", "uploaded");
  } catch (err) {
    if (err instanceof GarminConflictError) {
      console.log(`  ⚠ Garmin: activity already exists, marking as synced`);
      db.markSynced(record.id, "garmin", "conflict");
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main sync orchestrator
// ---------------------------------------------------------------------------

export interface SyncDestinations {
  intervals?: IntervalsClient;
  strava?: StravaClient;
  garmin?: GarminClient;
}

export async function syncWorkouts(
  liftosaurClient: LiftosaurClient,
  destinations: SyncDestinations,
  db: SyncDatabase,
  options: { fullSync?: boolean; since?: string; timezone?: string; loadWindowWeeks?: number } = {}
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] };
  const since = options.fullSync ? undefined : (options.since ?? db.getLastSyncedAt());

  console.log(
    since ? `Fetching Liftosaur history since ${since}` : "Fetching full Liftosaur history"
  );

  const records = await liftosaurClient.getAllHistory(since);
  console.log(`Found ${records.length} workout(s) to process`);

  const activeDestinations = Object.entries(destinations).filter(
    ([, client]) => client !== undefined
  ) as [string, IntervalsClient | StravaClient | GarminClient][];

  if (activeDestinations.length === 0) {
    console.warn("No sync destinations configured");
    return result;
  }

  let latestTimestamp: string | undefined;

  for (const record of records) {
    const pendingDestinations = activeDestinations.filter(
      ([name]) => !db.isSynced(record.id, name)
    );

    if (pendingDestinations.length === 0) {
      result.skipped++;
      continue;
    }

    for (const [name, client] of pendingDestinations) {
      try {
        if (name === "intervals") {
          await syncToIntervals(record, client as IntervalsClient, db, options.timezone, options.loadWindowWeeks);
        } else if (name === "strava") {
          await syncToStrava(record, client as StravaClient, db, options.timezone);
        } else if (name === "garmin") {
          await syncToGarmin(record, client as GarminClient, db);
        }
        result.synced++;
        console.log(`  ✓ Synced "${buildEventName(record)}" → ${name} (${record.timestamp})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Failed to sync ${record.id} → ${name}: ${message}`);
        result.errors.push({ id: `${record.id}:${name}`, error: message });
      }
    }

    if (!latestTimestamp || record.timestamp > latestTimestamp) {
      latestTimestamp = record.timestamp;
    }
  }

  if (latestTimestamp) {
    db.setLastSyncedAt(latestTimestamp);
  }

  return result;
}
