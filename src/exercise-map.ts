/**
 * Maps Liftosaur exercise names to Strava `exercise_type` values.
 *
 * Keys are normalized as "name" or "name|equipment" (lowercased, trimmed).
 * An equipment-specific key wins over the bare name.
 *
 * Every value must appear in STRAVA_EXERCISE_TYPES — an invalid exercise_type
 * rejects the entire upload. exercise-map.test.ts enforces this.
 */
export const EXERCISE_MAP: Record<string, string> = {
  // Lower body
  squat: "BARBELL_BACK_SQUAT",
  "front squat": "BARBELL_FRONT_SQUAT",
  "bulgarian split squat": "DUMBBELL_BULGARIAN_SPLIT_SQUATS",
  "bulgarian split squat|barbell": "BARBELL_BULGARIAN_SPLIT_SQUAT",
  "leg press": "MACHINE_LEG_PRESS",
  "seated leg curl": "MACHINE_LEG_CURL_SEATED",
  "hip thrust": "BARBELL_HIP_THRUST",
  "hip thrust|leverage machine": "HIP_THRUST",
  "hip abductor": "STANDING_HIP_ABDUCTION",
  "hip abductor|cable": "STANDING_HIP_ABDUCTION",

  // Hinge
  deadlift: "BARBELL_DEADLIFT",
  "trap bar deadlift": "TRAP_BAR_DEADLIFT",
  "romanian deadlift": "BARBELL_ROMANIAN_DEADLIFT",
  "romanian deadlift|barbell": "BARBELL_ROMANIAN_DEADLIFT",
  "romanian deadlift|dumbbell": "DUMBBELL_ROMANIAN_DEADLIFTS",
  "single leg deadlift": "SINGLE_LEG_ROMANIAN_DEADLIFTS",
  "sumo deadlift": "SUMO_DEADLIFT",

  // Calves
  "seated calf raise": "SEATED_CALF_RAISE",
  "seated calf raise|leverage machine": "SEATED_CALF_RAISE",
  "standing calf raise": "STANDING_CALF_RAISE",
  "standing calf raise|leverage machine": "STANDING_CALF_RAISE",
  "calf press on leg press": "MACHINE_CALF_PRESS",

  // Horizontal press
  "bench press": "BARBELL_BENCH_PRESS",
  "bench press|barbell": "BARBELL_BENCH_PRESS",
  "bench press|dumbbell": "DUMBBELL_BENCH_PRESS",
  "incline bench press": "INCLINE_BARBELL_BENCH_PRESS",
  "incline bench press|barbell": "INCLINE_BARBELL_BENCH_PRESS",
  "incline bench press|dumbbell": "INCLINE_DUMBBELL_BENCH_PRESS",
  "chest press|leverage machine": "MACHINE_CHEST_PRESS",

  // Vertical press
  "overhead press": "OVERHEAD_BARBELL_PRESS",
  "overhead press|barbell": "OVERHEAD_BARBELL_PRESS",
  "overhead press|dumbbell": "OVERHEAD_DUMBBELL_PRESS",
  "shoulder press|dumbbell": "SEATED_DUMBBELL_SHOULDER_PRESS",
  "arnold press": "ARNOLD_PRESS",

  // Vertical pull
  "pull up": "PULL_UP_GENERIC",
  "pull up|leverage machine": "PULL_UP_GENERIC",
  "chin up": "ASSISTED_CHIN_UP",
  "lat pulldown": "LAT_PULLDOWN",
  "lat pulldown|cable": "LAT_PULLDOWN",

  // Horizontal pull
  "seated row": "SEATED_CABLE_ROW",
  "seated row|cable": "SEATED_CABLE_ROW",
  "seated row|leverage machine": "MACHINE_SEATED_ROW",
  "t bar row": "T_BAR_ROW",
  "bent over row": "BENT_OVER_ROW",
  "bent over row|barbell": "BENT_OVER_BARBELL_ROW",
  "bent over row|leverage machine": "BENT_OVER_ROW",
  "bent over one arm row": "DUMBBELL_ROW",
  "face pull": "FACE_PULL",

  // Shoulders
  "lateral raise": "LATERAL_RAISE_GENERIC",
  "lateral raise|cable": "CABLE_LATERAL_RAISE",
  "front raise": "FRONT_RAISE",

  // Arms
  "bicep curl": "CURL_GENERIC",
  "bicep curl|barbell": "BARBELL_BICEPS_CURL",
  "bicep curl|cable": "CABLE_BICEPS_CURL",
  "bicep curl|dumbbell": "STANDING_DUMBBELL_BICEPS_CURL",
  "bicep curl|leverage machine": "MACHINE_BICEP_CURL",
  "hammer curl": "DUMBBELL_HAMMER_CURL",
  "preacher curl": "EZ_BAR_PREACHER_CURL",
  "preacher curl|leverage machine": "PREACHER_CURL_MACHINE",
  "concentration curl": "CONCENTRATION_CURL",
  "triceps pushdown": "CABLE_TRICEPS_PUSHDOWN",
  "triceps pushdown|cable": "CABLE_TRICEPS_PUSHDOWN",
  "triceps extension": "TRICEPS_EXTENSION_GENERIC",
  "triceps extension|cable": "TRICEPS_EXTENSION_GENERIC",
  "triceps extension|dumbbell": "OVERHEAD_DUMBBELL_TRICEPS_EXTENSION",
  "triceps extension|leverage machine": "MACHINE_TRICEP_EXTENSION",

  // Core
  plank: "PLANK_GENERIC",
  "side plank": "SIDE_PLANK",
  "pallof press": "PALLOF_PRESS",
  "cable crunch": "CABLE_CRUNCH",
  crunch: "SIT_UP_GENERIC",
  "crunch|leverage machine": "AB_CRUNCH_MACHINE",
  "ab wheel": "AB_WHEEL_ROLLOUT",
  "hanging leg raise": "HANGING_LEG_RAISE",
  "back extension": "BACK_EXTENSION",
};

/**
 * Keyword → generic exercise type, tried when no explicit mapping exists.
 * Ordered most specific first, since the first substring match wins.
 */
const KEYWORD_FALLBACKS: Array<[string, string]> = [
  ["calf raise", "CALF_RAISE_GENERIC"],
  ["lateral raise", "LATERAL_RAISE_GENERIC"],
  ["leg raise", "LEG_RAISE_GENERIC"],
  ["hip raise", "HIP_RAISE_GENERIC"],
  ["bench press", "BENCH_PRESS_GENERIC"],
  ["shoulder press", "SHOULDER_PRESS_GENERIC"],
  ["overhead press", "SHOULDER_PRESS_GENERIC"],
  ["triceps extension", "TRICEPS_EXTENSION_GENERIC"],
  ["tricep extension", "TRICEPS_EXTENSION_GENERIC"],
  ["deadlift", "DEADLIFT_GENERIC"],
  ["leg curl", "LEG_CURL_GENERIC"],
  ["pull up", "PULL_UP_GENERIC"],
  ["pulldown", "LAT_PULLDOWN"],
  ["plank", "PLANK_GENERIC"],
  ["crunch", "SIT_UP_GENERIC"],
  ["squat", "SQUAT_GENERIC"],
  ["curl", "CURL_GENERIC"],
  ["row", "ROW_GENERIC"],
  ["press", "SHOULDER_PRESS_GENERIC"],
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve a Liftosaur exercise to a Strava `exercise_type`.
 *
 * Resolution order: equipment-specific mapping, then name-only mapping, then
 * keyword inference. Returns undefined when nothing matches, in which case the
 * caller should drop the set rather than send an invalid type.
 */
export function resolveExerciseType(name: string, equipment?: string): string | undefined {
  const key = normalize(name);

  if (equipment) {
    const withEquipment = EXERCISE_MAP[`${key}|${normalize(equipment)}`];
    if (withEquipment) return withEquipment;
  }

  const byName = EXERCISE_MAP[key];
  if (byName) return byName;

  for (const [keyword, type] of KEYWORD_FALLBACKS) {
    if (key.includes(keyword)) return type;
  }

  return undefined;
}
