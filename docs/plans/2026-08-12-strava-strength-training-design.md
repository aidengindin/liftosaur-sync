# Strava Strength Training Support — Design

Date: 2026-08-12

## Background

On 2026-05-21 Strava added structured strength training to its API:

- `set` message support for FIT uploads (exercise type, repetitions, weight, duration, start time).
- A JSON upload format, limited to `WeightTraining`, `HighIntensityIntervalTraining`,
  `Workout`, and `Crossfit` activities.

This data feeds Strava's strength log, muscle maps, and volume totals. There is still no
public endpoint to *read* sets back, so the integration is write-only.

Today `syncToStrava` posts a manual activity to `POST /activities` with only a name,
description, and duration. Strava shows the workout but knows nothing about the lifts.

## Goals

Send per-set exercise data to Strava so workouts appear in the strength log with correct
sets, reps, weights, and muscle maps.

## Decisions

| Decision | Choice |
| --- | --- |
| Manual activity vs. upload | Replace `POST /activities` entirely with `POST /uploads` |
| Exercise mapping | Curated `(name, equipment)` table with generic fallbacks |
| Unmapped exercise | Warn and fall back; drop the set only as a last resort |
| Warmup sets | Included in `sets[]` |
| Name/description | Preserved on the upload |
| Weight ≤ 0 (bodyweight, assisted) | Omit `weight`, keep `repetitions` |
| Bilateral sets (`2x6\|6`) | One Strava set per side |
| Multi-group tonnage bug | Fixed |

## Upload flow

`activity:write` already covers uploads, so no OAuth change and no re-auth.

1. Build the JSON document from the record.
2. `POST /api/v3/uploads` as `multipart/form-data`:
   `file` (JSON blob), `data_type=json`, `sport_type=WeightTraining`,
   `name`, `description`, `external_id`.
3. Poll `GET /api/v3/uploads/:id` at ~1s intervals until `activity_id` is populated or
   `error` is set. Cap at ~30s, then treat as an error.

`external_id` is `liftosaur-<record.id>`, which becomes the idempotency key. Strava dedups
on it and returns `error: "... duplicate of activity 21234316"`. Detecting that string and
extracting the id replaces today's 409 path — and is strictly better, because
`db.markSynced` records the real activity id instead of the `"conflict"` sentinel.

### Document shape

```json
{
  "version": "1.0",
  "start_time": "2026-08-12T10:34:28Z",
  "utc_offset": -14400,
  "elapsed_time": 2883,
  "creator": { "name": "liftosaur-sync" },
  "sets": [
    { "exercise_type": "BARBELL_SHOULDER_PRESS", "repetitions": 5, "weight": 20.4 },
    { "exercise_type": "BARBELL_SHOULDER_PRESS", "repetitions": 8, "weight": 29.5 }
  ]
}
```

- `start_time` is the record's UTC timestamp.
- `utc_offset` is derived from the `TIMEZONE` config *at that date*, so DST is handled.
- `elapsed_time` comes from `record.duration`.
- No `streams` — we have no heart-rate or time-series data.
- `elapsed_time` is required and `sets` must be non-empty. A record with neither is
  skipped with a logged warning rather than uploaded with `0`.

## Parsing

`record.exercises` is currently always `[]` — nothing populates it. Add
`parseExercises(exercisesText): LiftosaurExercise[]` in `src/liftosaur.ts` and fill it.

It must handle, all confirmed against real history:

- `Name, Equipment` split (`Incline Bench Press, Dumbbell`).
- Multiple comma-separated set groups (`1x4 170lb, 1x5 170lb, 1x4 170lb`).
- Bilateral reps (`2x6|6 50lb`) → one set per side.
- Bodyweight (`1x8 0lb`) and assisted (`3x8 -15lb`) → no weight, reps preserved.
- Timed exercises recorded as reps (`Plank / 1x1 0lb`) → reps only; we have no duration.
- `warmup:` segments flagged `isWarmup: true`; `target:` segments dropped.
- Comment lines beginning with `//` skipped.
- Records with no `program`/`dayName`.

`calculateKgLifted` becomes a thin sum over this structure instead of carrying its own
regex. One parser, not two.

### Tonnage fix

The current `calculateKgLifted` reads only `segments[1]`, so for
`1x4 170lb, 1x5 170lb, 1x4 170lb` it counts the first group and silently drops the rest.
Multi-group sets are common in this history, so the fix raises tonnage — and therefore the
load sent to Intervals.icu — for affected workouts. Newly synced workouts will be scored
differently from already-synced ones. Accepted: the current number is simply wrong.

Note also that including warmups in `sets[]` means Strava's volume total will exceed the
kg figure reported to Intervals.icu for the same workout. Expected and accepted.

## Exercise mapping

`src/exercise-map.ts`, resolved in tiers:

1. Normalized `name|equipment` key → exact FIT enum
   (`incline bench press|dumbbell` → `INCLINE_DUMBBELL_BENCH_PRESS`).
2. Name alone → that movement's `*_GENERIC` enum.
3. Keyword inference (`press`/`squat`/`curl`/`row` → category generic).
4. Drop the set with a loud warning naming the exercise. If every set drops, skip the
   workout rather than upload an empty `sets[]`.

Tier 4 exists because FIT has no universal "other" enum — an invalid `exercise_type` fails
the entire upload. Every enum value written into the table must be verified against
Strava's supported-exercises list, not inferred from the naming pattern.

The table is seeded with the 33 distinct exercises in the current history:

Overhead Press, Deadlift, T Bar Row, Triceps Pushdown, Crunch (Leverage Machine), Squat,
Bench Press, Lat Pulldown, Bicep Curl (Leverage Machine / Cable), Lateral Raise (— / Cable),
Bent Over Row (Leverage Machine), Romanian Deadlift (Barbell), Bulgarian Split Squat,
Hip Thrust (— / Leverage Machine), Pull Up (— / Leverage Machine), Pallof Press,
Trap Bar Deadlift, Seated Row, Seated Calf Raise (Leverage Machine), Standing Calf Raise
(Leverage Machine), Incline Bench Press (Dumbbell), Face Pull, Single Leg Deadlift,
Bent Over One Arm Row, Plank, Side Plank, Ab Wheel, Seated Leg Curl, Triceps Extension
(Cable), Cable Crunch, Eccentric Psoas Loading, Hip Abductor (Cable),
Calf Press on Leg Press.

`Eccentric Psoas Loading` has no plausible FIT equivalent and is expected to hit tier 4.

## Testing

- `parseExercises` — table-driven over the real history strings above: bilateral,
  multi-group, negative weight, zero weight, comment lines, missing program.
- `exercise-map` — assert every exercise in the current history resolves to a
  non-fallback enum. This is the regression net when a new lift is added.
- Strava upload — mock `fetch` for the post-then-poll sequence: success,
  duplicate error, processing-then-ready, and timeout.
- `calculateKgLifted` — existing tests plus multi-group cases with corrected expectations.

## Out of scope

- Reading sets back from Strava (no endpoint exists).
- `streams` (heart rate, active time) — no source data.
- Per-set `start_time` and `duration` — Liftosaur records neither.
