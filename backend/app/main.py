from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import numpy as np
import joblib
import json

STATS_CACHE = "public, max-age=3600"

app = FastAPI(title="Impacto Desastres API", version="1.0")

# Orígenes de producción: lista explícita. Cualquier despliegue nuevo del
# frontend tiene que agregarse aquí a mano.
ORIGENES_PRODUCCION = [
    "https://desastres-naturales-gamma.vercel.app",
]

# En desarrollo se acepta cualquier puerto de localhost. Vite no siempre levanta
# en 5173 (si el puerto está ocupado toma el siguiente libre), y fijar un solo
# puerto obliga a editar el backend cada vez que eso pasa. La expresión solo
# abre la máquina local, así que no relaja nada en producción.
ORIGENES_DESARROLLO = r"http://(localhost|127\.0\.0\.1):\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES_PRODUCCION,
    allow_origin_regex=ORIGENES_DESARROLLO,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# El dashboard descarga el dataset completo de eventos una sola vez (~500 KB en
# claro). Comprimido baja a ~80 KB, así que el gzip no es un lujo: es lo que hace
# viable mandar el detalle por evento en vez de solo agregados.
app.add_middleware(GZipMiddleware, minimum_size=1024)

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

    return JSONResponse(
        content={
            "total_eventos":      int(len(stats_df)),
            "total_daños":        round(float(stats_df[target].sum()), 2),
            "poblacion_afectada": total_pob,
            "estados_afectados":  int(stats_df["Estado"].nunique()),
        },
        headers={"Cache-Control": STATS_CACHE},
    )


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
    return JSONResponse(
        content=[
            {"año": int(r["Año"]), "daños": round(float(r[target]), 2)}
            for _, r in df.iterrows()
        ],
        headers={"Cache-Control": STATS_CACHE},
    )


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
    return JSONResponse(
        content=[
            {"estado": r["Estado"], "daños": round(float(r[target]), 2)}
            for _, r in df.iterrows()
        ],
        headers={"Cache-Control": STATS_CACHE},
    )


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
    return JSONResponse(
        content=[
            {
                "estado":         r["Estado"],
                "daños":          round(float(r["daños"]),     2),
                "poblacion":      int(r["poblacion"]),
                "total_eventos":  int(r["total_eventos"]),
            }
            for _, r in df.iterrows()
        ],
        headers={"Cache-Control": STATS_CACHE},
    )


@app.get("/stats/clasificacion")
def stats_clasificacion():
    """Conteo de eventos por clasificación para el pastel."""
    if stats_df is None:
        return _no_data()

    col    = "Clasificación del fenómeno"
    counts = stats_df[col].value_counts()
    colors = {"Hidrometeorológico": "#3b82f6", "Geológico": "#f97316"}

    return JSONResponse(
        content=[
            {
                "label": str(k),
                "value": int(v),
                "color": colors.get(str(k), "#6b7280"),
            }
            for k, v in counts.items()
        ],
        headers={"Cache-Control": STATS_CACHE},
    )


@app.get("/stats/top-eventos")
def stats_top_eventos(limit: int = 10):
    """Eventos individuales más costosos para la tabla."""
    if stats_df is None:
        return _no_data()

    df = stats_df.sort_values(target, ascending=False).head(limit)
    return JSONResponse(
        content=[
            {
                "año":    int(r["Año"]),
                "estado": r["Estado"],
                "tipo":   r["Tipo de fenómeno"],
                "daños":  round(float(r[target]), 2),
            }
            for _, r in df.iterrows()
        ],
        headers={"Cache-Control": STATS_CACHE},
    )


# ════════════════════════════════════════════════════════════════
# DATASET COMPLETO PARA EL DASHBOARD INTERACTIVO
# ════════════════════════════════════════════════════════════════
# Los endpoints /stats/* de arriba devuelven agregados fijos: sirven para una
# vista estática, pero cada filtro nuevo exigiría un viaje al servidor. Con 3,958
# eventos el dataset entero cabe en una respuesta comprimida (~80 KB), así que
# se manda una sola vez y el frontend filtra y agrega en memoria. El resultado es
# filtrado instantáneo y cruzado (clic en un estado, brush sobre los años) sin
# latencia de red. Si el dataset creciera un orden de magnitud, este endpoint
# tendría que volver a agregar del lado del servidor.

# Columnas del Excel que llegan como texto sucio ("SD", "sd", "19 362 ",
# " 13,637.00 \n") y hay que convertir a número antes de exponerlas.
COLUMNAS_SUCIAS = {
    "defunciones": "Defunciones",
    "viviendas":   "Viviendas dañadas",
    "escuelas":    "Escuelas",
    "hospitales":  "Hospitales",
    "comercios":   "Comercios",
    "cultivo":     "Area de cultivo dañada / pastizales (h)",
}

# Orden de las columnas en cada fila de /stats/eventos. El frontend lo lee del
# campo "columnas" de la respuesta, así que agregar una columna aquí no rompe
# nada mientras se agregue también al armado de la fila.
COLUMNAS_EVENTOS = [
    "año", "mes", "estado", "clasificacion", "tipo", "duracion",
    "daños", "poblacion", "defunciones", "viviendas",
    "escuelas", "hospitales", "comercios", "cultivo",
]


def _a_numero(serie: pd.Series) -> pd.Series:
    """Convierte una columna de texto sucio a número.

    Quita todo lo que no sea dígito, punto o signo (comas de millar, espacios,
    saltos de línea) y manda a NaN los marcadores de "sin dato" ("SD", "sd").
    """
    limpia = (
        serie.astype(str)
        .str.replace(r"[^\d.\-]", "", regex=True)
        .replace("", np.nan)
    )
    return pd.to_numeric(limpia, errors="coerce")


def _entero_o_nulo(valor) -> int | None:
    """NaN -> None, para que el JSON salga con `null` y no con `NaN` (inválido)."""
    if valor is None or pd.isna(valor):
        return None
    return int(valor)


def _decimal_o_nulo(valor, decimales: int = 2) -> float | None:
    if valor is None or pd.isna(valor):
        return None
    return round(float(valor), decimales)


def _construir_eventos() -> dict | None:
    """Arma una sola vez la tabla compacta de eventos que consume el dashboard.

    Se ejecuta al arrancar, no por petición: el DataFrame es estático (viene de
    data.joblib) y recalcularlo en cada request sería trabajo repetido.
    """
    if stats_df is None:
        return None

    df = stats_df.copy()
    for alias, columna in COLUMNAS_SUCIAS.items():
        df[alias] = _a_numero(df[columna]) if columna in df.columns else np.nan

    filas = []
    for fila in df.itertuples(index=False):
        registro = dict(zip(df.columns, fila))
        filas.append([
            int(registro["Año"]),
            int(registro["Mes"]),
            registro["Estado"],
            registro["Clasificación del fenómeno"],
            registro["Tipo de fenómeno"],
            _entero_o_nulo(registro.get("Duración días")),
            # Cuatro decimales, no dos: el daño no nulo más pequeño del dataset
            # es 0.00047 millones (unos 466 pesos) y hay 76 eventos por debajo
            # de 0.005. Redondear a dos decimales los mandaba a cero y el
            # histograma reportaba 1,141 eventos "sin daño" donde hay 1,065.
            _decimal_o_nulo(registro[target], 4) if registro[target] is not None else 0.0,
            _entero_o_nulo(registro.get("Población afectada")),
            _entero_o_nulo(registro.get("defunciones")),
            _entero_o_nulo(registro.get("viviendas")),
            _entero_o_nulo(registro.get("escuelas")),
            _entero_o_nulo(registro.get("hospitales")),
            _entero_o_nulo(registro.get("comercios")),
            _decimal_o_nulo(registro.get("cultivo"), 1),
        ])

    return {"columnas": COLUMNAS_EVENTOS, "filas": filas, "total": len(filas)}


eventos_payload = _construir_eventos()
if eventos_payload is not None:
    print(f"[eventos] tabla compacta lista: {eventos_payload['total']} filas.")


@app.get("/stats/eventos")
def stats_eventos():
    """Dataset completo evento por evento, en formato compacto.

    Se devuelve como lista de listas (no lista de objetos) para no repetir los
    nombres de las 14 columnas 3,958 veces: reduce el JSON casi a la mitad.
    """
    if eventos_payload is None:
        return _no_data()

    return JSONResponse(content=eventos_payload, headers={"Cache-Control": STATS_CACHE})


@app.get("/stats/dimensiones")
def stats_dimensiones():
    """Catálogos para armar los controles de filtro del dashboard.

    Salen de los datos, no de una lista escrita a mano, para que el frontend no
    pueda ofrecer un filtro que no existe en el dataset.
    """
    if stats_df is None:
        return _no_data()

    tipos_por_clasificacion = {
        str(clasificacion): sorted(grupo["Tipo de fenómeno"].dropna().unique().tolist())
        for clasificacion, grupo in stats_df.groupby("Clasificación del fenómeno")
    }

    return JSONResponse(
        content={
            "años": {
                "min": int(stats_df["Año"].min()),
                "max": int(stats_df["Año"].max()),
            },
            "estados":                 sorted(stats_df["Estado"].dropna().unique().tolist()),
            "clasificaciones":         sorted(stats_df["Clasificación del fenómeno"].dropna().unique().tolist()),
            "tipos":                   sorted(stats_df["Tipo de fenómeno"].dropna().unique().tolist()),
            "tipos_por_clasificacion": tipos_por_clasificacion,
            "total_eventos":           int(len(stats_df)),
        },
        headers={"Cache-Control": STATS_CACHE},
    )
