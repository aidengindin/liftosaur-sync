import { describe, it, expect } from "vitest";
import { parseHistoryText } from "./liftosaur.js";

describe("parseHistoryText", () => {
  const FULL_TEXT = [
    '2026-03-20T03:58:12Z / program: "5/3/1" / dayName: "Squat Day" / week: 2 / dayInWeek: 1 / duration: 3600s / exercises: {',
    "  Squat, Barbell / 3x5 185lb / warmup: 1x5 95lb",
    "  Leg Press / 3x10 200lb",
    "}",
  ].join("\n");

  it("extracts timestamp from text", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.timestamp).toBe("2026-03-20T03:58:12Z");
  });

  it("extracts program name including slashes", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.program).toBe("5/3/1");
  });

  it("extracts dayName", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.dayName).toBe("Squat Day");
  });

  it("extracts week and dayInWeek", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.week).toBe(2);
    expect(r.dayInWeek).toBe(1);
  });

  it("extracts duration in seconds", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.duration).toBe(3600);
  });

  it("captures exercises block as exercisesText", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.exercisesText).toContain("Squat, Barbell");
    expect(r.exercisesText).toContain("Leg Press");
  });

  it("uses id as timestamp fallback when text has no timestamp", () => {
    const r = parseHistoryText(1774348292942, "/ program: \"test\" / exercises: {}");
    // id 1774348292942 ms → 2026-03-20T03:58:12.942Z
    expect(r.timestamp).toBe(new Date(1774348292942).toISOString());
  });

  it("handles record with no optional fields", () => {
    const r = parseHistoryText(1774348292942, "2026-03-20T03:58:12Z / exercises: {\n  Squat / 3x5\n}");
    expect(r.timestamp).toBe("2026-03-20T03:58:12Z");
    expect(r.program).toBeUndefined();
    expect(r.dayName).toBeUndefined();
    expect(r.week).toBeUndefined();
    expect(r.duration).toBeUndefined();
  });

  it("sets id as string", () => {
    const r = parseHistoryText(1774348292942, FULL_TEXT);
    expect(r.id).toBe("1774348292942");
  });

  it("handles real API timestamp format (space-separated with offset)", () => {
    const realText =
      '2026-03-24 10:31:32 +00:00 / program: "Ironman Maintenance" / dayName: "Day 1" / week: 1 / dayInWeek: 1 / duration: 2346s / exercises: {\n  Squat / 2x6 165lb\n}';
    const r = parseHistoryText(1774348292942, realText);
    expect(r.timestamp).toBe("2026-03-24 10:31:32 +00:00");
    expect(r.program).toBe("Ironman Maintenance");
    expect(r.duration).toBe(2346);
  });
});
