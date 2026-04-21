import fs from "fs/promises";
import os from "os";
import path from "path";
import { GarminConnect } from "garmin-connect";
import type { IOauth1Token, IOauth2Token } from "garmin-connect/dist/garmin/types";
import type { LiftosaurHistoryRecord } from "./liftosaur.js";
import type { GarminTokens } from "./db.js";
import { lookupExercise } from "./garmin-exercise-map.js";

export type { GarminTokens } from "./db.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class GarminConflictError extends Error {
  constructor(message = "Activity already exists in Garmin") {
    super(message);
    this.name = "GarminConflictError";
  }
}

// ---------------------------------------------------------------------------
// Internal FIT SDK types (resolved via dynamic import)
// ---------------------------------------------------------------------------

interface FitEncoder {
  onMesg(mesgNum: number, mesg: Record<string, unknown>): this;
  close(): Uint8Array;
}

interface FitProfile {
  MesgNum: Record<string, number>;
}

interface FitModule {
  Encoder: new () => FitEncoder;
  Profile: FitProfile;
}

// ---------------------------------------------------------------------------
// FIT file constants
// ---------------------------------------------------------------------------

// MesgNum values (hardcoded to avoid import issues at module load time)
const MESG_NUM = {
  FILE_ID: 0,
  ACTIVITY: 34,
  SESSION: 18,
  LAP: 19,
  SET: 225,
} as const;

const LB_TO_KG = 0.453592;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

interface ParsedSet {
  exerciseName: string;
  reps: number;
  weightKg: number;
  isWarmup: boolean;
}

/**
 * Parse a Liftoscript exercises block into individual sets.
 *
 * Each line has the form:
 *   ExerciseName, Equipment / NxM weightUnit / warmup: NxM weightUnit / target: NxM weightUnit
 *
 * Work sets appear as the second segment (index 1); warmup sets appear as
 * segments starting with "warmup:".  "target:" segments are skipped.
 */
function parseSets(exercisesText: string): ParsedSet[] {
  const result: ParsedSet[] = [];

  for (const line of exercisesText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const segments = trimmed.split(" / ");
    if (segments.length < 2) continue;

    // First segment is the exercise name (may include equipment after a comma)
    const exerciseName = segments[0].trim();

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i].trim();
      let isWarmup = false;
      let setDesc = seg;

      if (seg.startsWith("target:")) {
        // Skip target lines — they describe goals, not actual sets
        continue;
      }

      if (seg.startsWith("warmup:")) {
        isWarmup = true;
        setDesc = seg.slice("warmup:".length).trim();
      }

      // Parse "NxM weightUnit" where M may include "|" for bilateral (e.g. "10|10")
      // Also handle bodyweight/no weight ("Nxreps" with no weight)
      const m = setDesc.match(/^(\d+)x([\d|]+)\s+(\d+(?:\.\d+)?)(lb|kg)/);
      if (!m) continue;

      const numSets = parseInt(m[1], 10);
      // Bilateral rep notation: "10|10" = 20 total
      const reps = m[2].split("|").reduce((sum, n) => sum + parseInt(n, 10), 0);
      const weight = parseFloat(m[3]);
      const weightKg = m[4] === "lb" ? weight * LB_TO_KG : weight;

      for (let s = 0; s < numSets; s++) {
        result.push({ exerciseName, reps, weightKg, isWarmup });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// GarminClient
// ---------------------------------------------------------------------------

export class GarminClient {
  private credentials: { username: string; password: string } | null;
  private tokens: GarminTokens | null;
  private onTokensSaved: (t: GarminTokens) => void;

  constructor(
    credentials: { username: string; password: string } | null,
    tokens: GarminTokens | null,
    onTokensSaved: (t: GarminTokens) => void
  ) {
    this.credentials = credentials;
    this.tokens = tokens;
    this.onTokensSaved = onTokensSaved;
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  private async ensureLoggedIn(): Promise<GarminConnect> {
    // GarminConnect constructor requires a credentials object even when loading
    // tokens, so we pass a minimal placeholder when we only have tokens.
    const gc = new GarminConnect(
      this.credentials ?? { username: "", password: "" }
    );

    if (this.tokens !== null) {
      gc.loadToken(
        this.tokens.oauth1 as IOauth1Token,
        this.tokens.oauth2 as unknown as IOauth2Token
      );
    } else if (this.credentials !== null) {
      await gc.login(this.credentials.username, this.credentials.password);
      const exported = gc.exportToken();
      this.tokens = exported as unknown as GarminTokens;
      // Tokens are persisted once via the post-upload onTokensSaved call in uploadWorkout
    } else {
      throw new Error(
        "Garmin not authorized. Run: npm run sync -- --garmin-login"
      );
    }

    return gc;
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async uploadWorkout(record: LiftosaurHistoryRecord): Promise<void> {
    const gc = await this.ensureLoggedIn();
    await GarminClient.loadFitSdk();

    const fitData = this.buildFitFile(record);
    const tmpPath = path.join(os.tmpdir(), `liftosaur-${record.id}.fit`);

    try {
      await fs.writeFile(tmpPath, fitData);

      try {
        await gc.uploadActivity(tmpPath, "fit");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // garmin-connect wraps HTTP errors in Error messages; check for 409 text since status code is not directly accessible
        if (msg.includes("409") || msg.toLowerCase().includes("already exists")) {
          throw new GarminConflictError();
        }
        throw err;
      }

      // Persist any token refresh that may have occurred during the upload
      try {
        const exported = gc.exportToken();
        this.tokens = exported as unknown as GarminTokens;
        this.onTokensSaved(this.tokens);
      } catch {
        // Not fatal — tokens simply didn't change
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  // -------------------------------------------------------------------------
  // FIT file builder
  // -------------------------------------------------------------------------

  buildFitFile(record: LiftosaurHistoryRecord): Uint8Array {
    // The @garmin/fitsdk package is ESM-only.  buildFitFile() is synchronous;
    // callers MUST ensure GarminClient.loadFitSdk() has been awaited at startup
    // so that the module is cached in _fitModule before this method is called.
    const fitModule = GarminClient._fitModule;
    if (!fitModule) {
      throw new Error(
        "FIT SDK not loaded. Call await GarminClient.loadFitSdk() before buildFitFile()."
      );
    }

    return GarminClient._buildFitFileWithModule(fitModule, record);
  }

  // -------------------------------------------------------------------------
  // Pre-load the ESM FIT SDK (must be called once at startup, async)
  // -------------------------------------------------------------------------

  private static _fitModule: FitModule | null = null;

  static async loadFitSdk(): Promise<void> {
    if (GarminClient._fitModule) return;
    // Dynamic import is the only way to consume an ESM package from CJS
    GarminClient._fitModule = (await import("@garmin/fitsdk")) as unknown as FitModule;
  }

  // -------------------------------------------------------------------------
  // Internal: actually build the FIT bytes (separated so tests can inject sdk)
  // -------------------------------------------------------------------------

  static _buildFitFileWithModule(
    sdk: FitModule,
    record: LiftosaurHistoryRecord
  ): Uint8Array {
    const { Encoder, Profile } = sdk;
    const encoder = new Encoder();

    const mesgNum = Profile.MesgNum;

    // Parse timestamps / duration
    const startDate = new Date(record.timestamp);
    const sets = record.exercisesText ? parseSets(record.exercisesText) : [];

    // Estimate total duration from sets if record.duration is absent
    const estimatedDurationSecs =
      record.duration ??
      sets.reduce((sum, s) => sum + (s.isWarmup ? 30 : s.reps * 3), 0);

    const endDate = new Date(
      startDate.getTime() + estimatedDurationSecs * 1000
    );

    // A serial number derived from the last 8 digits of the Liftosaur ID
    const serialNumber = parseInt(String(record.id), 10) % 100_000_000;

    // 1. FILE_ID message
    encoder.onMesg(mesgNum.FILE_ID, {
      type: "activity",
      manufacturer: "development",
      product: 0,
      timeCreated: startDate,
      serialNumber,
    });

    // 2. SET messages — one per individual set, spaced 45 s apart
    let setTime = new Date(startDate.getTime());
    let messageIndex = 0;

    for (const s of sets) {
      const exercise = lookupExercise(s.exerciseName);
      // Duration estimate: warmup = 30 s, work = reps × 3 s
      const durationSecs = s.isWarmup ? 30 : s.reps * 3;

      encoder.onMesg(mesgNum.SET, {
        timestamp: setTime,
        startTime: setTime,
        // duration field has scale=1000 in FIT — pass value in seconds
        // and let the encoder apply the scale (1/1000 → stored as ms integer)
        duration: durationSecs,
        repetitions: s.reps,
        // weight field has scale=16 in FIT — pass kg value; encoder scales it
        weight: s.weightKg,
        // setType: "active" for all sets (FIT setType only has "rest"/"active")
        setType: "active",
        // category is exerciseCategory enum — pass the string
        category: [exercise.category],
        messageIndex: messageIndex++,
      });

      setTime = new Date(setTime.getTime() + durationSecs * 1000);
    }

    // 3. LAP message
    encoder.onMesg(mesgNum.LAP, {
      timestamp: endDate,
      startTime: startDate,
      totalElapsedTime: estimatedDurationSecs,
      totalTimerTime: estimatedDurationSecs,
      sport: "training",
      subSport: "strengthTraining",
      event: "lap",
      eventType: "stop",
    });

    // 4. SESSION message
    encoder.onMesg(mesgNum.SESSION, {
      timestamp: endDate,
      startTime: startDate,
      totalElapsedTime: estimatedDurationSecs,
      totalTimerTime: estimatedDurationSecs,
      sport: "training",
      subSport: "strengthTraining",
      numLaps: 1,
      firstLapIndex: 0,
      event: "session",
      eventType: "stop",
    });

    // 5. ACTIVITY message
    // localTimestamp must be a number (Unix seconds), not a Date — the FIT SDK
    // does not accept Date objects for this field.
    encoder.onMesg(mesgNum.ACTIVITY, {
      timestamp: endDate,
      totalTimerTime: estimatedDurationSecs,
      numSessions: 1,
      type: "manual",
      event: "activity",
      eventType: "stop",
      localTimestamp: Math.floor(startDate.getTime() / 1000),
    });

    return encoder.close();
  }

  // -------------------------------------------------------------------------
  // Static: login and return raw tokens (for --garmin-login CLI flow)
  // -------------------------------------------------------------------------

  static async loginAndSaveTokens(
    username: string,
    password: string
  ): Promise<GarminTokens> {
    const gc = new GarminConnect({ username, password });
    await gc.login(username, password);
    const exported = gc.exportToken();
    return exported as unknown as GarminTokens;
  }
}
