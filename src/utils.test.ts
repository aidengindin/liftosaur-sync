import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSince, toLocalDatetime, calculateKgLifted, calculateLoad } from "./utils.js";

describe("parseSince", () => {
  const FIXED_NOW = new Date("2026-03-25T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses days relative duration (7d)", () => {
    expect(parseSince("7d")).toBe("2026-03-18T12:00:00.000Z");
  });

  it("parses weeks relative duration (2w)", () => {
    expect(parseSince("2w")).toBe("2026-03-11T12:00:00.000Z");
  });

  it("parses months relative duration (1m)", () => {
    expect(parseSince("1m")).toBe("2026-02-25T12:00:00.000Z");
  });

  it("passes through ISO date string unchanged", () => {
    expect(parseSince("2026-03-18")).toBe("2026-03-18");
  });

  it("passes through ISO datetime string unchanged", () => {
    expect(parseSince("2026-03-18T00:00:00.000Z")).toBe("2026-03-18T00:00:00.000Z");
  });

  it("throws on unrecognized format", () => {
    expect(() => parseSince("badvalue")).toThrow(/unrecognized/i);
  });
});

describe("toLocalDatetime", () => {
  it("strips UTC Z suffix", () => {
    expect(toLocalDatetime("2026-03-20T03:58:12Z")).toBe("2026-03-20T03:58:12");
  });

  it("strips +00:00 offset and converts space to T", () => {
    expect(toLocalDatetime("2026-03-24 10:31:32 +00:00")).toBe("2026-03-24T10:31:32");
  });

  it("converts UTC to local time when timezone is provided", () => {
    // 10:31 UTC on 2026-03-24 = 06:31 EDT (UTC-4, DST active)
    expect(toLocalDatetime("2026-03-24 10:31:32 +00:00", "America/New_York")).toBe(
      "2026-03-24T06:31:32"
    );
  });
});

describe("calculateKgLifted", () => {
  const EXERCISES = [
    "Squat / 2x6 165lb / warmup: 1x5 45lb, 1x5 85lb, 1x5 135lb / target: 2x4-6 165lb 180s",
    "Trap Bar Deadlift / 2x5 255lb / warmup: 1x5 80lb, 1x5 130lb / target: 2x3-5 255lb 180s",
    "Pull Up / 2x8 0lb / target: 2x5-8 -10lb 90s",
    "Pallof Press / 2x10|10 45lb / target: 2x8-10 45lb 60s",
  ].join("\n");

  it("sums work sets only, skipping warmup and target", () => {
    // Squat: 2×6×165 lb + Deadlift: 2×5×255 lb + Pallof: 2×(10+10)×45 lb
    const lbTotal = 2 * 6 * 165 + 2 * 5 * 255 + 2 * 20 * 45;
    expect(calculateKgLifted(EXERCISES)).toBeCloseTo(lbTotal * 0.453592, 0);
  });

  it("skips bodyweight exercises (0 or negative weight)", () => {
    const result = calculateKgLifted("Pull Up / 2x8 0lb");
    expect(result).toBe(0);
  });

  it("handles kg units without conversion", () => {
    const result = calculateKgLifted("Squat / 3x5 100kg");
    expect(result).toBeCloseTo(3 * 5 * 100, 1);
  });
});

describe("calculateLoad", () => {
  it("returns 50 when session equals average", () => {
    expect(calculateLoad(1000, 1000)).toBe(50);
  });

  it("returns >50 for session above average", () => {
    // 4000 vs 3500 avg → round((4000/3500)*50) = round(57.14) = 57
    expect(calculateLoad(4000, 3500)).toBe(57);
  });

  it("returns <50 for session below average", () => {
    // 3000 vs 3500 avg → round((3000/3500)*50) = round(42.86) = 43
    expect(calculateLoad(3000, 3500)).toBe(43);
  });

  it("rounds to nearest integer", () => {
    // 1 vs 3 → round(16.666) = 17
    expect(calculateLoad(1, 3)).toBe(17);
  });

  it("throws when avgTonnageKg is zero", () => {
    expect(() => calculateLoad(1000, 0)).toThrow("avgTonnageKg must be > 0");
  });
});
