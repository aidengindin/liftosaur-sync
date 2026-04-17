export interface GarminExerciseMapping {
  category: string; // e.g. "squat", "benchPress", "deadlift"
  name: string; // e.g. "barbellSquat", "barbellBenchPress"
}

const UNKNOWN: GarminExerciseMapping = { category: "unknown", name: "unknown" };

// Map from normalized exercise key → Garmin FIT SDK enum strings
const EXERCISE_MAP: Record<string, GarminExerciseMapping> = {
  // --- Squat family ---
  squat: { category: "squat", name: "barbellSquat" },
  "barbell squat": { category: "squat", name: "barbellSquat" },
  "back squat": { category: "squat", name: "barbellSquat" },
  "front squat": { category: "squat", name: "frontSquat" },
  "goblet squat": { category: "squat", name: "gobletSquat" },
  "bulgarian split squat": { category: "squat", name: "bulgarianSplitSquat" },
  "leg press": { category: "legPress", name: "legPress" },

  // --- Hinge family ---
  deadlift: { category: "deadlift", name: "deadlift" },
  "romanian deadlift": { category: "deadlift", name: "romanianDeadlift" },
  rdl: { category: "deadlift", name: "romanianDeadlift" },
  "sumo deadlift": { category: "deadlift", name: "sumoDeadlift" },
  "hip thrust": { category: "hipSwing", name: "barbellHipThrust" },
  "good morning": { category: "deadlift", name: "goodMorning" },

  // --- Push family ---
  "bench press": { category: "benchPress", name: "barbellBenchPress" },
  "barbell bench press": { category: "benchPress", name: "barbellBenchPress" },
  "bench press barbell": { category: "benchPress", name: "barbellBenchPress" },
  "incline bench press": { category: "benchPress", name: "inclineBarbellBenchPress" },
  "dumbbell bench press": { category: "benchPress", name: "dumbbellBenchPress" },
  "overhead press": { category: "shoulderPress", name: "barbellShoulderPress" },
  "overhead press barbell": { category: "shoulderPress", name: "barbellShoulderPress" },
  ohp: { category: "shoulderPress", name: "barbellShoulderPress" },
  "military press": { category: "shoulderPress", name: "barbellShoulderPress" },
  "push press": { category: "shoulderPress", name: "pushPress" },
  dips: { category: "pushUp", name: "weightedDips" },
  "push up": { category: "pushUp", name: "pushUp" },
  pushup: { category: "pushUp", name: "pushUp" },

  // --- Pull family ---
  "pull up": { category: "pullUp", name: "pullUp" },
  pullup: { category: "pullUp", name: "pullUp" },
  "chin up": { category: "pullUp", name: "chinUp" },
  chinup: { category: "pullUp", name: "chinUp" },
  "barbell row": { category: "row", name: "barbellRow" },
  "bent over row": { category: "row", name: "bentOverRow" },
  "cable row": { category: "row", name: "cableRow" },
  "lat pulldown": { category: "latPullDown", name: "latPullDown" },

  // --- Arms ---
  "barbell curl": { category: "curl", name: "barbellCurl" },
  "dumbbell curl": { category: "curl", name: "dumbbellCurl" },
  "tricep pushdown": { category: "tricepsExtension", name: "tricepsExtension" },
  "skull crusher": { category: "tricepsExtension", name: "lyingBarbell" },
  "overhead tricep extension": { category: "tricepsExtension", name: "overheadBarbell" },

  // --- Core ---
  plank: { category: "plank", name: "plank" },
  "ab wheel": { category: "coreExercise", name: "abWheelRollout" },
};

/**
 * Normalize a raw exercise name from Liftosaur into a lookup key.
 *
 * Handles:
 *   "Squat, Barbell"   → "squat"   (strip ", Equipment" suffix)
 *   "Squat (Barbell)"  → "squat"   (strip parenthetical suffix)
 *   "Bench Press"      → "bench press"
 */
function normalize(raw: string): string {
  let s = raw.toLowerCase();

  // Strip ", equipment" suffix (Liftosaur format: "Bench Press, Barbell")
  s = s.replace(/,\s*\w+(\s+\w+)*$/, "");

  // Strip parenthetical suffix: "Squat (Barbell)" → "squat"
  s = s.replace(/\s*\(.*?\)\s*$/, "");

  return s.trim();
}

/**
 * Look up a Garmin FIT exercise mapping for the given exercise name.
 *
 * The lookup tries:
 *  1. Exact normalized key
 *  2. Normalized key with any trailing word(s) stripped (equipment qualifier)
 *
 * Returns { category: "unknown", name: "unknown" } for unrecognized exercises.
 */
export function lookupExercise(name: string): GarminExerciseMapping {
  const key = normalize(name);

  // Try exact normalized key first
  if (EXERCISE_MAP[key] !== undefined) {
    return EXERCISE_MAP[key];
  }

  // Try progressively stripping trailing words (handles "squat barbell" → "squat")
  const parts = key.split(" ");
  for (let i = parts.length - 1; i > 0; i--) {
    const shorter = parts.slice(0, i).join(" ");
    if (EXERCISE_MAP[shorter] !== undefined) {
      return EXERCISE_MAP[shorter];
    }
  }

  return UNKNOWN;
}
