import { LiftosaurClient, LiftosaurHistoryRecord, LiftosaurSet } from "./liftosaur.js";
import { IntervalsClient, IntervalsActivity } from "./intervals.js";
import { StravaClient, StravaCreateActivityParams } from "./strava.js";
import { SyncDatabase } from "./db.js";
import { toLocalDatetime, calculateKgLifted } from "./utils.js";

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

function formatSets(sets: LiftosaurSet[]): string {
  const groups: { reps: number; weight: number; unit: string; count: number }[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.reps === s.reps && last.weight === s.weight && last.unit === s.unit) {
      last.count++;
    } else {
      groups.push({ reps: s.reps, weight: s.weight, unit: s.unit, count: 1 });
    }
  }
  return groups
    .map((g) =>
      g.weight > 0
        ? `${g.count}×${g.reps} @ ${g.weight}${g.unit}`
        : `${g.count}×${g.reps} (bodyweight)`
    )
    .join(", ");
}

function buildDescription(record: LiftosaurHistoryRecord): string {
  const lines: string[] = [];

  if (record.program) lines.push(`Program: ${record.program}`);
  if (record.week !== undefined && record.dayInWeek !== undefined) {
    lines.push(`Week ${record.week}, Day ${record.dayInWeek}`);
  }

  if (record.exercises.length > 0) {
    lines.push("");
    lines.push("Exercises:");
    for (const ex of record.exercises) {
      const name = ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name;
      const workSets = ex.sets.filter((s) => !s.isWarmup);
      const warmupSets = ex.sets.filter((s) => s.isWarmup);

      const parts: string[] = [name];
      if (workSets.length > 0) parts.push(formatSets(workSets));
      if (warmupSets.length > 0) parts.push(`warmup: ${formatSets(warmupSets)}`);
      lines.push(`  • ${parts.join(" — ")}`);
    }
  } else if (record.exercisesText) {
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
  timezone?: string
): Promise<void> {
  const kgLifted = record.exercisesText ? calculateKgLifted(record.exercisesText) : undefined;
  const activity: IntervalsActivity = {
    start_date_local: toLocalDatetime(record.timestamp, timezone),
    name: buildEventName(record),
    type: "WeightTraining",
    description: buildDescription(record),
    external_id: `liftosaur:${record.id}`,
    ...(record.duration ? { moving_time: record.duration, elapsed_time: record.duration } : {}),
    ...(kgLifted ? { kg_lifted: kgLifted } : {}),
  };

  const created = await client.createActivity(activity);
  db.markSynced(record.id, "intervals", String(created.id));
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

  const created = await client.createActivity(params);
  db.markSynced(record.id, "strava", String(created.id));
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
  options: { fullSync?: boolean; since?: string; timezone?: string } = {}
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
          await syncToIntervals(record, client as IntervalsClient, db, options.timezone);
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
