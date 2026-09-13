# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ML web app that predicts, **ex-ante** (before the damage is known), both the economic damage (millions of pesos) **and the affected population** of a natural disaster in Mexico, plus a historical dashboard. Two parts:

- `backend/` — FastAPI service (Python 3.11) exposing a `/predict` endpoint and `/stats/*` endpoints for the dashboard.
- `frontend/` — React 19 + Vite SPA with two tabs: a predictor form and an interactive historical dashboard (cross-filtering charts + choropleth map of Mexico).

The trained models and the source data are the spine of the project:
- **`Base.xlsx`** (disaster events) and **`Poblacion_01.xlsx`** (INEGI state census 2000/2005/2010/2020) at the repo root are the sources of truth, read **only by `train_model_simple.py`**, never at API runtime.
- **`backend/app/artifacts/`** holds everything the API loads at startup, all produced by `train_model_simple.py`: two models (`model_danos.joblib` for damage, `model_poblacion.joblib` for affected population), the shared `preprocessor.joblib`, `poblacion_estatal.joblib` (a `{(Estado, Año): population}` lookup so the API can fill in state population at predict time), `metadata.json`, and `data.joblib` — a cleaned/normalized pandas DataFrame the dashboard endpoints aggregate over.
  Damage values are exposed over the API with **four** decimals, not two: the smallest non-zero
  damage in the dataset is 0.00047 million pesos and 76 events fall below 0.005, so rounding to two
  decimals silently moved them into the "no damage" bucket. **The API never reads the Excel**, so editing the source files requires retraining for changes to appear.

## Commands

### Backend (from `backend/`)
```powershell
.\.venv\Scripts\Activate.ps1          # activate the venv
pip install -r requirements.txt        # install deps
uvicorn app.main:app --reload --port 8001   # run API (frontend expects port 8001 locally)
python train_model_simple.py           # retrain model -> regenerates app/artifacts/
```
Interactive API docs at `http://127.0.0.1:8001/docs`. Health/diagnostics at `/health` (reports whether model, preprocessor, and stats loaded).

### Frontend (from `frontend/`)
```powershell
npm install        # .npmrc forces legacy-peer-deps (React 19 peer-dep conflicts)
npm run dev        # Vite dev server on :5173
npm run build      # production build
npm run lint       # eslint
npm run prueba:agregaciones   # tests the dashboard's filtering/aggregation (needs the API up)
npm run verify:geojson        # sanity-checks public/mexico.geojson
```
`VITE_API_URL` (in `frontend/.env`) points the SPA at the backend — `http://127.0.0.1:8001` locally.

`scripts/prueba-agregaciones.mjs` is the only automated test in the repo. It imports the pure
functions from `src/dashboard/agregaciones.js`, runs them against the **real** 3,958 events served
by `/stats/eventos`, and asserts against totals computed independently with pandas (668,035.68 M in
damages, 4,697 deaths, 32 states, 1,065 zero-damage events). It exits non-zero on failure, so it
works in CI. Point it elsewhere with
`VITE_API_URL=http://127.0.0.1:8002 npm run prueba:agregaciones`.

## Architecture and conventions you must know

**Spanish column names with accents are load-bearing.** The Excel columns, the model's input feature names, and the dashboard aggregations all use exact strings like `"Total de daños (millones de pesos)"`, `"Clasificación del fenómeno"`, `"Año"`. The prediction target is `"Total de daños (millones de pesos)"`. Don't rename or "fix" these casually — they're the contract between Excel, model, and API.

**The `/predict` request uses underscored field names that are remapped to spaced column names.** `PredictRequest` in `backend/app/main.py` accepts only **ex-ante** fields: `Año`, `Mes`, `Clasificación_del_fenómeno`, `Tipo_de_fenómeno`, `Estado`. `predict()` normalizes the state (`"Estado de México"→"México"`, `"CDMX"→"Ciudad de México"`), looks up the state population from `poblacion_estatal.joblib`, derives cyclical month features (`mes_sin`/`mes_cos`), then builds a DataFrame row with the *spaced* feature names the preprocessor was fit on. **Post-event columns (`Impacto humano`, `Daños a infraestructura`) are deliberately excluded — they are components of the target and would be leakage.** Any change to model inputs must stay in sync across: `FEATURES` in `train_model_simple.py`, `FEATURES` + `PredictRequest` in `main.py`, and the row dict in `predict()`.

**Targets are log-transformed.** Both models train on `np.log1p(y)`; the API inverts with `np.expm1(...)` and clamps to ≥ 0. Keep these paired. `/predict` returns both targets: `{"prediction": {"Total de daños (millones de pesos)": x, "Población afectada": y}}`.

**Models.** Two independent `HistGradientBoostingRegressor`s sharing one `ColumnTransformer` preprocessor (categorical one-hot encoded; numeric passthrough: `Año`, `mes_sin`, `mes_cos`, `Población estatal`). Defined entirely in `train_model_simple.py`. Honest metrics use a **temporal split** (train years <2020, test ≥2020); the served models are refit on all years. State population is interpolated from census years across 2000–2023.

**Training does all data loading, cleaning, and normalization; the API just consumes the result.** `train_model_simple.py` reads `Base.xlsx` (via `_read_excel_safe()`, which copies to a temp dir and falls back to `robocopy` for OneDrive/Windows file locks), cleans it, normalizes state names (split multi-state cells on `,` or ` y ` and take the first; alias `CDMX -> Ciudad de México`; drop the non-state `Varios Estados`), then writes the cleaned DataFrame to `data.joblib`. `main.py` loads that DataFrame into `stats_df` and the `/stats/*` endpoints aggregate over it. The frontend choropleth joins on the normalized state names, so changing them must stay aligned with `frontend/public/mexico.geojson`.

**Two filtering levels, one source.** Inside `train_model_simple.py`: `stats_data` uses a lax `dropna([target, "Año"])` and is what gets saved to `data.joblib` (the dashboard's dataset); `data` further applies the strict `dropna(input_cols)` and is used **only to train the model**. Don't collapse these — the dashboard intentionally keeps rows the model can't train on.

**Frontend data flow.** `frontend/src/api.js` handles `/predict`. The dashboard lives in
`frontend/src/dashboard/` and fetches exactly **two** endpoints on mount — `/stats/dimensiones`
(filter catalogs) and `/stats/eventos` (all 3,958 events, ~40 KB gzipped) — then does every filter
and aggregation in the browser. That is what makes clicking a state or dragging over the years
re-render the whole board with no network round-trip. The older aggregate endpoints
(`/stats/kpis`, `/stats/evolucion-anual`, …) still exist and still work, but the dashboard no longer
calls them. If the dataset ever grows by an order of magnitude, `/stats/eventos` has to go back to
aggregating server-side.

Module split: `datos.js` (fetch + CSV export), `agregaciones.js` (pure filter/aggregate functions —
the tested part), `tema.js` (palette, metrics, number formatting), `Controles.jsx` (filter bar),
`Graficas.jsx` (SVG charts), `Mapa.jsx` (choropleth), `Tabla.jsx` (sortable detail table), and
`DashboardHistorico.jsx` (composition + shared filter state).

**Every chart ignores its own filter dimension.** `filtrar(eventos, filtro, omitir)` takes an
`omitir` argument: the state ranking and the map pass `"estados"`, the phenomenon ranking `"tipos"`,
the seasonality chart `"meses"`, the classification split `"clasificaciones"`. Without this,
selecting "Ciclones" would leave the phenomenon chart with a single bar and the map with one shaded
state — charts that no longer compare anything. The year range is never omitted: it bounds the
period under study rather than being a category compared against its siblings. There are tests for
this.

**The dashboard has no mock data.** An earlier version seeded `MOCK_*` constants as initial state,
so invented numbers (1,842 events, $524,300 M) stayed on screen whenever the API was down, with only
a small error line to say so. It now shows a loading state, then either real data or an explicit
error naming `VITE_API_URL`.

The map renders from `frontend/public/mexico.geojson` and joins on the normalized state names, with
a four-entry bridge (`NOMBRES_GEO` in `Mapa.jsx`) for the geojson's long official names.

**CORS: explicit allowlist in production, any localhost port in dev.** Production origins go in
`ORIGENES_PRODUCCION` in `main.py` and must be added by hand (the deployed frontend is
`desastres-naturales-gamma.vercel.app`). `ORIGENES_DESARROLLO` is a regex matching any port on
`localhost`/`127.0.0.1`, because Vite silently moves to the next free port when 5173 is taken, and
pinning one port meant editing the backend every time that happened. The regex only opens the local
machine.

Responses are gzipped (`GZipMiddleware`, 1 KB threshold). Not cosmetic: it is what takes
`/stats/eventos` from ~354 KB to ~40 KB and makes shipping the whole dataset to the browser viable.

## Deployment notes
- `backend/runtime.txt` pins Python 3.11.9.
- Frontend is deployed on Vercel; the backend is hosted separately and the production `VITE_API_URL` must point at it.
- `.env` files and `backend/.venv/` are gitignored.
