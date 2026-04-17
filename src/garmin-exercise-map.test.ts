import { describe, it, expect } from "vitest";
import { lookupExercise } from "./garmin-exercise-map.js";

describe("lookupExercise", () => {
  describe("exact matches", () => {
    it("squat", () => {
      expect(lookupExercise("squat")).toEqual({ category: "squat", name: "barbellSquat" });
    });

    it("deadlift", () => {
      expect(lookupExercise("deadlift")).toEqual({ category: "deadlift", name: "deadlift" });
    });

    it("bench press", () => {
      expect(lookupExercise("bench press")).toEqual({ category: "benchPress", name: "barbellBenchPress" });
    });

    it("overhead press", () => {
      expect(lookupExercise("overhead press")).toEqual({ category: "shoulderPress", name: "barbellShoulderPress" });
    });

    it("pull up", () => {
      expect(lookupExercise("pull up")).toEqual({ category: "pullUp", name: "pullUp" });
    });

    it("romanian deadlift", () => {
      expect(lookupExercise("romanian deadlift")).toEqual({ category: "deadlift", name: "romanianDeadlift" });
    });

    it("rdl alias", () => {
      expect(lookupExercise("rdl")).toEqual({ category: "deadlift", name: "romanianDeadlift" });
    });

    it("ohp alias", () => {
      expect(lookupExercise("ohp")).toEqual({ category: "shoulderPress", name: "barbellShoulderPress" });
    });

    it("plank", () => {
      expect(lookupExercise("plank")).toEqual({ category: "plank", name: "plank" });
    });

    it("ab wheel", () => {
      expect(lookupExercise("ab wheel")).toEqual({ category: "coreExercise", name: "abWheelRollout" });
    });
  });

  describe("Liftosaur-style names with equipment suffix (comma format)", () => {
    it('Squat, Barbell → squat mapping', () => {
      expect(lookupExercise("Squat, Barbell")).toEqual({ category: "squat", name: "barbellSquat" });
    });

    it('Bench Press, Barbell → bench press mapping', () => {
      expect(lookupExercise("Bench Press, Barbell")).toEqual({ category: "benchPress", name: "barbellBenchPress" });
    });

    it('Deadlift, Barbell → deadlift mapping', () => {
      expect(lookupExercise("Deadlift, Barbell")).toEqual({ category: "deadlift", name: "deadlift" });
    });

    it('Overhead Press, Barbell → overhead press mapping', () => {
      expect(lookupExercise("Overhead Press, Barbell")).toEqual({ category: "shoulderPress", name: "barbellShoulderPress" });
    });

    it('Pull Up, Bodyweight → pull up mapping', () => {
      expect(lookupExercise("Pull Up, Bodyweight")).toEqual({ category: "pullUp", name: "pullUp" });
    });

    it('Romanian Deadlift, Barbell → romanian deadlift mapping', () => {
      expect(lookupExercise("Romanian Deadlift, Barbell")).toEqual({ category: "deadlift", name: "romanianDeadlift" });
    });

    it('Hip Thrust, Barbell → hip thrust mapping', () => {
      expect(lookupExercise("Hip Thrust, Barbell")).toEqual({ category: "hipSwing", name: "barbellHipThrust" });
    });

    it('Lat Pulldown, Cable → lat pulldown mapping', () => {
      expect(lookupExercise("Lat Pulldown, Cable")).toEqual({ category: "latPullDown", name: "latPullDown" });
    });
  });

  describe("names with parenthetical equipment", () => {
    it('Squat (Barbell) → squat mapping', () => {
      expect(lookupExercise("Squat (Barbell)")).toEqual({ category: "squat", name: "barbellSquat" });
    });

    it('Bench Press (Barbell) → bench press mapping', () => {
      expect(lookupExercise("Bench Press (Barbell)")).toEqual({ category: "benchPress", name: "barbellBenchPress" });
    });

    it('Deadlift (Barbell) → deadlift mapping', () => {
      expect(lookupExercise("Deadlift (Barbell)")).toEqual({ category: "deadlift", name: "deadlift" });
    });

    it('Overhead Press (Barbell) → overhead press mapping', () => {
      expect(lookupExercise("Overhead Press (Barbell)")).toEqual({ category: "shoulderPress", name: "barbellShoulderPress" });
    });
  });

  describe("case insensitivity", () => {
    it("SQUAT uppercase", () => {
      expect(lookupExercise("SQUAT")).toEqual({ category: "squat", name: "barbellSquat" });
    });

    it("Bench Press mixed case", () => {
      expect(lookupExercise("Bench Press")).toEqual({ category: "benchPress", name: "barbellBenchPress" });
    });

    it("DEADLIFT uppercase", () => {
      expect(lookupExercise("DEADLIFT")).toEqual({ category: "deadlift", name: "deadlift" });
    });

    it("Pull Up mixed case", () => {
      expect(lookupExercise("Pull Up")).toEqual({ category: "pullUp", name: "pullUp" });
    });
  });

  describe("fallback for unknown exercises", () => {
    it("unknown exercise returns unknown/unknown", () => {
      expect(lookupExercise("Zottman Curl")).toEqual({ category: "unknown", name: "unknown" });
    });

    it("empty string returns unknown/unknown", () => {
      expect(lookupExercise("")).toEqual({ category: "unknown", name: "unknown" });
    });

    it("gibberish returns unknown/unknown", () => {
      expect(lookupExercise("xyzzy foobar")).toEqual({ category: "unknown", name: "unknown" });
    });
  });

  describe("additional compound lifts", () => {
    it("front squat", () => {
      expect(lookupExercise("front squat")).toEqual({ category: "squat", name: "frontSquat" });
    });

    it("goblet squat", () => {
      expect(lookupExercise("goblet squat")).toEqual({ category: "squat", name: "gobletSquat" });
    });

    it("bulgarian split squat", () => {
      expect(lookupExercise("bulgarian split squat")).toEqual({ category: "squat", name: "bulgarianSplitSquat" });
    });

    it("leg press", () => {
      expect(lookupExercise("leg press")).toEqual({ category: "legPress", name: "legPress" });
    });

    it("sumo deadlift", () => {
      expect(lookupExercise("sumo deadlift")).toEqual({ category: "deadlift", name: "sumoDeadlift" });
    });

    it("good morning", () => {
      expect(lookupExercise("good morning")).toEqual({ category: "deadlift", name: "goodMorning" });
    });

    it("incline bench press", () => {
      expect(lookupExercise("incline bench press")).toEqual({ category: "benchPress", name: "inclineBarbellBenchPress" });
    });

    it("dumbbell bench press", () => {
      expect(lookupExercise("dumbbell bench press")).toEqual({ category: "benchPress", name: "dumbbellBenchPress" });
    });

    it("military press", () => {
      expect(lookupExercise("military press")).toEqual({ category: "shoulderPress", name: "barbellShoulderPress" });
    });

    it("push press", () => {
      expect(lookupExercise("push press")).toEqual({ category: "shoulderPress", name: "pushPress" });
    });

    it("dips", () => {
      expect(lookupExercise("dips")).toEqual({ category: "pushUp", name: "weightedDips" });
    });

    it("push up", () => {
      expect(lookupExercise("push up")).toEqual({ category: "pushUp", name: "pushUp" });
    });

    it("chin up", () => {
      expect(lookupExercise("chin up")).toEqual({ category: "pullUp", name: "chinUp" });
    });

    it("barbell row", () => {
      expect(lookupExercise("barbell row")).toEqual({ category: "row", name: "barbellRow" });
    });

    it("bent over row", () => {
      expect(lookupExercise("bent over row")).toEqual({ category: "row", name: "bentOverRow" });
    });

    it("cable row", () => {
      expect(lookupExercise("cable row")).toEqual({ category: "row", name: "cableRow" });
    });

    it("lat pulldown", () => {
      expect(lookupExercise("lat pulldown")).toEqual({ category: "latPullDown", name: "latPullDown" });
    });

    it("barbell curl", () => {
      expect(lookupExercise("barbell curl")).toEqual({ category: "curl", name: "barbellCurl" });
    });

    it("dumbbell curl", () => {
      expect(lookupExercise("dumbbell curl")).toEqual({ category: "curl", name: "dumbbellCurl" });
    });

    it("tricep pushdown", () => {
      expect(lookupExercise("tricep pushdown")).toEqual({ category: "tricepsExtension", name: "tricepsExtension" });
    });

    it("skull crusher", () => {
      expect(lookupExercise("skull crusher")).toEqual({ category: "tricepsExtension", name: "lyingBarbell" });
    });

    it("overhead tricep extension", () => {
      expect(lookupExercise("overhead tricep extension")).toEqual({ category: "tricepsExtension", name: "overheadBarbell" });
    });
  });
});
