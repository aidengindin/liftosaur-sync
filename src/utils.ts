import { parseExercises } from "./liftosaur.js";

const RELATIVE_RE = /^(\d+)(d|w|m)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const LB_TO_KG = 0.453592;

/**
 * Parse a --since value into an ISO timestamp string.
 * Accepts:
 *   - Relative durations: "7d", "2w", "1m"
 *   - ISO date / datetime strings: "2026-03-18", "2026-03-18T00:00:00.000Z"
 */
export function parseSince(input: string): string {
  const rel = RELATIVE_RE.exec(input);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const now = new Date();
    if (unit === "d") now.setUTCDate(now.getUTCDate() - n);
    else if (unit === "w") now.setUTCDate(now.getUTCDate() - n * 7);
    else if (unit === "m") now.setUTCMonth(now.getUTCMonth() - n);
    return now.toISOString();
  }

  if (DATE_RE.test(input)) {
    return input;
  }

  throw new Error(`Unrecognized --since format: "${input}". Use a relative duration (e.g. 7d, 2w, 1m) or an ISO date (e.g. 2026-03-18).`);
}

/**
 * Normalize a Liftosaur timestamp to a local datetime string (YYYY-MM-DDTHH:mm:ss).
 * Converts from UTC to the provided timezone, or to the host's local timezone
 * when none is provided.
 */
export function toLocalDatetime(isoString: string, timezone?: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid workout timestamp: ${isoString}`);
  }

  const fmt = new Intl.DateTimeFormat("en-CA", {
    ...(timezone ? { timeZone: timezone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Resolve a timezone's UTC offset in seconds *at the given instant*, so that
 * daylight-saving transitions are respected. Falls back to the host timezone.
 */
export function utcOffsetSeconds(isoString: string, timezone?: string): number {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid workout timestamp: ${isoString}`);
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    ...(timezone ? { timeZone: timezone } : {}),
    timeZoneName: "longOffset",
  });
  const name = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";

  // "GMT-04:00", "GMT+02:00", or plain "GMT" at zero offset
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;

  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60);
}

export function formatSyncLabel(fullSync: boolean, since?: string): string {
  if (fullSync) return "full";
  if (since) return `since ${since}`;
  return "incremental";
}

/**
 * Calculate total kg lifted from a Liftoscript exercises block.
 *
 * Counts work sets only — warmups and target prescriptions are excluded, as are
 * bodyweight and assisted sets (weight <= 0), which contribute no external load.
 */
export function calculateKgLifted(exercisesText: string): number {
  let total = 0;

  for (const exercise of parseExercises(exercisesText)) {
    for (const set of exercise.sets) {
      if (set.isWarmup || set.weight <= 0) continue;
      const weightKg = set.unit === "lb" ? set.weight * LB_TO_KG : set.weight;
      total += set.reps * weightKg;
    }
  }

  return Math.round(total * 10) / 10;
}

/**
 * Calculate TSS-style load using Joe Friel's weight training method.
 * Average session tonnage is calibrated at 50 TSS.
 * Formula: round((sessionTonnageKg / avgTonnageKg) * 50)
 */
export function calculateLoad(sessionTonnageKg: number, avgTonnageKg: number): number {
  if (avgTonnageKg <= 0) throw new Error("avgTonnageKg must be > 0");
  return Math.round((sessionTonnageKg / avgTonnageKg) * 50);
}
