export interface LiftosaurSet {
  reps: number;
  weight: number;
  unit: "lb" | "kg";
  isWarmup?: boolean;
}

export interface LiftosaurExercise {
  name: string;
  equipment?: string;
  sets: LiftosaurSet[];
}

export interface LiftosaurHistoryRecord {
  id: string;
  timestamp: string; // ISO 8601
  program?: string;
  dayName?: string;
  week?: number;
  dayInWeek?: number;
  duration?: number; // seconds
  exercises: LiftosaurExercise[];
  /** Raw exercise text in Liftoscript Workouts format */
  exercisesText?: string;
}

// ---------------------------------------------------------------------------
// Text format parser
// ---------------------------------------------------------------------------

/** Matches one set group: "3x8 175lb", "2x6|6 50lb", "1x12 -15lb", "1x10 42.5kg" */
const SET_GROUP_RE = /^(\d+)x([\d|]+)\s+(-?\d+(?:\.\d+)?)(lb|kg)/;

/**
 * Parse one comma-separated list of set groups into individual sets.
 * Bilateral reps ("6|6") expand to one set per side.
 */
function parseSetGroups(text: string, isWarmup: boolean): LiftosaurSet[] {
  const sets: LiftosaurSet[] = [];

  for (const group of text.split(",")) {
    const m = SET_GROUP_RE.exec(group.trim());
    if (!m) continue;

    const count = parseInt(m[1], 10);
    const perSide = m[2].split("|").map((n) => parseInt(n, 10));
    const weight = parseFloat(m[3]);
    const unit = m[4] as "lb" | "kg";

    for (let i = 0; i < count; i++) {
      for (const reps of perSide) {
        sets.push({ reps, weight, unit, ...(isWarmup ? { isWarmup: true } : {}) });
      }
    }
  }

  return sets;
}

/**
 * Parse a Liftoscript exercises block into structured exercises and sets.
 *
 * Each line looks like:
 *   Name[, Equipment] / <work sets> [/ warmup: <sets>] [/ target: <prescription>]
 *
 * Warmup sets are included and flagged; target segments are prescriptions rather
 * than performed work and are dropped. Lines beginning with "//" are comments.
 */
export function parseExercises(exercisesText: string): LiftosaurExercise[] {
  const exercises: LiftosaurExercise[] = [];

  for (const line of exercisesText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    const segments = trimmed.split(" / ");
    const [name, equipment] = segments[0].split(",").map((s) => s.trim());
    if (!name) continue;

    const sets: LiftosaurSet[] = [];
    for (const segment of segments.slice(1)) {
      const s = segment.trim();
      if (s.startsWith("target:")) continue;
      if (s.startsWith("warmup:")) {
        sets.push(...parseSetGroups(s.slice("warmup:".length), true));
      } else {
        sets.push(...parseSetGroups(s, false));
      }
    }

    exercises.push({ name, ...(equipment ? { equipment } : {}), sets });
  }

  return exercises;
}

/**
 * Parse a Liftoscript Workouts text record into a structured LiftosaurHistoryRecord.
 * The text format looks like:
 *   2026-03-01T10:00:00Z / program: "5/3/1" / dayName: "Squat Day" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: {
 *     Squat, Barbell / 3x5 185lb
 *   }
 */
export function parseHistoryText(id: number, text: string): LiftosaurHistoryRecord {
  // Timestamp is the first whitespace-delimited token if it looks like an ISO date
  // Handles both "2026-03-24 10:31:32 +00:00" and "2026-03-20T03:58:12Z"
  const timestampMatch = text.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:Z|\s*[+-]\d{2}:\d{2})?)/);
  const timestamp = timestampMatch ? timestampMatch[1] : new Date(id).toISOString();

  const programMatch = text.match(/program: "([^"]*)"/);
  const dayNameMatch = text.match(/dayName: "([^"]*)"/);
  const weekMatch = text.match(/\bweek: (\d+)/);
  const dayInWeekMatch = text.match(/dayInWeek: (\d+)/);
  const durationMatch = text.match(/duration: (\d+)s/);

  // Extract exercises block content
  const exercisesMatch = text.match(/exercises: \{([\s\S]*)\}/);
  const exercisesText = exercisesMatch ? exercisesMatch[1].trim() : undefined;

  return {
    id: String(id),
    timestamp,
    program: programMatch?.[1],
    dayName: dayNameMatch?.[1],
    week: weekMatch ? parseInt(weekMatch[1], 10) : undefined,
    dayInWeek: dayInWeekMatch ? parseInt(dayInWeekMatch[1], 10) : undefined,
    duration: durationMatch ? parseInt(durationMatch[1], 10) : undefined,
    exercises: exercisesText ? parseExercises(exercisesText) : [],
    exercisesText: exercisesText || undefined,
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

interface LiftosaurApiRecord {
  id: number;
  text: string;
}

interface LiftosaurApiResponse {
  data: {
    records: LiftosaurApiRecord[];
    hasMore: boolean;
    nextCursor?: number;
  };
}

export class LiftosaurClient {
  private readonly baseUrl = "https://www.liftosaur.com/api/v1";

  constructor(private readonly apiKey: string) {}

  async getHistory(options: {
    startDate?: string;
    endDate?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<{ records: LiftosaurHistoryRecord[]; hasMore: boolean; nextCursor?: string }> {
    const params = new URLSearchParams();
    if (options.startDate) params.set("startDate", options.startDate);
    if (options.endDate) params.set("endDate", options.endDate);
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit) params.set("limit", String(options.limit));

    const url = `${this.baseUrl}/history${params.size ? `?${params}` : ""}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Liftosaur API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as LiftosaurApiResponse;
    const { records, hasMore, nextCursor } = json.data;

    return {
      records: records.map((r) => parseHistoryText(r.id, r.text)),
      hasMore,
      nextCursor: nextCursor !== undefined ? String(nextCursor) : undefined,
    };
  }

  /** Fetch all history pages since a given date */
  async getAllHistory(since?: string): Promise<LiftosaurHistoryRecord[]> {
    const records: LiftosaurHistoryRecord[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.getHistory({
        startDate: since,
        cursor,
        limit: 200,
      });
      records.push(...page.records);
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor);

    return records;
  }
}
