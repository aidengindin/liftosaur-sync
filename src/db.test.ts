import { describe, it, expect, beforeEach } from "vitest";
import { SyncDatabase } from "./db.js";

describe("SyncDatabase.getAvgTonnageKg", () => {
  let db: SyncDatabase;

  beforeEach(() => {
    db = new SyncDatabase(":memory:");
  });

  it("returns undefined when no rows exist", () => {
    expect(db.getAvgTonnageKg(6)).toBeUndefined();
  });

  it("returns the average of intervals rows with tonnage in window", () => {
    db.markSynced("w1", "intervals", "i1", 1000);
    db.markSynced("w2", "intervals", "i2", 2000);
    const avg = db.getAvgTonnageKg(6);
    expect(avg).toBeCloseTo(1500, 1);
  });

  it("excludes strava rows from the average", () => {
    db.markSynced("w1", "intervals", "i1", 1000);
    db.markSynced("w1", "strava", "s1");
    const avg = db.getAvgTonnageKg(6);
    expect(avg).toBeCloseTo(1000, 1);
  });

  it("excludes rows with null tonnage", () => {
    db.markSynced("w1", "intervals", "i1");
    db.markSynced("w2", "intervals", "i2", 1000);
    const avg = db.getAvgTonnageKg(6);
    expect(avg).toBeCloseTo(1000, 1);
  });

  it("returns undefined when only rows outside the window exist", () => {
    db.markSynced("w1", "intervals", "i1", 1000);
    expect(db.getAvgTonnageKg(0)).toBeUndefined();
  });
});

describe("SyncDatabase.markSynced with tonnage", () => {
  let db: SyncDatabase;

  beforeEach(() => {
    db = new SyncDatabase(":memory:");
  });

  it("stores tonnage_kg when provided", () => {
    db.markSynced("w1", "intervals", "i1", 500);
    expect(db.getAvgTonnageKg(6)).toBeCloseTo(500, 1);
  });

  it("stores null when tonnage not provided (backward compat)", () => {
    db.markSynced("w1", "intervals", "i1");
    expect(db.getAvgTonnageKg(6)).toBeUndefined();
  });
});
