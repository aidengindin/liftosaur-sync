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

export const config = {
  liftosaur: {
    apiKey: required("LIFTOSAUR_API_KEY"),
  },
  intervals: {
    apiKey: required("INTERVALS_API_KEY"),
    athleteId: required("INTERVALS_ATHLETE_ID"),
  },
  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    /** Secret token to protect the /sync endpoint. Optional but recommended. */
    syncSecret: optional("SYNC_SECRET", ""),
  },
  db: {
    path: optional("DB_PATH", "sync-state.db"),
  },
};
