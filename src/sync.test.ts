import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncWorkouts } from "./sync.js";
import { SyncDatabase } from "./db.js";
import { LiftosaurClient } from "./liftosaur.js";
import { IntervalsClient } from "./intervals.js";

// Minimal workout record for tests
const WORKOUT = {
  id: "w1",
  timestamp: "2026-03-27T10:00:00Z",
  exercisesText: "Squat / 3x5 100kg",
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
