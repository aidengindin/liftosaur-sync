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
 * If timezone is provided, converts from UTC to that timezone first.
 */
export function toLocalDatetime(isoString: string, timezone?: string): string {
  if (timezone) {
    const date = new Date(isoString);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
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
  return isoString.replace(/\s*Z$/, "").replace(/\s*[+-]\d{2}:\d{2}$/, "").replace(" ", "T");
}

/**
 * Calculate total kg lifted from a Liftoscript exercises block.
 * Only counts work sets (not warmup or target lines).
 */
export function formatSyncLabel(fullSync: boolean, since?: string): string {
  if (fullSync) return "full";
  if (since) return `since ${since}`;
  return "incremental";
}

export function calculateKgLifted(exercisesText: string): number {
  let total = 0;
  for (const line of exercisesText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: "Exercise Name / sets / warmup: ... / target: ..."
    const segments = trimmed.split(" / ");
    if (segments.length < 2) continue;

    const setsDesc = segments[1].trim();
    if (setsDesc.startsWith("warmup:") || setsDesc.startsWith("target:")) continue;

    // Parse "NxM weight unit" where M may be "10|10" for bilateral
    const m = setsDesc.match(/^(\d+)x([\d|]+)\s+(\d+(?:\.\d+)?)(lb|kg)/);
    if (!m) continue;

    const sets = parseInt(m[1], 10);
    const reps = m[2].split("|").reduce((s, n) => s + parseInt(n, 10), 0);
    const weight = parseFloat(m[3]);
    if (weight <= 0) continue;

    const weightKg = m[4] === "lb" ? weight * LB_TO_KG : weight;
    total += sets * reps * weightKg;
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
