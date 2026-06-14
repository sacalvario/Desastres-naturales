from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import numpy as np
import joblib
import json

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
MODEL_DANOS_PATH = ARTIFACTS_DIR / "model_danos.joblib"
MODEL_POBL_PATH  = ARTIFACTS_DIR / "model_poblacion.joblib"
PREP_PATH        = ARTIFACTS_DIR / "preprocessor.joblib"
POBL_PATH        = ARTIFACTS_DIR / "poblacion_estatal.joblib"
META_PATH        = ARTIFACTS_DIR / "metadata.json"
DATA_PATH        = ARTIFACTS_DIR / "data.joblib"

# Targets que devuelve el predictor ex-ante
TARGET_DANOS = "Total de daños (millones de pesos)"
TARGET_POBL  = "Población afectada"

model_danos  = None
model_pobl   = None
preprocessor = None
poblacion    = None     # lookup {(Estado, Año): población estatal}
target       = TARGET_DANOS
metadata     = {}

# Features ex-ante en el orden que espera el preprocesador
FEATURES = ["Clasificación del fenómeno", "Tipo de fenómeno", "Estado",
            "Año", "mes_sin", "mes_cos", "Población estatal"]

# Normalización de estado: etiquetas del frontend -> nombres del modelo/censo
STATE_ALIASES = {"CDMX": "Ciudad de México", "Estado de México": "México"}

if MODEL_DANOS_PATH.exists() and PREP_PATH.exists():
    model_danos  = joblib.load(MODEL_DANOS_PATH)
    preprocessor = joblib.load(PREP_PATH)
    if MODEL_POBL_PATH.exists():
        model_pobl = joblib.load(MODEL_POBL_PATH)
    if POBL_PATH.exists():
        poblacion = joblib.load(POBL_PATH)
    if META_PATH.exists():
        metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

# ── Carga de datos históricos para el dashboard ─────────────────
# El DataFrame ya viene limpio y normalizado desde train_model_simple.py
# (guardado como data.joblib). No se lee el Excel en runtime.
stats_df = None
if DATA_PATH.exists():
    stats_df = joblib.load(DATA_PATH)
    print(f"[stats] {len(stats_df)} filas cargadas desde {DATA_PATH.name}.")
else:
    print(f"[stats] {DATA_PATH.name} no encontrado. Ejecuta train_model_simple.py para generarlo.")


# ════════════════════════════════════════════════════════════════
# ENDPOINTS GENERALES
# ════════════════════════════════════════════════════════════════

@app.get("/")
def root():
    return {"message": "API activa. Ve a /docs para probar endpoints."}


@app.get("/health")
def health():
    return {
        "status":                  "ok",
        "model_danos_loaded":      model_danos is not None,
        "model_poblacion_loaded":  model_pobl is not None,
        "preprocessor_loaded":     preprocessor is not None,
        "poblacion_loaded":        poblacion is not None,
        "stats_loaded":            stats_df is not None,
        "mode":                    metadata.get("mode"),
        "features":                metadata.get("features"),
        "models":                  metadata.get("models"),
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


def _poblacion_estatal(estado: str, año: int) -> float:
    """Población del estado para el año dado, desde el lookup del censo.
    Años fuera de rango se clampan; estado desconocido usa la mediana nacional."""
    if poblacion is None:
        return 0.0
    yr = min(max(año, poblacion["year_min"]), poblacion["year_max"])
    val = poblacion["by_state_year"].get((estado, yr))
    if val is None:
        return poblacion["national_median"]
    return val


@app.post("/predict")
def predict(req: PredictRequest):
    if model_danos is None or preprocessor is None:
        return {
            "error": "Modelos o preprocessor no cargados",
            "hint": "Ejecuta train_model_simple.py para generar los artifacts en backend/app/artifacts/",
        }

    d = req.dict()
    # Normalizar estado: tomar el primero si vienen varios; aplicar alias.
    estado = d["Estado"].split(",")[0].strip()
    estado = STATE_ALIASES.get(estado, estado)

    mes = d["Mes"]
    row = {
        "Clasificación del fenómeno": d["Clasificación_del_fenómeno"],
        "Tipo de fenómeno":           d["Tipo_de_fenómeno"],
        "Estado":                     estado,
        "Año":                        d["Año"],
        "mes_sin":                    np.sin(2 * np.pi * mes / 12),
        "mes_cos":                    np.cos(2 * np.pi * mes / 12),
        "Población estatal":          _poblacion_estatal(estado, d["Año"]),
    }

    X = preprocessor.transform(pd.DataFrame([row])[FEATURES])
    if hasattr(X, "toarray"):
        X = X.toarray()

    danos = float(max(np.expm1(model_danos.predict(X))[0], 0))
    prediction = {TARGET_DANOS: danos}

    if model_pobl is not None:
        pobl = float(max(np.expm1(model_pobl.predict(X))[0], 0))
        prediction[TARGET_POBL] = pobl

    return {"prediction": prediction}


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
