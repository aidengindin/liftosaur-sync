export interface IntervalsActivity {
  start_date_local: string;
  name: string;
  type: string;
  moving_time?: number;
  elapsed_time?: number;
  description?: string;
  kg_lifted?: number;
  external_id?: string;
}

export interface IntervalsCreatedActivity {
  id: number;
  external_id?: string;
  name: string;
  start_date_local: string;
  type: string;
}

// Keep for backwards compatibility (used by getEvents)
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
    this.authHeader =
      "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  }

  async createActivity(activity: IntervalsActivity): Promise<IntervalsCreatedActivity> {
    const url = `${this.baseUrl}/athlete/${this.athleteId}/activities/manual`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(activity),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Intervals.icu API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<IntervalsCreatedActivity>;
  }

  async getEvents(startDate: string, endDate: string): Promise<IntervalsCreatedEvent[]> {
    const params = new URLSearchParams({ oldest: startDate, newest: endDate });
    const url = `${this.baseUrl}/athlete/${this.athleteId}/events?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Intervals.icu API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<IntervalsCreatedEvent[]>;
  }
}
