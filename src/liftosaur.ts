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

export interface LiftosaurHistoryResponse {
  data: {
    records: LiftosaurHistoryRecord[];
    hasMore: boolean;
    nextCursor?: string;
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
  } = {}): Promise<LiftosaurHistoryResponse["data"]> {
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
      throw new Error(
        `Liftosaur API error ${response.status}: ${body}`
      );
    }

    const json = (await response.json()) as LiftosaurHistoryResponse;
    return json.data;
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
