export interface IntervalsEvent {
  /** ISO date-time string in local time, e.g. "2026-03-01T10:00:00" */
  start_date_local: string;
  name: string;
  description?: string;
  /** Activity type — use "WeightTraining" for strength workouts */
  type?: string;
  category?: string;
  moving_time?: number; // seconds
  /** Arbitrary key used to identify the source record and prevent duplicates */
  uid?: string;
}

export interface IntervalsCreatedEvent {
  id: number;
  uid?: string;
  name: string;
  start_date_local: string;
  type: string;
}

export class IntervalsClient {
  private readonly baseUrl = "https://intervals.icu/api/v1";
  private readonly authHeader: string;

  constructor(
    private readonly athleteId: string,
    apiKey: string
  ) {
    // Intervals.icu uses HTTP Basic auth: username=API_KEY, password=<key>
    this.authHeader =
      "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  }

  async createEvent(event: IntervalsEvent): Promise<IntervalsCreatedEvent> {
    const url = `${this.baseUrl}/athlete/${this.athleteId}/events`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Intervals.icu API error ${response.status}: ${body}`
      );
    }

    return response.json() as Promise<IntervalsCreatedEvent>;
  }

  async getEvents(startDate: string, endDate: string): Promise<IntervalsCreatedEvent[]> {
    const params = new URLSearchParams({ oldest: startDate, newest: endDate });
    const url = `${this.baseUrl}/athlete/${this.athleteId}/events?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Intervals.icu API error ${response.status}: ${body}`
      );
    }

    return response.json() as Promise<IntervalsCreatedEvent[]>;
  }
}
