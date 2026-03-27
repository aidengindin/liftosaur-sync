# Friel Weight Training Load Calculation — Design

## Goal

Calculate a Training Stress Score (TSS) for each Liftosaur workout synced to Intervals.icu using Joe Friel's tonnage-based method, and send it as the `load` field on the activity.

## Method (Friel)

> TSS = (session_tonnage_kg / rolling_avg_tonnage_kg) × 50

- Average session tonnage = 50 TSS baseline (calibrated per athlete)
- Rolling average is computed from the past N weeks of synced workouts
- If no prior history exists in the window, `load` is omitted from the payload

Source: [The Weightlifting PMC, Part 2 — Joe Friel](https://joefrieltraining.com/the-weightlifting-pmc-part-2/)

---

## Data Model

Add one nullable column to the existing `synced_workouts` table:

```sql
ALTER TABLE synced_workouts ADD COLUMN tonnage_kg REAL;
```

- Written when destination = `'intervals'` and exercise text is present
- `NULL` for Strava rows and bodyweight-only workouts
- Rolling average query:

```sql
SELECT AVG(tonnage_kg)
FROM synced_workouts
WHERE destination = 'intervals'
  AND tonnage_kg IS NOT NULL AND tonnage_kg > 0
  AND synced_at >= datetime('now', '-N weeks')
```

The query runs **before** the current workout is written, so the session is never included in its own baseline.

---

## Config

| Env var | Type | Default | Description |
|---|---|---|---|
| `ENABLE_LOAD_CALCULATION` | `true`/`false` | unset (disabled) | Opt-in switch. Feature only runs when explicitly `true`. |
| `LOAD_WINDOW_WEEKS` | integer | `6` | Rolling window size in weeks. Only used when feature is enabled. |

Both vars parsed in `src/index.ts` and `src/cli.ts`, passed into `syncWorkouts()` via `options`:

```ts
options: {
  fullSync?: boolean;
  since?: string;
  timezone?: string;
  loadWindowWeeks?: number;   // present only when ENABLE_LOAD_CALCULATION=true
}
```

---

## Code Changes

### `src/utils.ts`
Add:
```ts
export function calculateLoad(tonnageKg: number, avgTonnageKg: number): number {
  return Math.round((tonnageKg / avgTonnageKg) * 50);
}
```

### `src/intervals.ts`
Add `load?: number` to `IntervalsActivity` interface.

### `src/db.ts`
- Migration: `ALTER TABLE synced_workouts ADD COLUMN tonnage_kg REAL` (guarded: only if column absent)
- New method: `getAvgTonnageKg(windowWeeks: number): number | undefined` — returns `undefined` if no rows
- `markSynced` gains optional `tonnageKg?: number` parameter, writes to column

### `src/sync.ts` — `syncToIntervals()`
1. Calculate `tonnageKg` (already done via `calculateKgLifted`)
2. If `options.loadWindowWeeks` set and `tonnageKg > 0`:
   - Call `db.getAvgTonnageKg(windowWeeks)`
   - If avg returned: compute `load = calculateLoad(tonnageKg, avg)`, add to payload
3. POST activity (with optional `load`)
4. Call `markSynced(..., tonnageKg)` — always store tonnage for future averaging, even if load wasn't computed this run

### `src/index.ts` + `src/cli.ts`
Parse `ENABLE_LOAD_CALCULATION` and `LOAD_WINDOW_WEEKS`, pass `loadWindowWeeks` into `syncWorkouts` options.

---

## Testing

| Area | File | What to test |
|---|---|---|
| `calculateLoad` | `src/utils.test.ts` | Correct formula, rounding, various tonnage ratios |
| `db.getAvgTonnageKg` | `src/db.test.ts` | Empty window → `undefined`; single row; respects window boundary; excludes Strava rows; excludes zero tonnage |
| `syncToIntervals` integration | `src/sync.test.ts` | Load omitted when disabled; load omitted when no history; load included when history exists; tonnage always stored |
