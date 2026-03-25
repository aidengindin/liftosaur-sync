import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function flagEnabled(name: string, defaultValue: boolean): boolean {
  const val = process.env[name];
  if (val === undefined) return defaultValue;
  return val.toLowerCase() !== "false" && val !== "0";
}

export const config = {
  liftosaur: {
    apiKey: required("LIFTOSAUR_API_KEY"),
  },
  intervals: {
    enabled:
      flagEnabled("INTERVALS_ENABLED", true) &&
      !!(process.env.INTERVALS_API_KEY && process.env.INTERVALS_ATHLETE_ID),
    apiKey: process.env.INTERVALS_API_KEY ?? "",
    athleteId: process.env.INTERVALS_ATHLETE_ID ?? "",
  },
  strava: {
    enabled:
      flagEnabled("STRAVA_ENABLED", true) &&
      !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
    clientId: process.env.STRAVA_CLIENT_ID ?? "",
    clientSecret: process.env.STRAVA_CLIENT_SECRET ?? "",
  },
  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    baseUrl: optional("BASE_URL", "http://localhost:3000"),
    /** Secret token to protect the /sync and /status endpoints. Optional but recommended. */
    syncSecret: optional("SYNC_SECRET", ""),
  },
  db: {
    path: optional("DB_PATH", "sync-state.db"),
  },
};
