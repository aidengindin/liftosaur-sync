import { LiftosaurClient, LiftosaurHistoryRecord, LiftosaurExercise } from "./liftosaur.js";
import { IntervalsClient, IntervalsActivity } from "./intervals.js";
import { StravaClient, StravaConflictError, StravaSet } from "./strava.js";
import { SyncDatabase } from "./db.js";
import { toLocalDatetime, calculateKgLifted, calculateLoad, utcOffsetSeconds } from "./utils.js";
import { resolveExerciseType } from "./exercise-map.js";

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

const LB_TO_KG = 0.453592;

/**
 * Convert parsed Liftosaur exercises into Strava upload sets.
 *
 * Warmups are included — Strava's log shows the full session. Sets at or below
 * zero weight (bodyweight, assisted machines) carry reps but no weight, since
 * Strava expects a positive kilogram value. Exercises with no known Strava
 * exercise type are dropped with a warning rather than sent as an invalid type,
 * which would reject the entire upload.
 */
export function buildStravaSets(exercises: LiftosaurExercise[]): StravaSet[] {
  const sets: StravaSet[] = [];

  for (const exercise of exercises) {
    const exerciseType = resolveExerciseType(exercise.name, exercise.equipment);

    if (!exerciseType) {
      const label = exercise.equipment
        ? `${exercise.name}, ${exercise.equipment}`
        : exercise.name;
      console.warn(
        `  ⚠ No Strava exercise type for "${label}" — skipping its sets. ` +
          `Add it to EXERCISE_MAP in src/exercise-map.ts.`
      );
      continue;
    }

    for (const set of exercise.sets) {
      const weightKg = set.unit === "lb" ? set.weight * LB_TO_KG : set.weight;
      sets.push({
        exercise_type: exerciseType,
        repetitions: set.reps,
        ...(weightKg > 0 ? { weight: Math.round(weightKg * 10) / 10 } : {}),
      });
    }
  }

  return sets;
}

async function syncToStrava(
  record: LiftosaurHistoryRecord,
  client: StravaClient,
  db: SyncDatabase,
  timezone?: string
): Promise<void> {
  const sets = buildStravaSets(record.exercises);

  // Strava requires a non-empty sets array and an elapsed time.
  if (sets.length === 0) {
    console.warn(`  ⚠ No mappable sets for ${record.id}, skipping Strava upload`);
    return;
  }
  if (!record.duration) {
    console.warn(`  ⚠ No duration for ${record.id}, skipping Strava upload`);
    return;
  }

  try {
    const activityId = await client.uploadWorkout({
      name: buildEventName(record),
      description: buildDescription(record),
      externalId: `liftosaur-${record.id}`,
      startTime: new Date(record.timestamp).toISOString(),
      utcOffset: utcOffsetSeconds(record.timestamp, timezone),
      elapsedTime: record.duration,
      sets,
    });
    db.markSynced(record.id, "strava", String(activityId));
  } catch (err) {
    if (err instanceof StravaConflictError) {
      console.log(`  ⚠ Activity already exists in Strava, marking as synced`);
      db.markSynced(record.id, "strava", err.activityId ?? "conflict");
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
  ) as [string, IntervalsClient | StravaClient][];

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
