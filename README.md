# liftosaur-sync

Syncs completed workouts from [Liftosaur](https://www.liftosaur.com) to [Intervals.icu](https://intervals.icu) as `WeightTraining` calendar events.

## Setup

### 1. Get API keys

**Liftosaur** (requires premium):
- Open the app → Settings → API Keys → Create API Key
- The key starts with `lftsk_`

**Intervals.icu:**
- Log in → Settings → API Keys → Generate
- Find your **Athlete ID** in the URL after logging in (e.g. `i12345`)

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your keys
```

### 3. Install & build

```bash
npm install
npm run build
```

## Usage

### HTTP server (recommended for scheduled syncs)

```bash
npm start
```

Endpoints:

| Method | Path      | Description                             |
|--------|-----------|-----------------------------------------|
| GET    | /health   | Health check                            |
| GET    | /status   | View sync state and recent workouts     |
| POST   | /sync     | Trigger incremental sync                |
| POST   | /sync     | `{"full": true}` — re-sync everything  |

If `SYNC_SECRET` is set, pass it as `Authorization: Bearer <secret>` on `/sync` and `/status`.

**Example — trigger a sync:**
```bash
curl -X POST http://localhost:3000/sync \
  -H "Authorization: Bearer your_sync_secret"
```

**Automate with cron** (sync every hour):
```cron
0 * * * * curl -s -X POST http://localhost:3000/sync -H "Authorization: Bearer your_sync_secret"
```

### One-shot CLI

```bash
# Incremental (only new workouts)
npm run sync

# Full re-sync from the beginning
npm run sync -- --full
```

## How it works

1. Fetches workout history from the Liftosaur API (paginated, incremental by default).
2. For each workout not yet synced, creates a `WeightTraining` event on the Intervals.icu calendar with:
   - Workout name (program + day name)
   - Duration
   - Description with exercise breakdown
3. Records synced workout IDs in a local SQLite database (`sync-state.db`) to avoid duplicates.

## Development

```bash
npm run dev        # Run server with ts-node
npm run sync       # Run CLI with ts-node
```
