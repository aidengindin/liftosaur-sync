# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run all tests inside the Nix dev shell — use `nix develop --command npm test`. The native binary requires the Python build tools only available there.

```bash
nix develop --command npm test  # Run tests (required for db tests)
npm test                        # Run tests (vitest, works for non-db tests)
npm test -- --reporter=verbose  # Run tests with per-test output
npx vitest run src/utils.test.ts  # Run a single test file
npm run build                   # Compile TypeScript → dist/
npm run dev                     # Start HTTP server via ts-node (reads .env)
npm run sync -- --since 7d      # One-shot CLI sync (supports --full, --since <duration|date>)
nix run .                       # Run HTTP server via Nix
nix run .#sync -- --since 7d    # Run CLI sync via Nix
```

New source files must be `git add`ed before `nix build` will include them (Nix uses git-tracked files only).

## Architecture

The app syncs completed Liftosaur workouts to Intervals.icu and/or Strava. Two entry points share the same core sync logic:

- **`src/cli.ts`** — one-shot process, reads `.env`, calls `syncWorkouts`, exits
- **`src/index.ts`** — Express HTTP server with `POST /sync`, `GET /status`, `GET /health`, and Strava OAuth routes

### Core sync flow (`src/sync.ts`)

`syncWorkouts()` is the orchestrator. It:
1. Determines the fetch window (`fullSync` ignores cursor; `since` overrides it; otherwise uses `db.getLastSyncedAt()`)
2. Calls `liftosaurClient.getAllHistory(since)` to paginate the Liftosaur API
3. For each record, checks per-destination sync state in SQLite, then calls `syncToIntervals` or `syncToStrava`
4. After all records, advances `db.setLastSyncedAt()` to the latest timestamp seen

### Liftosaur API (`src/liftosaur.ts`)

The `/api/v1/history` endpoint returns `{ id: number, text: string }[]` — **not** structured JSON. The `text` field is Liftoscript Workouts format:

```
2026-03-24 10:31:32 +00:00 / program: "Name" / dayName: "Day 1" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: {
  Squat / 2x6 165lb / warmup: 1x5 45lb / target: 2x4-6 165lb 180s
}
```

`parseHistoryText()` extracts fields from this format using regex. The `id` field is `startTime` in milliseconds and doubles as a fallback timestamp. All timestamps from Liftosaur are UTC; `TIMEZONE` config converts them to local time for destination APIs.

### Destinations

- **Intervals.icu** (`src/intervals.ts`): HTTP Basic auth (`API_KEY:<key>`). Posts to `/activities/manual` (completed activity, not `/events` which is planned).
- **Strava** (`src/strava.ts`): OAuth 2.0, tokens stored in SQLite and auto-refreshed. 409 responses are treated as "already exists" and marked synced rather than errored.

### State (`src/db.ts`)

SQLite via `better-sqlite3`. Three tables:
- `synced_workouts` — `(liftosaur_id, destination)` primary key; prevents re-syncing
- `sync_cursor` — single row storing the timestamp of the last synced workout
- `oauth_tokens` — Strava refresh/access tokens

### Utilities (`src/utils.ts`)

- `parseSince(input)` — parses `--since` values: relative (`7d`, `2w`, `1m`) or ISO date passthrough
- `toLocalDatetime(isoString, timezone?)` — strips timezone suffix; with `timezone` converts UTC→local via `Intl.DateTimeFormat`
- `calculateKgLifted(exercisesText)` — sums work sets from Liftoscript format (lb→kg conversion, skips warmup/target lines and bodyweight)
- `formatSyncLabel(fullSync, since?)` — formats the sync mode for log output
