export interface GarminExerciseMapping {
  category: string; // e.g. "squat", "benchPress", "deadlift"
  name: string; // e.g. "barbellBackSquat", "barbellBenchPress"
}

const UNKNOWN: GarminExerciseMapping = { category: "unknown", name: "unknown" };

// Map from normalized exercise key → Garmin FIT SDK enum strings.
// Category values come from profile.js `exerciseCategory` enum.
// Name values come from the corresponding `<category>ExerciseName` enum.
const EXERCISE_MAP: Record<string, GarminExerciseMapping> = {
  // --- Squat family ---
  squat: { category: "squat", name: "barbellBackSquat" },
  "barbell squat": { category: "squat", name: "barbellBackSquat" },
  "back squat": { category: "squat", name: "barbellBackSquat" },
  "front squat": { category: "squat", name: "barbellFrontSquat" },
  "goblet squat": { category: "squat", name: "gobletSquat" },
  "bulgarian split squat": { category: "squat", name: "dumbbellSplitSquat" },
  "leg press": { category: "squat", name: "legPress" },

  // --- Hinge family ---
  deadlift: { category: "deadlift", name: "barbellDeadlift" },
  "romanian deadlift": { category: "deadlift", name: "romanianDeadlift" },
  rdl: { category: "deadlift", name: "romanianDeadlift" },
  "sumo deadlift": { category: "deadlift", name: "sumoDeadlift" },
  "hip thrust": { category: "hipRaise", name: "barbellHipThrustWithBench" },
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
  "military press": { category: "shoulderPress", name: "militaryPress" },
  "push press": { category: "shoulderPress", name: "barbellPushPress" },
  dips: { category: "tricepsExtension", name: "weightedDip" },
  "push up": { category: "pushUp", name: "pushUp" },
  pushup: { category: "pushUp", name: "pushUp" },

  // --- Pull family ---
  "pull up": { category: "pullUp", name: "pullUp" },
  pullup: { category: "pullUp", name: "pullUp" },
  "chin up": { category: "pullUp", name: "chinUp" },
  chinup: { category: "pullUp", name: "chinUp" },
  "barbell row": { category: "row", name: "barbellRow" },
  "bent over row": { category: "row", name: "bentOverRowWithBarbell" },
  "cable row": { category: "row", name: "seatedCableRow" },
  "lat pulldown": { category: "pullUp", name: "latPulldown" },

  // --- Arms ---
  "barbell curl": { category: "curl", name: "barbellBicepsCurl" },
  "dumbbell curl": { category: "curl", name: "dumbbellBicepsCurl" },
  "tricep pushdown": { category: "tricepsExtension", name: "tricepsPressdown" },
  // "skull crusher" — closest FIT name for a barbell skull crusher is lyingEzBarTricepsExtension
  "skull crusher": { category: "tricepsExtension", name: "lyingEzBarTricepsExtension" },
  // "overhead tricep extension" — seated barbell variant is the best FIT match
  "overhead tricep extension": { category: "tricepsExtension", name: "seatedBarbellOverheadTricepsExtension" },

  // --- Core ---
  plank: { category: "plank", name: "plank" },
  "ab wheel": { category: "core", name: "kneelingAbWheel" },
};

// Allowlist of equipment words that may appear after a comma in Liftosaur exercise names.
// Using an explicit list avoids accidentally stripping meaningful name parts.
const EQUIPMENT_SUFFIX =
  /,\s*(barbell|dumbbell|cable|bodyweight|machine|ez[\- ]bar|smith machine|kettlebell|resistance band|band|plate|trap bar|hex bar)$/i;

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

  // Strip ", <equipment>" suffix (Liftosaur format: "Bench Press, Barbell").
  // Only strips known equipment words to avoid accidentally removing meaningful parts.
  s = s.replace(EQUIPMENT_SUFFIX, "");

  // Strip parenthetical suffix: "Squat (Barbell)" → "squat"
  s = s.replace(/\s*\(.*?\)\s*$/, "");

  return s.trim();
}

/**
 * Look up a Garmin FIT exercise mapping for the given exercise name.
 *
 * The lookup tries:
 *  1. Exact normalized key
 *  2. Normalized key with trailing words progressively stripped — handles
 *     space-separated equipment qualifiers not caught by the comma/paren
 *     normalizations above (e.g. "Squat Barbell" → tries "squat barbell",
 *     then "squat").
 *
 * Returns { category: "unknown", name: "unknown" } for unrecognized exercises.
 */
export function lookupExercise(name: string): GarminExerciseMapping {
  const key = normalize(name);

  // Try exact normalized key first
  if (EXERCISE_MAP[key] !== undefined) {
    return EXERCISE_MAP[key];
  }

  // Progressively strip trailing words to handle space-separated equipment
  // qualifiers that were not caught by the comma/paren normalization above
  // (e.g. "Squat Barbell" → "squat").
  const parts = key.split(" ");
  for (let i = parts.length - 1; i > 0; i--) {
    const shorter = parts.slice(0, i).join(" ");
    if (EXERCISE_MAP[shorter] !== undefined) {
      return EXERCISE_MAP[shorter];
    }
  }

  return UNKNOWN;
}
