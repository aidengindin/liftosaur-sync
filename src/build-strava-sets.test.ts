import { describe, it, expect, vi, afterEach } from "vitest";
import { buildStravaSets } from "./sync.js";
import { parseExercises } from "./liftosaur.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildStravaSets", () => {
  it("converts pounds to kilograms", () => {
    const sets = buildStravaSets(parseExercises("Squat / 1x8 120lb"));
    expect(sets).toEqual([
      { exercise_type: "BARBELL_BACK_SQUAT", repetitions: 8, weight: 54.4 },
    ]);
  });

  it("passes kilograms through unconverted", () => {
    const sets = buildStravaSets(parseExercises("Squat / 1x5 100kg"));
    expect(sets[0].weight).toBe(100);
  });

  it("includes warmup sets", () => {
    const sets = buildStravaSets(
      parseExercises("Deadlift / 1x8 175lb / warmup: 1x5 45lb")
    );
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.exercise_type === "BARBELL_DEADLIFT")).toBe(true);
  });

  it("omits weight for bodyweight sets", () => {
    const sets = buildStravaSets(parseExercises("Pull Up / 1x8 0lb"));
    expect(sets).toEqual([{ exercise_type: "PULL_UP_GENERIC", repetitions: 8 }]);
  });

  it("omits weight for assisted sets rather than sending a negative", () => {
    const sets = buildStravaSets(
      parseExercises("Pull Up, Leverage Machine / 1x8 -15lb")
    );
    expect(sets[0].weight).toBeUndefined();
    expect(sets[0].repetitions).toBe(8);
  });

  it("expands bilateral sets into one set per side", () => {
    const sets = buildStravaSets(parseExercises("Bulgarian Split Squat / 1x6|6 50lb"));
    expect(sets).toHaveLength(2);
    expect(sets[0].exercise_type).toBe("DUMBBELL_BULGARIAN_SPLIT_SQUATS");
  });

  it("drops sets for unmappable exercises and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sets = buildStravaSets(
      parseExercises("Eccentric Psoas Loading / 3x10 10lb\nSquat / 1x5 100kg")
    );

    expect(sets).toHaveLength(1);
    expect(sets[0].exercise_type).toBe("BARBELL_BACK_SQUAT");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Eccentric Psoas Loading"));
  });

  it("warns once per unmapped exercise, not once per set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildStravaSets(parseExercises("Eccentric Psoas Loading / 3x10 10lb"));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when no exercises map", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(buildStravaSets(parseExercises("Eccentric Psoas Loading / 3x10 10lb"))).toEqual(
      []
    );
  });
});
