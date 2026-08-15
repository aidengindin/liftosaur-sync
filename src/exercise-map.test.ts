import { describe, it, expect } from "vitest";
import { EXERCISE_MAP, resolveExerciseType } from "./exercise-map.js";
import { STRAVA_EXERCISE_TYPES } from "./strava-exercise-types.js";

/** Every (name, equipment) pair appearing in the user's Liftosaur history. */
const HISTORY_EXERCISES: Array<[string, string?]> = [
  ["Squat"],
  ["Bench Press"],
  ["Overhead Press"],
  ["Deadlift"],
  ["Trap Bar Deadlift"],
  ["Romanian Deadlift", "Barbell"],
  ["Single Leg Deadlift"],
  ["Bulgarian Split Squat"],
  ["Hip Thrust"],
  ["Hip Thrust", "Leverage Machine"],
  ["Pull Up"],
  ["Pull Up", "Leverage Machine"],
  ["Lat Pulldown"],
  ["Seated Row"],
  ["T Bar Row"],
  ["Bent Over Row", "Leverage Machine"],
  ["Bent Over One Arm Row"],
  ["Face Pull"],
  ["Incline Bench Press", "Dumbbell"],
  ["Lateral Raise"],
  ["Lateral Raise", "Cable"],
  ["Bicep Curl", "Cable"],
  ["Bicep Curl", "Leverage Machine"],
  ["Triceps Pushdown"],
  ["Triceps Extension", "Cable"],
  ["Crunch", "Leverage Machine"],
  ["Cable Crunch"],
  ["Ab Wheel"],
  ["Plank"],
  ["Side Plank"],
  ["Pallof Press"],
  ["Seated Calf Raise", "Leverage Machine"],
  ["Standing Calf Raise", "Leverage Machine"],
  ["Calf Press on Leg Press"],
  ["Seated Leg Curl"],
  ["Hip Abductor", "Cable"],
  ["Preacher Curl", "Leverage Machine"],
];

/** True when the exercise has its own entry rather than a keyword-inferred type. */
function hasExplicitMapping(name: string, equipment?: string): boolean {
  const key = name.trim().toLowerCase();
  if (equipment && EXERCISE_MAP[`${key}|${equipment.trim().toLowerCase()}`]) return true;
  return EXERCISE_MAP[key] !== undefined;
}

describe("EXERCISE_MAP", () => {
  it("only contains exercise types Strava accepts", () => {
    const invalid = Object.entries(EXERCISE_MAP).filter(
      ([, type]) => !STRAVA_EXERCISE_TYPES.has(type)
    );
    expect(invalid).toEqual([]);
  });
});

describe("resolveExerciseType", () => {
  it("resolves every exercise in the sync history", () => {
    const unresolved = HISTORY_EXERCISES.filter(
      ([name, equipment]) => resolveExerciseType(name, equipment) === undefined
    );
    expect(unresolved).toEqual([]);
  });

  it("maps every exercise in the sync history explicitly, not by keyword inference", () => {
    // Keyword inference is a safety net for novel exercises; anything actually
    // performed deserves a specific type, or Strava shows a vague generic.
    const inferred = HISTORY_EXERCISES.filter(([name, equipment]) => !hasExplicitMapping(name, equipment));
    expect(inferred).toEqual([]);
  });

  it("prefers the equipment-specific mapping", () => {
    expect(resolveExerciseType("Incline Bench Press", "Dumbbell")).toBe(
      "INCLINE_DUMBBELL_BENCH_PRESS"
    );
    expect(resolveExerciseType("Bicep Curl", "Cable")).toBe("CABLE_BICEPS_CURL");
    expect(resolveExerciseType("Bicep Curl", "Leverage Machine")).toBe("MACHINE_BICEP_CURL");
  });

  it("falls back to the name-only mapping for unknown equipment", () => {
    expect(resolveExerciseType("Squat", "Smith Machine Nobody Mapped")).toBe(
      "BARBELL_BACK_SQUAT"
    );
  });

  it("infers a generic type from a movement keyword when unmapped", () => {
    expect(resolveExerciseType("Zercher Good Morning Squat")).toBe("SQUAT_GENERIC");
    expect(resolveExerciseType("Some Novel Row Variation")).toBe("ROW_GENERIC");
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveExerciseType("Eccentric Psoas Loading")).toBeUndefined();
  });

  it("is case and whitespace insensitive", () => {
    expect(resolveExerciseType("  squat  ")).toBe("BARBELL_BACK_SQUAT");
  });
});
