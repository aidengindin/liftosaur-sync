import { describe, it, expect } from "vitest";
import { parseExercises } from "./liftosaur.js";

describe("parseExercises", () => {
  it("parses a single work set group", () => {
    const r = parseExercises("Squat / 3x8 120lb");
    expect(r).toEqual([
      {
        name: "Squat",
        sets: [
          { reps: 8, weight: 120, unit: "lb" },
          { reps: 8, weight: 120, unit: "lb" },
          { reps: 8, weight: 120, unit: "lb" },
        ],
      },
    ]);
  });

  it("splits name and equipment on the comma", () => {
    const r = parseExercises("Incline Bench Press, Dumbbell / 1x6 50lb");
    expect(r[0].name).toBe("Incline Bench Press");
    expect(r[0].equipment).toBe("Dumbbell");
  });

  it("parses multiple comma-separated set groups", () => {
    const r = parseExercises("Squat / 1x4 170lb, 1x5 170lb, 1x4 170lb");
    expect(r[0].sets.map((s) => s.reps)).toEqual([4, 5, 4]);
  });

  it("expands bilateral sets into one set per side", () => {
    const r = parseExercises("Bulgarian Split Squat / 2x6|6 50lb");
    expect(r[0].sets).toEqual([
      { reps: 6, weight: 50, unit: "lb" },
      { reps: 6, weight: 50, unit: "lb" },
      { reps: 6, weight: 50, unit: "lb" },
      { reps: 6, weight: 50, unit: "lb" },
    ]);
  });

  it("marks warmup sets", () => {
    const r = parseExercises("Deadlift / 3x8 175lb / warmup: 1x5 45lb, 1x5 85lb");
    expect(r[0].sets.filter((s) => s.isWarmup).map((s) => s.weight)).toEqual([45, 85]);
    expect(r[0].sets.filter((s) => !s.isWarmup)).toHaveLength(3);
  });

  it("orders warmup sets before work sets, regardless of text order", () => {
    // Liftoscript lists warmups after the work sets, but they were performed first
    const r = parseExercises("Deadlift / 3x8 175lb / warmup: 1x5 45lb, 1x5 85lb");
    expect(r[0].sets.map((s) => [s.weight, s.isWarmup ?? false])).toEqual([
      [45, true],
      [85, true],
      [175, false],
      [175, false],
      [175, false],
    ]);
  });

  it("ignores target segments", () => {
    const r = parseExercises("Seated Row / 3x8 140lb / target: 3x8-10 135lb 90s");
    expect(r[0].sets).toHaveLength(3);
    expect(r[0].sets.every((s) => s.weight === 140)).toBe(true);
  });

  it("keeps bodyweight sets with zero weight", () => {
    const r = parseExercises("Pull Up / 1x8 0lb, 1x7 0lb");
    expect(r[0].sets).toEqual([
      { reps: 8, weight: 0, unit: "lb" },
      { reps: 7, weight: 0, unit: "lb" },
    ]);
  });

  it("keeps assisted sets with negative weight", () => {
    const r = parseExercises("Pull Up, Leverage Machine / 3x8 -15lb");
    expect(r[0].sets).toHaveLength(3);
    expect(r[0].sets[0].weight).toBe(-15);
  });

  it("parses fractional weights", () => {
    const r = parseExercises("Pallof Press / 2x10|10 42.5lb");
    expect(r[0].sets[0].weight).toBe(42.5);
  });

  it("skips comment lines", () => {
    const text = [
      "Trap Bar Deadlift / 3x5 225lb",
      "// Work: hooks 10, safeties 15",
      "Bench Press / 3x6 115lb",
    ].join("\n");
    const r = parseExercises(text);
    expect(r.map((e) => e.name)).toEqual(["Trap Bar Deadlift", "Bench Press"]);
  });

  it("parses an exercise with no set data", () => {
    const r = parseExercises("Hip Thrust, Leverage Machine / 2x8 115lb");
    expect(r[0].sets).toHaveLength(2);
  });

  it("parses multiple exercises across lines", () => {
    const text = [
      "  Overhead Press / 3x8 65lb / warmup: 1x5 45lb / target: 3x8 65lb",
      "  T Bar Row / 2x15 55lb, 1x14 55lb / target: 3x15 55lb",
    ].join("\n");
    const r = parseExercises(text);
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe("Overhead Press");
    expect(r[0].sets).toHaveLength(4); // 3 work + 1 warmup
    expect(r[1].sets).toHaveLength(3);
  });

  it("returns an empty array for empty input", () => {
    expect(parseExercises("")).toEqual([]);
  });

  it("handles kg units", () => {
    const r = parseExercises("Squat / 1x5 100kg");
    expect(r[0].sets[0]).toEqual({ reps: 5, weight: 100, unit: "kg" });
  });
});
