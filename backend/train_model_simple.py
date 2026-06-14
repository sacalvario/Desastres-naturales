"""Entrena los modelos ex-ante de impacto de desastres naturales.

Genera dos modelos independientes que predicen ANTES de conocer los daños:
  - Modelo A: daño económico  (Total de daños, millones de pesos)
  - Modelo B: población afectada (número de personas)

Ambos usan el mismo conjunto de features ex-ante (fenómeno, estado, fecha y
población estatal del censo) y el mismo preprocesador. NO usan columnas
post-evento (Impacto humano, Daños a infraestructura), que serían leakage.
"""

import json
import shutil
import tempfile
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, median_absolute_error, r2_score

REPO_ROOT  = Path(__file__).resolve().parent.parent
EXCEL_PATH = REPO_ROOT / "Base.xlsx"
POBL_PATH  = REPO_ROOT / "Poblacion_01.xlsx"

TARGET_DANOS = "Total de daños (millones de pesos)"
TARGET_POBL  = "Población afectada"

# Features ex-ante (conocibles ANTES del desastre)
CAT_FEATURES = ["Clasificación del fenómeno", "Tipo de fenómeno", "Estado"]
NUM_FEATURES = ["Año", "mes_sin", "mes_cos", "Población estatal"]
FEATURES     = CAT_FEATURES + NUM_FEATURES

# Año a partir del cual se evalúa (split temporal: train < 2020, test >= 2020)
TEST_YEAR_FROM = 2020

# Normalización de nombres de estado: censo INEGI -> nombres de Base.xlsx
CENSUS_TO_BASE = {
    "Coahuila de Zaragoza": "Coahuila",
    "Michoacán de Ocampo": "Michoacán",
    "Veracruz de Ignacio de la Llave": "Veracruz",
}
STATE_ALIASES = {"CDMX": "Ciudad de México", "Estado de México": "México"}
NON_STATES    = {"Varios Estados"}


def _read_excel_safe(path, **kwargs):
    """Lee un Excel copiándolo primero a un directorio temporal.
    Usa robocopy como fallback cuando OneDrive/Excel tiene el archivo bloqueado."""
    src = Path(path)
    tmp_dir  = Path(tempfile.mkdtemp())
    tmp_file = tmp_dir / src.name
    try:
        shutil.copy2(src, tmp_file)
    except PermissionError:
        subprocess.run(
            ["robocopy", str(src.parent), str(tmp_dir), src.name, "/R:0", "/W:0"],
            capture_output=True,
        )
    if not tmp_file.exists():
        raise PermissionError(
            f"No se pudo leer {src}. Ciérralo en Excel o pausa la sincronización de OneDrive."
        )
    try:
        return pd.read_excel(tmp_file, **kwargs)
    finally:
        tmp_file.unlink(missing_ok=True)


def load_population_table():
    """Devuelve un DataFrame {Estado, Año, Población estatal} para 2000-2023.

    El censo del INEGI trae años censales (2000, 2005, 2010, 2020); se interpola
    linealmente por estado y se extrapola plano fuera del rango.
    """
    raw = _read_excel_safe(POBL_PATH, header=None)
    cen = raw.iloc[6:].copy()
    cen.columns = ["Estado", "Grupo", "2000", "2005", "2010", "2020"]
    cen = cen[cen["Grupo"].astype(str).str.strip() == "Total"].dropna(subset=["Estado"])
    census_years = [2000, 2005, 2010, 2020]
    for c in map(str, census_years):
        cen[c] = pd.to_numeric(cen[c], errors="coerce")
    cen["Estado"] = cen["Estado"].astype(str).str.strip().replace(CENSUS_TO_BASE)

    rows = []
    for _, r in cen.iterrows():
        ys = [r["2000"], r["2005"], r["2010"], r["2020"]]
        for year in range(2000, 2024):
            rows.append((r["Estado"], year, float(np.interp(year, census_years, ys))))
    return pd.DataFrame(rows, columns=["Estado", "Año", "Población estatal"])


def clean_base():
    """Carga y limpia Base.xlsx; une la población estatal del censo."""
    df = _read_excel_safe(EXCEL_PATH)
    df.columns = [c.strip() for c in df.columns]

    # Numéricas
    df["Año"] = pd.to_numeric(df["Año"], errors="coerce")
    df["Mes"] = pd.to_numeric(df["Mes"], errors="coerce")
    df[TARGET_DANOS] = pd.to_numeric(df[TARGET_DANOS], errors="coerce")
    df[TARGET_POBL]  = pd.to_numeric(df[TARGET_POBL],  errors="coerce")

    # Texto
    for c in ["Clasificación del fenómeno", "Tipo de fenómeno", "Estado"]:
        df[c] = df[c].astype(str).str.strip()

    # Un solo estado por fila (separadores "," y " y "); normalizar nombres.
    df["Estado"] = df["Estado"].str.split(r",| y ", regex=True).str[0].str.strip()
    df["Estado"] = df["Estado"].replace(STATE_ALIASES)
    df = df[~df["Estado"].isin(NON_STATES)].copy()

    # Mes cíclico
    df["mes_sin"] = np.sin(2 * np.pi * df["Mes"] / 12)
    df["mes_cos"] = np.cos(2 * np.pi * df["Mes"] / 12)

    # Unir población estatal del censo
    popmap = load_population_table()
    df = df.merge(popmap, on=["Estado", "Año"], how="left")
    return df, popmap


def build_preprocessor():
    return ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CAT_FEATURES),
            ("num", "passthrough", NUM_FEATURES),
        ]
    )


def evaluate_temporal(df, target):
    """Métricas honestas con split temporal: train < 2020, test >= 2020."""
    d = df.dropna(subset=FEATURES + [target]).copy()
    train = d[d["Año"] < TEST_YEAR_FROM]
    test  = d[d["Año"] >= TEST_YEAR_FROM]
    if len(test) == 0 or len(train) == 0:
        return {"nota": "sin datos suficientes para split temporal"}

    pre = build_preprocessor()
    model = HistGradientBoostingRegressor(random_state=42)
    Xtr = pre.fit_transform(train[FEATURES])
    model.fit(Xtr, np.log1p(train[target].values))

    pred = np.maximum(np.expm1(model.predict(pre.transform(test[FEATURES]))), 0)
    true = test[target].values
    return {
        "R2_log":  round(float(r2_score(np.log1p(true), np.log1p(pred))), 4),
        "MAE":     round(float(mean_absolute_error(true, pred)), 2),
        "MedAE":   round(float(median_absolute_error(true, pred)), 4),
        "n_train": int(len(train)),
        "n_test":  int(len(test)),
    }


def fit_final(df, target):
    """Reentrena con TODOS los años para el modelo que se sirve."""
    d = df.dropna(subset=FEATURES + [target]).copy()
    pre = build_preprocessor()
    model = HistGradientBoostingRegressor(random_state=42)
    model.fit(pre.fit_transform(d[FEATURES]), np.log1p(d[target].values))
    return model, pre, int(len(d))


def main():
    df, popmap = clean_base()

    # Dataset del dashboard (filtro laxo: solo exige target y Año). data.joblib
    stats_data = df.dropna(subset=[TARGET_DANOS, "Año"]).copy()
    stats_data = stats_data[stats_data[TARGET_DANOS] >= 0].copy()

    print(f"Filas originales: {len(df)}")
    print(f"Filas para estadísticas (dashboard): {len(stats_data)}")

    # ── Métricas honestas (split temporal) ──────────────────────────
    metrics_danos = evaluate_temporal(df, TARGET_DANOS)
    metrics_pobl  = evaluate_temporal(df, TARGET_POBL)
    print("\nMétricas temporales (train <2020, test >=2020):")
    print("  Modelo A (daños):    ", json.dumps(metrics_danos, ensure_ascii=False))
    print("  Modelo B (población):", json.dumps(metrics_pobl, ensure_ascii=False))

    # ── Modelos finales (todos los años) ────────────────────────────
    model_danos, prep_danos, n_danos = fit_final(df, TARGET_DANOS)
    model_pobl,  _,          n_pobl  = fit_final(df, TARGET_POBL)
    # Ambos comparten el mismo conjunto de features -> un preprocesador basta.
    preprocessor = prep_danos

    # ── Guardar artifacts ───────────────────────────────────────────
    art_dir = Path(__file__).resolve().parent / "app" / "artifacts"
    art_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model_danos,  art_dir / "model_danos.joblib")
    joblib.dump(model_pobl,   art_dir / "model_poblacion.joblib")
    joblib.dump(preprocessor, art_dir / "preprocessor.joblib")
    joblib.dump(stats_data,   art_dir / "data.joblib")

    # Lookup de población estatal: {(Estado, Año): población} + fallback nacional
    pop_lookup = {(r["Estado"], int(r["Año"])): float(r["Población estatal"])
                  for _, r in popmap.iterrows()}
    pop_artifact = {
        "by_state_year":   pop_lookup,
        "year_min":        int(popmap["Año"].min()),
        "year_max":        int(popmap["Año"].max()),
        "national_median": float(popmap[popmap["Año"] == popmap["Año"].max()]["Población estatal"].median()),
    }
    joblib.dump(pop_artifact, art_dir / "poblacion_estatal.joblib")

    metadata = {
        "mode": "ex-ante",
        "features": FEATURES,
        "models": {
            "danos":     {"artifact": "model_danos.joblib",     "target": TARGET_DANOS,
                          "rows_used": n_danos, "metrics_temporal": metrics_danos},
            "poblacion": {"artifact": "model_poblacion.joblib", "target": TARGET_POBL,
                          "rows_used": n_pobl,  "metrics_temporal": metrics_pobl},
        },
        "model_type": "HistGradientBoostingRegressor",
        "target_transform": "log1p_expm1",
        "notes": ("Modelos ex-ante: predicen daño económico y población afectada "
                  "usando solo features conocibles antes del desastre "
                  "(fenómeno, estado, fecha, población estatal del censo)."),
    }
    (art_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nArtifacts guardados en: {art_dir}")
    for f in ["model_danos.joblib", "model_poblacion.joblib", "preprocessor.joblib",
              "poblacion_estatal.joblib", "data.joblib", "metadata.json"]:
        print(f"- {f}")


if __name__ == "__main__":
    main()
