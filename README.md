# GivexIndia on Node.js

Run from this directory with Node.js 22.16 or newer:

```sh
npm ci
npm start
```

The frontend is served on port 8766 by default. For hosting, set `HOST=0.0.0.0`, use the host's `PORT`, and set `GIVEX_DB_PATH` to the existing SQLite file on a persistent writable volume. Use one app instance per database and set `GIVEX_SECURE_COOKIE=1` when serving over HTTPS. Keep the SQLite file private, including any backups.

The Node server uses the existing SQLite schema and password hashes. To move the database between machines, take a consistent SQLite backup and place it at the configured path. If no path is configured, the app opens or creates `data/givex-prices.sqlite3`.

- `npm start -- --test` runs sample mode.
- `npm start -- --live` uses the existing Keepa and Flipkart environment variable names.
- `npm run refresh -- --limit 25` refreshes stored prices. In public page mode the server also schedules a refresh at 9 a.m. India time. Set `GIVEX_DAILY_REFRESH=0` if the host runs the refresh as a separate scheduled command.
- `npm run seed -- --pages 8` imports ranked products from the existing Amazon category sources.
- `npm run import-history -- history.csv --source "Provider" --check` validates a price history export. Remove `--check` to import.

No Python process is needed by these commands.

The React frontend lives in `frontend/src/`. Edit `App.jsx` for search and cards, `Product.jsx` for product details and history, `Alerts.jsx` for alerts, and `styles.css` for styling. The backend lives in `backend/src/`. The demo catalog is shared via `shared/sample-catalog.json`. The Node server builds and serves the frontend on startup. Restart it after changing these files.
