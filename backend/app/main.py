from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import numpy as np
import joblib
import json
import shutil
import tempfile
import subprocess

app = FastAPI(title="Impacto Desastres API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://desastres-naturales-gamma.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rutas de artefactos del modelo ──────────────────────────────
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
MODEL_PATH    = ARTIFACTS_DIR / "model.joblib"
PREP_PATH     = ARTIFACTS_DIR / "preprocessor.joblib"
META_PATH     = ARTIFACTS_DIR / "metadata.json"

# ── Ruta al Excel de datos históricos ───────────────────────────
EXCEL_PATH = Path(__file__).resolve().parent.parent.parent / "Base.xlsx"

model        = None
preprocessor = None
target       = "Total de daños (millones de pesos)"
metadata     = {}

if MODEL_PATH.exists() and PREP_PATH.exists():
    model        = joblib.load(MODEL_PATH)
    preprocessor = joblib.load(PREP_PATH)
    if META_PATH.exists():
        metadata = json.loads(META_PATH.read_text(encoding="utf-8"))
        target   = metadata.get("target", target)

# ── Carga de datos históricos para el dashboard ─────────────────
stats_df = None

def _copy_excel():
    """Copia el Excel a un directorio temporal.
    Usa robocopy como fallback cuando OneDrive/Excel tiene el archivo bloqueado."""
    tmp_dir  = Path(tempfile.mkdtemp())
    tmp_file = tmp_dir / EXCEL_PATH.name
    try:
        shutil.copy2(EXCEL_PATH, tmp_file)
        return tmp_file
    except PermissionError:
        pass
    # Fallback: robocopy maneja archivos bloqueados en Windows
    subprocess.run(
        ["robocopy", str(EXCEL_PATH.parent), str(tmp_dir), EXCEL_PATH.name, "/R:0", "/W:0"],
        capture_output=True,
    )
    return tmp_file if tmp_file.exists() else None


def _load_stats():
    global stats_df
    if not EXCEL_PATH.exists():
        print(f"[stats] Excel no encontrado en {EXCEL_PATH}")
        return
    try:
        tmp = _copy_excel()
        if tmp is None:
            print("[stats] No se pudo copiar el Excel (archivo bloqueado).")
            return
        raw = pd.read_excel(tmp)
        tmp.unlink(missing_ok=True)
        raw.columns = [c.strip() for c in raw.columns]

        raw[target]                            = pd.to_numeric(raw[target],                            errors="coerce")
        raw["Año"]                             = pd.to_numeric(raw["Año"],                             errors="coerce")
        raw["Población afectada"]              = pd.to_numeric(raw["Población afectada"],              errors="coerce")
        raw["Defunciones"]                     = pd.to_numeric(raw["Defunciones"],                     errors="coerce")
        raw["Clasificación del fenómeno"]      = raw["Clasificación del fenómeno"].astype(str).str.strip()
        raw["Tipo de fenómeno"]                = raw["Tipo de fenómeno"].astype(str).str.strip()
        raw["Estado"]                          = raw["Estado"].astype(str).str.strip().str.split(",").str[0].str.strip()

        stats_df = raw.dropna(subset=[target, "Año"]).copy()
        stats_df = stats_df[stats_df[target] >= 0].copy()
        print(f"[stats] {len(stats_df)} filas cargadas desde Excel.")
    except Exception as e:
        print(f"[stats] Error al cargar Excel: {e}")

_load_stats()


# ════════════════════════════════════════════════════════════════
# ENDPOINTS GENERALES
# ════════════════════════════════════════════════════════════════

@app.get("/")
def root():
    return {"message": "API activa. Ve a /docs para probar endpoints."}


@app.get("/health")
def health():
    return {
        "status":               "ok",
        "model_loaded":         model is not None,
        "preprocessor_loaded":  preprocessor is not None,
        "stats_loaded":         stats_df is not None,
        "target":               target,
        "inputs":               metadata.get("inputs"),
        "metrics_test":         metadata.get("metrics_test"),
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT DE PREDICCIÓN
# ════════════════════════════════════════════════════════════════

class PredictRequest(BaseModel):
    Año: int
    Mes: int
    Clasificación_del_fenómeno: str
    Tipo_de_fenómeno: str
    Estado: str
    Impacto_humano: int
    Daños_a_infraestructura: int


@app.post("/predict")
def predict(req: PredictRequest):
    if model is None or preprocessor is None:
        return {
            "error": "Model o preprocessor no cargados",
            "hint": "Verifica que model.joblib y preprocessor.joblib estén en backend/app/artifacts/"
        }

    d   = req.dict()
    row = {
        "Año":                       d["Año"],
        "Mes":                       d["Mes"],
        "Clasificación del fenómeno": d["Clasificación_del_fenómeno"],
        "Tipo de fenómeno":           d["Tipo_de_fenómeno"],
        "Estado":                    d["Estado"].split(",")[0].strip(),
        "Impacto humano":            d["Impacto_humano"],
        "Daños a infraestructura":   d["Daños_a_infraestructura"],
    }

    df       = pd.DataFrame([row])
    X        = preprocessor.transform(df)
    if hasattr(X, "toarray"):
        X = X.toarray()

    pred_log   = model.predict(X)
    pred       = np.expm1(pred_log)
    prediction = float(max(pred[0], 0))

    return {"prediction": {target: prediction}}


# ════════════════════════════════════════════════════════════════
# ENDPOINTS DE ESTADÍSTICAS HISTÓRICAS (dashboard)
# ════════════════════════════════════════════════════════════════

def _no_data():
    return {"error": "Datos históricos no disponibles. Verifica la ruta del Excel."}


@app.get("/stats/kpis")
def stats_kpis():
    """KPIs superiores del dashboard."""
    if stats_df is None:
        return _no_data()

    total_pob = int(stats_df["Población afectada"].fillna(0).sum())

    return {
        "total_eventos":      int(len(stats_df)),
        "total_daños":        round(float(stats_df[target].sum()), 2),
        "poblacion_afectada": total_pob,
        "estados_afectados":  int(stats_df["Estado"].nunique()),
    }


@app.get("/stats/evolucion-anual")
def stats_evolucion():
    """Suma de daños por año para el gráfico de líneas."""
    if stats_df is None:
        return _no_data()

    df = (
        stats_df
        .groupby("Año")[target]
        .sum()
        .reset_index()
        .sort_values("Año")
    )
    return [
        {"año": int(r["Año"]), "daños": round(float(r[target]), 2)}
        for _, r in df.iterrows()
    ]


@app.get("/stats/top-estados")
def stats_top_estados(limit: int = 10):
    """Top N estados por daños económicos totales (barras horizontales)."""
    if stats_df is None:
        return _no_data()

    df = (
        stats_df
        .groupby("Estado")[target]
        .sum()
        .reset_index()
        .sort_values(target, ascending=False)
        .head(limit)
    )
    return [
        {"estado": r["Estado"], "daños": round(float(r[target]), 2)}
        for _, r in df.iterrows()
    ]


@app.get("/stats/por-estado")
def stats_por_estado():
    """Daños totales y población afectada por estado para el mapa coroplético."""
    if stats_df is None:
        return _no_data()

    df = (
        stats_df
        .groupby("Estado")
        .agg(
            daños=          (target,               "sum"),
            poblacion=      ("Población afectada", "sum"),
            total_eventos=  ("Año",                "count"),
        )
        .reset_index()
    )
    return [
        {
            "estado":         r["Estado"],
            "daños":          round(float(r["daños"]),     2),
            "poblacion":      int(r["poblacion"]),
            "total_eventos":  int(r["total_eventos"]),
        }
        for _, r in df.iterrows()
    ]


@app.get("/stats/clasificacion")
def stats_clasificacion():
    """Conteo de eventos por clasificación para el pastel."""
    if stats_df is None:
        return _no_data()

    col    = "Clasificación del fenómeno"
    counts = stats_df[col].value_counts()
    colors = {"Hidrometeorológico": "#3b82f6", "Geológico": "#f97316"}

    return [
        {
            "label": str(k),
            "value": int(v),
            "color": colors.get(str(k), "#6b7280"),
        }
        for k, v in counts.items()
    ]


@app.get("/stats/top-eventos")
def stats_top_eventos(limit: int = 10):
    """Eventos individuales más costosos para la tabla."""
    if stats_df is None:
        return _no_data()

    df = stats_df.sort_values(target, ascending=False).head(limit)
    return [
        {
            "año":    int(r["Año"]),
            "estado": r["Estado"],
            "tipo":   r["Tipo de fenómeno"],
            "daños":  round(float(r[target]), 2),
        }
        for _, r in df.iterrows()
    ]
