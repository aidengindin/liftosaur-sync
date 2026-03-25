import Database from "better-sqlite3";
import path from "path";
import type { StravaTokens } from "./strava.js";

export interface SyncRecord {
  liftosaur_id: string;
  destination: string;
  destination_id: string;
  synced_at: string;
}

export class SyncDatabase {
  private db: Database.Database;

  constructor(dbPath: string = path.join(process.cwd(), "sync-state.db")) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      -- Unified sync tracking: one row per (workout, destination) pair
      CREATE TABLE IF NOT EXISTS synced_workouts (
        liftosaur_id    TEXT NOT NULL,
        destination     TEXT NOT NULL,
        destination_id  TEXT NOT NULL,
        synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (liftosaur_id, destination)
      );

      -- Tracks the timestamp of the most recently synced workout
      CREATE TABLE IF NOT EXISTS sync_cursor (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_at  TEXT NOT NULL
      );

      -- OAuth tokens for third-party services (e.g. Strava)
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        service         TEXT PRIMARY KEY,
        access_token    TEXT NOT NULL,
        refresh_token   TEXT NOT NULL,
        expires_at      INTEGER NOT NULL
      );
    `);

    // Migrate legacy schema (intervals_event_id column) if it exists
    const columns = (
      this.db.pragma("table_info(synced_workouts)") as Array<{ name: string }>
    ).map((c) => c.name);
    if (columns.includes("intervals_event_id") && !columns.includes("destination")) {
      this.db.exec(`
        ALTER TABLE synced_workouts RENAME TO synced_workouts_legacy;

        CREATE TABLE synced_workouts (
          liftosaur_id    TEXT NOT NULL,
          destination     TEXT NOT NULL,
          destination_id  TEXT NOT NULL,
          synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (liftosaur_id, destination)
        );

        INSERT INTO synced_workouts (liftosaur_id, destination, destination_id, synced_at)
        SELECT liftosaur_id, 'intervals', CAST(intervals_event_id AS TEXT), synced_at
        FROM synced_workouts_legacy;

        DROP TABLE synced_workouts_legacy;
      `);
    }
  }

  isSynced(liftosaurId: string, destination: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM synced_workouts WHERE liftosaur_id = ? AND destination = ?"
      )
      .get(liftosaurId, destination);
    return row !== undefined;
  }

  markSynced(
    liftosaurId: string,
    destination: string,
    destinationId: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO synced_workouts
           (liftosaur_id, destination, destination_id, synced_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(liftosaurId, destination, destinationId);
  }

  getLastSyncedAt(): string | undefined {
    const row = this.db
      .prepare("SELECT last_synced_at FROM sync_cursor WHERE id = 1")
      .get() as { last_synced_at: string } | undefined;
    return row?.last_synced_at;
  }

  setLastSyncedAt(timestamp: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_cursor (id, last_synced_at) VALUES (1, ?)`
      )
      .run(timestamp);
  }

  getSyncedWorkouts(): SyncRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM synced_workouts ORDER BY synced_at DESC"
      )
      .all() as SyncRecord[];
  }

  // ---------------------------------------------------------------------------
  // OAuth token management
  // ---------------------------------------------------------------------------

  getStravaTokens(): StravaTokens | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_tokens WHERE service = 'strava'")
      .get() as
      | { access_token: string; refresh_token: string; expires_at: number }
      | undefined;

    if (!row) return undefined;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
    };
  }

  saveStravaTokens(tokens: StravaTokens): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_tokens
           (service, access_token, refresh_token, expires_at)
         VALUES ('strava', ?, ?, ?)`
      )
      .run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
  }

  close(): void {
    this.db.close();
  }
}
