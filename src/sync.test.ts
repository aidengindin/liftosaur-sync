import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncWorkouts } from "./sync.js";
import { SyncDatabase } from "./db.js";
import { LiftosaurClient, parseExercises } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";
import { StravaClient, StravaConflictError } from "./strava.js";

// Minimal workout record for tests
const WORKOUT = {
  id: "w1",
  timestamp: "2026-03-27T10:00:00Z",
  exercisesText: "Squat / 3x5 100kg",
  exercises: parseExercises("Squat / 3x5 100kg"),
  duration: 3600,
  program: "Test",
  dayName: "Day 1",
  week: 1,
  dayInWeek: 1,
};

function makeMocks() {
  const db = new SyncDatabase(":memory:");
  const liftosaur = { getAllHistory: vi.fn().mockResolvedValue([WORKOUT]) } as unknown as LiftosaurClient;
  const capturedActivities: unknown[] = [];
  const intervals = {
    createActivity: vi.fn().mockImplementation((a) => {
      capturedActivities.push(a);
      return Promise.resolve({ id: 999 });
    }),
  } as unknown as IntervalsClient;
  return { db, liftosaur, intervals, capturedActivities };
}

describe("syncWorkouts — load calculation", () => {
  it("omits load when loadWindowWeeks is not set (feature disabled)", async () => {
    const { db, liftosaur, intervals, capturedActivities } = makeMocks();
    await syncWorkouts(liftosaur, { intervals }, db, {});
    const activity = capturedActivities[0] as Record<string, unknown>;
    expect(activity.load).toBeUndefined();
  });

  it("omits load when no prior history exists in window", async () => {
    const { db, liftosaur, intervals, capturedActivities } = makeMocks();
    await syncWorkouts(liftosaur, { intervals }, db, { loadWindowWeeks: 6 });
    const activity = capturedActivities[0] as Record<string, unknown>;
    expect(activity.load).toBeUndefined();
  });

  it("includes load when prior history exists", async () => {
    const { db, liftosaur, intervals, capturedActivities } = makeMocks();
    // Pre-populate DB with a prior workout's tonnage (1500 kg = avg baseline)
    db.markSynced("prior", "intervals", "i0", 1500);
    await syncWorkouts(liftosaur, { intervals }, db, { loadWindowWeeks: 6 });
    const activity = capturedActivities[0] as Record<string, unknown>;
    // Squat 3x5x100kg = 1500 kg; avg = 1500 kg → load = round((1500/1500)*50) = 50
    expect(activity.load).toBe(50);
  });

  it("always stores tonnage in db even when load is not computed", async () => {
    const { db, liftosaur, intervals } = makeMocks();
    await syncWorkouts(liftosaur, { intervals }, db, {});
    // After sync, the workout's tonnage should be queryable for future averages
    const avg = db.getAvgTonnageKg(6);
    // Squat 3x5x100kg = 1500 kg
    expect(avg).toBeCloseTo(1500, 0);
  });
});

describe("syncWorkouts — local timestamps", () => {
  it("sends timezone-converted timestamps to Intervals.icu and Strava", async () => {
    const db = new SyncDatabase(":memory:");
    const liftosaur = {
      getAllHistory: vi.fn().mockResolvedValue([WORKOUT]),
    } as unknown as LiftosaurClient;
    const intervals = {
      createActivity: vi.fn().mockResolvedValue({ id: 999 }),
    } as unknown as IntervalsClient;
    const strava = {
      uploadWorkout: vi.fn().mockResolvedValue(1000),
    } as unknown as StravaClient;

    await syncWorkouts(liftosaur, { intervals, strava }, db, {
      timezone: "America/New_York",
    });

    expect(intervals.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ start_date_local: "2026-03-27T06:00:00" })
    );
    // Strava takes a UTC instant plus the athlete's offset, rather than a local time
    expect(strava.uploadWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: "2026-03-27T10:00:00.000Z",
        utcOffset: -4 * 3600,
      })
    );
  });
});

describe("syncWorkouts — Strava strength upload", () => {
  it("uploads per-set data keyed by an idempotent external id", async () => {
    const db = new SyncDatabase(":memory:");
    const liftosaur = {
      getAllHistory: vi.fn().mockResolvedValue([WORKOUT]),
    } as unknown as LiftosaurClient;
    const strava = {
      uploadWorkout: vi.fn().mockResolvedValue(1000),
    } as unknown as StravaClient;

    await syncWorkouts(liftosaur, { strava }, db, {});

    const params = (strava.uploadWorkout as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.externalId).toBe("liftosaur-w1");
    expect(params.elapsedTime).toBe(3600);
    expect(params.sets).toEqual([
      { exercise_type: "BARBELL_BACK_SQUAT", repetitions: 5, weight: 100 },
      { exercise_type: "BARBELL_BACK_SQUAT", repetitions: 5, weight: 100 },
      { exercise_type: "BARBELL_BACK_SQUAT", repetitions: 5, weight: 100 },
    ]);
    expect(db.isSynced("w1", "strava")).toBe(true);
  });

  it("records the real activity id when Strava reports a duplicate", async () => {
    const db = new SyncDatabase(":memory:");
    const liftosaur = {
      getAllHistory: vi.fn().mockResolvedValue([WORKOUT]),
    } as unknown as LiftosaurClient;
    const strava = {
      uploadWorkout: vi.fn().mockRejectedValue(new StravaConflictError("21234316")),
    } as unknown as StravaClient;

    const result = await syncWorkouts(liftosaur, { strava }, db, {});

    expect(result.errors).toEqual([]);
    expect(db.isSynced("w1", "strava")).toBe(true);
  });

  it("skips the upload when no sets can be mapped", async () => {
    const db = new SyncDatabase(":memory:");
    const unmappable = {
      ...WORKOUT,
      exercisesText: "Eccentric Psoas Loading / 3x10 10lb",
      exercises: parseExercises("Eccentric Psoas Loading / 3x10 10lb"),
    };
    const liftosaur = {
      getAllHistory: vi.fn().mockResolvedValue([unmappable]),
    } as unknown as LiftosaurClient;
    const strava = {
      uploadWorkout: vi.fn(),
    } as unknown as StravaClient;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await syncWorkouts(liftosaur, { strava }, db, {});

    expect(strava.uploadWorkout).not.toHaveBeenCalled();
    expect(db.isSynced("w1", "strava")).toBe(false);
    vi.restoreAllMocks();
  });
});
