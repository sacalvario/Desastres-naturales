# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ML web app that predicts, **ex-ante** (before the damage is known), both the economic damage (millions of pesos) **and the affected population** of a natural disaster in Mexico, plus a historical dashboard. Two parts:

- `backend/` — FastAPI service (Python 3.11) exposing a `/predict` endpoint and `/stats/*` endpoints for the dashboard.
- `frontend/` — React 19 + Vite SPA with two tabs: a predictor form and a historical dashboard (choropleth map of Mexico).

The trained models and the source data are the spine of the project:
- **`Base.xlsx`** (disaster events) and **`Poblacion_01.xlsx`** (INEGI state census 2000/2005/2010/2020) at the repo root are the sources of truth, read **only by `train_model_simple.py`**, never at API runtime.
- **`backend/app/artifacts/`** holds everything the API loads at startup, all produced by `train_model_simple.py`: two models (`model_danos.joblib` for damage, `model_poblacion.joblib` for affected population), the shared `preprocessor.joblib`, `poblacion_estatal.joblib` (a `{(Estado, Año): population}` lookup so the API can fill in state population at predict time), `metadata.json`, and `data.joblib` — a cleaned/normalized pandas DataFrame the dashboard endpoints aggregate over. **The API never reads the Excel**, so editing the source files requires retraining for changes to appear.

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
```
`VITE_API_URL` (in `frontend/.env`) points the SPA at the backend — `http://127.0.0.1:8001` locally. There is no test suite.

## Architecture and conventions you must know

**Spanish column names with accents are load-bearing.** The Excel columns, the model's input feature names, and the dashboard aggregations all use exact strings like `"Total de daños (millones de pesos)"`, `"Clasificación del fenómeno"`, `"Año"`. The prediction target is `"Total de daños (millones de pesos)"`. Don't rename or "fix" these casually — they're the contract between Excel, model, and API.

**The `/predict` request uses underscored field names that are remapped to spaced column names.** `PredictRequest` in `backend/app/main.py` accepts only **ex-ante** fields: `Año`, `Mes`, `Clasificación_del_fenómeno`, `Tipo_de_fenómeno`, `Estado`. `predict()` normalizes the state (`"Estado de México"→"México"`, `"CDMX"→"Ciudad de México"`), looks up the state population from `poblacion_estatal.joblib`, derives cyclical month features (`mes_sin`/`mes_cos`), then builds a DataFrame row with the *spaced* feature names the preprocessor was fit on. **Post-event columns (`Impacto humano`, `Daños a infraestructura`) are deliberately excluded — they are components of the target and would be leakage.** Any change to model inputs must stay in sync across: `FEATURES` in `train_model_simple.py`, `FEATURES` + `PredictRequest` in `main.py`, and the row dict in `predict()`.

**Targets are log-transformed.** Both models train on `np.log1p(y)`; the API inverts with `np.expm1(...)` and clamps to ≥ 0. Keep these paired. `/predict` returns both targets: `{"prediction": {"Total de daños (millones de pesos)": x, "Población afectada": y}}`.

**Models.** Two independent `HistGradientBoostingRegressor`s sharing one `ColumnTransformer` preprocessor (categorical one-hot encoded; numeric passthrough: `Año`, `mes_sin`, `mes_cos`, `Población estatal`). Defined entirely in `train_model_simple.py`. Honest metrics use a **temporal split** (train years <2020, test ≥2020); the served models are refit on all years. State population is interpolated from census years across 2000–2023.

**Training does all data loading, cleaning, and normalization; the API just consumes the result.** `train_model_simple.py` reads `Base.xlsx` (via `_read_excel_safe()`, which copies to a temp dir and falls back to `robocopy` for OneDrive/Windows file locks), cleans it, normalizes state names (split multi-state cells on `,` or ` y ` and take the first; alias `CDMX -> Ciudad de México`; drop the non-state `Varios Estados`), then writes the cleaned DataFrame to `data.joblib`. `main.py` loads that DataFrame into `stats_df` and the `/stats/*` endpoints aggregate over it. The frontend choropleth joins on the normalized state names, so changing them must stay aligned with `frontend/public/mexico.geojson`.

**Two filtering levels, one source.** Inside `train_model_simple.py`: `stats_data` uses a lax `dropna([target, "Año"])` and is what gets saved to `data.joblib` (the dashboard's dataset); `data` further applies the strict `dropna(input_cols)` and is used **only to train the model**. Don't collapse these — the dashboard intentionally keeps rows the model can't train on.

**Frontend data flow.** `frontend/src/api.js` handles `/predict`. `DashboardHistorico.jsx` fetches all `/stats/*` endpoints on mount; it still contains `MOCK_*` placeholder constants from earlier development — the live `fetchAll()` (near the bottom of the file) is what runs. The map renders from `frontend/public/mexico.geojson`.

**CORS is an explicit allowlist.** New frontend origins (e.g. a Vercel deployment) must be added to `allow_origins` in `main.py`. The deployed frontend is `desastres-naturales-gamma.vercel.app`.

## Deployment notes
- `backend/runtime.txt` pins Python 3.11.9.
- Frontend is deployed on Vercel; the backend is hosted separately and the production `VITE_API_URL` must point at it.
- `.env` files and `backend/.venv/` are gitignored.
