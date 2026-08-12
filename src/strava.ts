export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

/** One performed set in a Strava JSON weight-training upload. */
export interface StravaSet {
  /** FIT exercise name, e.g. "BARBELL_BACK_SQUAT" */
  exercise_type: string;
  repetitions?: number;
  /** Weight in kilograms; omitted for bodyweight and assisted work */
  weight?: number;
  /** Duration in seconds, for timed exercises */
  duration?: number;
}

export interface StravaUploadParams {
  name: string;
  description?: string;
  /** Idempotency key; Strava rejects a repeat upload as a duplicate */
  externalId: string;
  /** ISO 8601 UTC timestamp, e.g. "2026-08-12T10:34:28Z" */
  startTime: string;
  /** Athlete's local UTC offset in seconds, e.g. -14400 for EDT */
  utcOffset: number;
  /** Total duration in seconds */
  elapsedTime: number;
  sets: StravaSet[];
}

/** Strava's upload status object, polled until `activity_id` or `error` is set. */
interface StravaUploadStatus {
  id: number;
  external_id?: string;
  status?: string;
  error?: string | null;
  activity_id?: number | null;
}

export class StravaConflictError extends Error {
  /** Id of the activity the upload duplicated, when Strava reports one */
  readonly activityId?: string;

  constructor(activityId?: string) {
    super(
      activityId
        ? `Activity already exists in Strava (activity ${activityId})`
        : "Activity already exists in Strava"
    );
    this.name = "StravaConflictError";
    this.activityId = activityId;
  }
}

export class StravaClient {
  private static readonly BASE_URL = "https://www.strava.com/api/v3";
  private static readonly TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";

  private tokens: StravaTokens;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    tokens: StravaTokens,
    private readonly onTokensRefreshed: (tokens: StravaTokens) => void,
    options: { pollIntervalMs?: number; maxPollAttempts?: number } = {}
  ) {
    this.tokens = tokens;
    // Strava's mean processing time is under 2s; poll every second, give up at ~30s.
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxPollAttempts = options.maxPollAttempts ?? 30;
  }

  /** Build the authorization URL to start the OAuth flow */
  static authorizationUrl(clientId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:write",
    });
    return `https://www.strava.com/oauth/authorize?${params}`;
  }

  /** Exchange an authorization code for tokens (initial OAuth handshake) */
  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string
  ): Promise<StravaTokens> {
    const response = await fetch(StravaClient.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Strava token exchange failed ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };
  }

  private async refreshIfNeeded(): Promise<void> {
    // Refresh 60 seconds before expiry
    if (Date.now() / 1000 < this.tokens.expiresAt - 60) return;

    const response = await fetch(StravaClient.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Strava token refresh failed ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };

    this.onTokensRefreshed(this.tokens);
  }

  /**
   * Upload a strength workout with per-set data via the JSON upload format.
   *
   * Uploads are asynchronous: POST returns an upload id, which is polled until
   * Strava reports an activity id or an error. Resolves with the activity id.
   *
   * Throws StravaConflictError when Strava reports the upload as a duplicate,
   * which it determines from `external_id`.
   */
  async uploadWorkout(params: StravaUploadParams): Promise<number> {
    await this.refreshIfNeeded();

    const document = {
      version: "1.0",
      start_time: params.startTime,
      utc_offset: params.utcOffset,
      elapsed_time: params.elapsedTime,
      creator: { name: "liftosaur-sync" },
      sets: params.sets,
    };

    const form = new FormData();
    form.append(
      "file",
      new Blob([JSON.stringify(document)], { type: "application/json" }),
      `${params.externalId}.json`
    );
    form.append("data_type", "json");
    form.append("sport_type", "WeightTraining");
    form.append("external_id", params.externalId);
    form.append("name", params.name);
    if (params.description) form.append("description", params.description);

    const response = await fetch(`${StravaClient.BASE_URL}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Strava API error ${response.status}: ${await response.text()}`);
    }

    let status = (await response.json()) as StravaUploadStatus;

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const activityId = StravaClient.readUploadResult(status);
      if (activityId !== undefined) return activityId;

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      status = await this.getUploadStatus(status.id);
    }

    throw new Error(
      `Strava upload ${status.id} timed out after ${this.maxPollAttempts} polling attempts`
    );
  }

  private async getUploadStatus(uploadId: number): Promise<StravaUploadStatus> {
    const response = await fetch(`${StravaClient.BASE_URL}/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(
        `Strava API error ${response.status}: ${await response.text()}`
      );
    }

    return (await response.json()) as StravaUploadStatus;
  }

  /**
   * Inspect an upload status: returns the activity id once ready, undefined
   * while still processing, and throws when the upload failed.
   */
  private static readUploadResult(status: StravaUploadStatus): number | undefined {
    if (status.error) {
      const duplicate = /duplicate of activity (\d+)/i.exec(status.error);
      if (duplicate) throw new StravaConflictError(duplicate[1]);
      throw new Error(`Strava upload failed: ${status.error}`);
    }

    return status.activity_id ?? undefined;
  }

  getTokens(): StravaTokens {
    return this.tokens;
  }
}
