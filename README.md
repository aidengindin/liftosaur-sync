# liftosaur-sync

Syncs completed workouts from [Liftosaur](https://www.liftosaur.com) to [Intervals.icu](https://intervals.icu) and/or [Strava](https://www.strava.com) as `WeightTraining` activities.

Both destinations are optional — configure just one, or both.

## Setup

### 1. Get API credentials

**Liftosaur** (requires premium):
- Open the app → Settings → API Keys → Create API Key
- The key starts with `lftsk_`

**Intervals.icu** (optional):
- Log in → Settings → API Keys → Generate
- Find your **Athlete ID** in the URL after logging in (e.g. `i12345`)

**Strava** (optional):
- Create an app at https://www.strava.com/settings/api
- Set the **Authorization Callback Domain** to your server's hostname (or `localhost` for local use)
- Note the **Client ID** and **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Install & build

```bash
npm install
npm run build
```

### 4. Authorize Strava (first time only)

Start the server, then open your browser to authorize:

```bash
npm start
# Visit http://localhost:3000/auth/strava
# Approve access — tokens are saved to sync-state.db automatically
```

## Usage

### HTTP server (recommended)

```bash
npm start
```

| Method | Path                    | Description                                  |
|--------|-------------------------|----------------------------------------------|
| GET    | /health                 | Health check + destination status            |
| GET    | /status                 | View sync state and recent workouts          |
| POST   | /sync                   | Trigger incremental sync                     |
| POST   | /sync `{"full":true}`   | Re-sync all workouts from the beginning      |
| GET    | /auth/strava            | Start Strava OAuth flow                      |
| GET    | /auth/strava/callback   | OAuth callback (handled automatically)       |

If `SYNC_SECRET` is set, pass it as `Authorization: Bearer <secret>` on `/sync` and `/status`.

```bash
# Trigger a sync
curl -X POST http://localhost:3000/sync \
  -H "Authorization: Bearer your_sync_secret"
```

**Automate with cron** (sync every hour):
```cron
0 * * * * curl -s -X POST http://localhost:3000/sync -H "Authorization: Bearer your_sync_secret"
```

### One-shot CLI

```bash
npm run sync           # Incremental (only new workouts)
npm run sync -- --full # Full re-sync from the beginning
```

## How it works

1. Fetches workout history from the Liftosaur API (paginated, incremental by default).
2. For each workout not yet synced, creates a `WeightTraining` event on each configured destination:
   - **Intervals.icu** — calendar event via REST API (Basic auth)
   - **Strava** — manual activity via REST API (OAuth 2.0, tokens auto-refreshed)
3. Records synced workout IDs per-destination in a local SQLite database (`sync-state.db`) to avoid duplicates.

## Development

```bash
npm run dev        # Run server with ts-node
npm run sync       # Run CLI with ts-node
```
