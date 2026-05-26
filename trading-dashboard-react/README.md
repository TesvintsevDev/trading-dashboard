# Trading Dashboard React

Local React/Vite dashboard for intraday US stocks workflow: premarket planning, post-open 5m structure checks, live watchlist, trade management, and ticker context.

The original Node/HTML MVP lives in [`legacy/trading-dashboard/`](legacy/trading-dashboard/) for reference (static `public/` UI + `server.js` on port 8788).

## Run

Frontend only, with static JSON fallback:

```bash
npm run dev
```

API + frontend:

```bash
npm run dev:full
```

The full dev command starts:

- API: `http://127.0.0.1:8787`
- Vite app: `http://127.0.0.1:5173`

## API

The API uses Node's built-in `node:sqlite` module and stores local data in `storage/trading-dashboard.sqlite`. The storage folder is ignored by git.

Endpoints:

- `GET /api/health`
- `GET /api/state`
- `GET /api/market/all`
- `GET /api/market/:symbol?tf=5m|daily`
- `POST /api/refresh/5m`
- `POST /api/refresh/daily`
- `POST /api/recalculate/setups`
- `POST /api/scan/premarket`
- `POST /api/import/movers`
- `GET /api/trades`
- `PUT /api/trades/:symbol`
- `DELETE /api/trades/:symbol`

`POST /api/refresh/5m` fetches current 5-minute bars from Yahoo Chart API for the current candidate list, writes them into SQLite, then recalculates setup statuses and alerts.

## Data Flow

On load, the React app first tries the API:

1. `GET /api/state`
2. `GET /api/market/all`

If the API is unavailable, it falls back to bundled `src/data/state.json` plus `public/data/market-data-2026-05-14.json`.

## Checks

```bash
npm run lint
npm run build
```

## Market Data Updater

Update all current candidate 5m bars from Yahoo:

```bash
npm run update:5m
```

Update selected symbols:

```bash
npm run update:5m -- POET RDW DOCS
```

The API endpoint `POST /api/refresh/5m` runs the same updater, writes bars into SQLite, then recalculates setup statuses and alerts.

## Premarket Scan

Run a backend scan for the configured universe in `config/premarket-universe.json`:

```bash
npm run scan:premarket
```

Run a small ad-hoc scan:

```bash
npm run scan:premarket -- POET RDW DOCS
```

The API endpoint `POST /api/scan/premarket` runs the scan, saves a new snapshot, replaces the current candidate list in SQLite, and recalculates setup statuses.

Import a manual movers list before scanning:

```bash
curl -X POST http://127.0.0.1:8787/api/import/movers \
  -H 'content-type: application/json' \
  -d '{"source":"manual","text":"POET RDW DOCS","catalystType":"news","dayDriver":"manual import"}'
```

You can also send richer rows:

```json
{
  "source": "manual",
  "movers": [
    {
      "symbol": "POET",
      "catalystType": "news",
      "dayDriver": "earnings/guidance",
      "note": "headline pasted from source"
    }
  ]
}
```

Restore the SQLite candidate list from the checked-in state file:

```bash
npm run seed:state
```
