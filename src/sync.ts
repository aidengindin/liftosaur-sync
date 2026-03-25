import { LiftosaurClient, LiftosaurHistoryRecord } from "./liftosaur.js";
import { IntervalsClient, IntervalsEvent } from "./intervals.js";
import { SyncDatabase } from "./db.js";

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Convert a Liftosaur history record into a description string for Intervals.icu.
 * Since Liftosaur uses the Liftoscript Workouts text format for exercises, we
 * surface that directly plus any structured data we have.
 */
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

      const formatSets = (sets: typeof ex.sets): string => {
        // Group consecutive identical sets
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
      };

      const parts: string[] = [name];
      if (workSets.length > 0) parts.push(formatSets(workSets));
      if (warmupSets.length > 0) parts.push(`warmup: ${formatSets(warmupSets)}`);
      lines.push(`  • ${parts.join(" — ")}`);
    }
  } else if (record.exercisesText) {
    lines.push("");
    lines.push("Exercises (raw):");
    lines.push(record.exercisesText);
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

/** Strip the Z / offset to get a local datetime string for Intervals.icu */
function toLocalDatetime(isoString: string): string {
  // Intervals.icu wants "YYYY-MM-DDTHH:mm:ss" without timezone
  return isoString.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
}

export async function syncWorkouts(
  liftosaurClient: LiftosaurClient,
  intervalsClient: IntervalsClient,
  db: SyncDatabase,
  options: { fullSync?: boolean } = {}
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] };

  // Determine date range
  const since = options.fullSync ? undefined : db.getLastSyncedAt();

  console.log(
    since ? `Fetching Liftosaur history since ${since}` : "Fetching full Liftosaur history"
  );

  const records = await liftosaurClient.getAllHistory(since);
  console.log(`Found ${records.length} workout(s) to process`);

  let latestTimestamp: string | undefined;

  for (const record of records) {
    if (db.isSynced(record.id)) {
      result.skipped++;
      continue;
    }

    try {
      const event: IntervalsEvent = {
        start_date_local: toLocalDatetime(record.timestamp),
        name: buildEventName(record),
        description: buildDescription(record),
        type: "WeightTraining",
        category: "WORKOUT",
        ...(record.duration ? { moving_time: record.duration } : {}),
        uid: `liftosaur:${record.id}`,
      };

      const created = await intervalsClient.createEvent(event);
      db.markSynced(record.id, created.id);
      result.synced++;

      if (!latestTimestamp || record.timestamp > latestTimestamp) {
        latestTimestamp = record.timestamp;
      }

      console.log(`  ✓ Synced "${event.name}" (${record.timestamp})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed to sync ${record.id}: ${message}`);
      result.errors.push({ id: record.id, error: message });
    }
  }

  if (latestTimestamp) {
    db.setLastSyncedAt(latestTimestamp);
  }

  return result;
}
