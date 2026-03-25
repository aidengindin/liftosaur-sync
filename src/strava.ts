export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date_local: string;
}

export interface StravaCreateActivityParams {
  name: string;
  sport_type: string;
  /** ISO 8601 local datetime, e.g. "2026-03-01T10:00:00" */
  start_date_local: string;
  /** Duration in seconds */
  elapsed_time: number;
  description?: string;
  trainer?: boolean;
}

export class StravaConflictError extends Error {
  constructor() {
    super("Activity already exists in Strava");
    this.name = "StravaConflictError";
  }
}

export class StravaClient {
  private static readonly BASE_URL = "https://www.strava.com/api/v3";
  private static readonly TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";

  private tokens: StravaTokens;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    tokens: StravaTokens,
    private readonly onTokensRefreshed: (tokens: StravaTokens) => void
  ) {
    this.tokens = tokens;
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

  async createActivity(
    params: StravaCreateActivityParams
  ): Promise<StravaActivity> {
    await this.refreshIfNeeded();

    const response = await fetch(`${StravaClient.BASE_URL}/activities`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    const body = await response.text();

    if (response.status === 409) {
      throw new StravaConflictError();
    }

    if (!response.ok) {
      throw new Error(`Strava API error ${response.status}: ${body}`);
    }

    if (!body) {
      throw new Error(`Strava API returned empty response (status ${response.status})`);
    }

    return JSON.parse(body) as StravaActivity;
  }

  getTokens(): StravaTokens {
    return this.tokens;
  }
}
