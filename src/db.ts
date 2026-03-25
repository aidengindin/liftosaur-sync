import Database from "better-sqlite3";
import path from "path";

export interface SyncRecord {
  liftosaur_id: string;
  intervals_event_id: number;
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
      CREATE TABLE IF NOT EXISTS synced_workouts (
        liftosaur_id    TEXT PRIMARY KEY,
        intervals_event_id INTEGER NOT NULL,
        synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sync_cursor (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_at  TEXT NOT NULL
      );
    `);
  }

  isSynced(liftosaurId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM synced_workouts WHERE liftosaur_id = ?")
      .get(liftosaurId);
    return row !== undefined;
  }

  markSynced(liftosaurId: string, intervalsEventId: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO synced_workouts (liftosaur_id, intervals_event_id, synced_at)
         VALUES (?, ?, datetime('now'))`
      )
      .run(liftosaurId, intervalsEventId);
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
      .prepare("SELECT * FROM synced_workouts ORDER BY synced_at DESC")
      .all() as SyncRecord[];
  }

  close(): void {
    this.db.close();
  }
}
