"""Entrena los modelos de impacto económico de desastres naturales.

Un modelo por tipo de fenómeno —lluvias y ciclones— porque las variables que describen la
intensidad del evento son estructuralmente disjuntas: ninguna fila tiene lluvia acumulada y
viento a la vez. En un modelo único, la presión de ciclón estaría ausente en el 91.7% de las
filas y competiría por profundidad del árbol sin informar.

La intensidad entra como ordinal con restricción de monotonía, de modo que un evento más
intenso nunca prediga menos daño. Ver `app/intensidad.py` y el diseño en
`docs/superpowers/specs/2026-09-13-intensidad-y-modelos-por-tipo-design.md`.

El modelo de población afectada se eliminó: su R² era negativo en cuatro de los cinco cortes
temporales probados, es decir, no superaba a predecir la media.
"""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, median_absolute_error, r2_score
from sklearn.preprocessing import OneHotEncoder

from app.intensidad import (
    TIPO_CICLONES,
    TIPO_LLUVIAS,
    TIPOS,
    nivel_ciclon,
    nivel_lluvia,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCEL_PATH = REPO_ROOT / "Base_unificada.xlsx"
POBL_PATH = REPO_ROOT / "Poblacion_01.xlsx"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "app" / "artifacts"

TARGET = "Total de daños (millones de pesos)"

# `Clasificación del fenómeno` no entra como feature: en este dataset es constante
# (Hidrometeorológico en todas las filas), así que no aporta información.
#
# Año, mes y población estatal tampoco entran, y esto se midió antes de decidirlo: añadirlas
# degrada el modelo en lugar de mejorarlo. Con el juego completo de features, el R² medio de
# lluvias era -0.4567 y el de ciclones -0.0607; quitándolas suben a -0.0739 y +0.0771. Con
# tan pocas filas por combinación, esas variables aportan ruido en vez de señal.
#
# `WMO_PRES` quedó fuera, y conviene dejar escrito por qué, porque la primera razón que se
# dio era incorrecta. Se descartó midiendo con un `dropna` que incluía la propia columna, lo
# que descartaba los 18 ciclones sin presión y comparaba contra otro conjunto de prueba; con
# el filtro correcto la columna parecía mejorar el R² medio de +0.0467 a +0.0588. Se
# mantiene fuera por dos razones distintas, ambas medidas:
#
# 1. La ventaja no sobrevive a ponderar cada corte por su número de filas de prueba: la
#    presión pierde en los dos cortes con más datos (80 y 74 filas) y gana en los tres con
#    menos (61, 51, 30). La correlación entre el tamaño del test y su ventaja es -0.929, y
#    la diferencia pasa de +0.0121 en media simple a -0.0050 en media ponderada. Un
#    resultado cuyo signo depende de cómo se agregue no es un resultado.
#
# 2. Con la presión dentro, la intensidad deja de mover la predicción: los siete niveles de
#    Saffir-Simpson devuelven el mismo número, con presión y sin ella, incluso forzando
#    monotonía en ambas columnas. Eso vacía la función que el predictor debe ofrecer, que es
#    responder al escenario de intensidad que plantea quien lo usa.
CAT_FEATURES = ["Estado"]
NUM_COMUNES = ["intensidad"]
NUM_POR_TIPO = {TIPO_LLUVIAS: [], TIPO_CICLONES: []}

# Cortes temporales para la validación. Un solo split no es evidencia: el R² de este
# proyecto oscila entre 0.01 y 0.24 según dónde se corte.
CORTES = (2017, 2018, 2019, 2020, 2021)

CENSUS_TO_BASE = {
    "Coahuila de Zaragoza": "Coahuila",
    "Michoacán de Ocampo": "Michoacán",
    "Veracruz de Ignacio de la Llave": "Veracruz",
}
STATE_ALIASES = {"CDMX": "Ciudad de México", "Estado de México": "México"}
NON_STATES = {"Varios Estados"}


def _read_excel_safe(path, **kwargs):
    """Lee un Excel copiándolo primero a un directorio temporal.
    Usa robocopy como fallback cuando OneDrive/Excel tiene el archivo bloqueado."""
    src = Path(path)
    tmp_dir = Path(tempfile.mkdtemp())
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
    """DataFrame {Estado, Año, Población estatal} para 2000-2023, interpolando el censo."""
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
    """Carga el dataset unificado, lo restringe a lluvias y ciclones y deriva la intensidad.

    Devuelve (df, popmap, cortes_lluvia). Los cortes de lluvia se calculan aquí y se guardan
    como artefacto para que la API clasifique con los mismos umbrales del entrenamiento.
    """
    df = _read_excel_safe(EXCEL_PATH)

    # El Excel trae nombres de columna con espacio final ('Población afectada ',
    # 'Hospitales ') y valores de estado con espacio ('Campeche ', 'Ciudad de México ').
    # Sin normalizar, el one-hot los toma como categorías distintas y el mapa del dashboard
    # los pinta de gris sin lanzar ningún error.
    df.columns = [c.strip() for c in df.columns]
    for c in ["Tipo de fenómeno", "Estado"]:
        df[c] = df[c].astype(str).str.strip()

    df["Año"] = pd.to_numeric(df["Año"], errors="coerce")
    df["Mes"] = pd.to_numeric(df["Mes"], errors="coerce")
    df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")
    for c in ("mm_CHIRPS", "WMO_WIND", "WMO_PRES"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df[df["Tipo de fenómeno"].isin(TIPOS)].copy()

    df["Estado"] = df["Estado"].str.split(r",| y ", regex=True).str[0].str.strip()
    df["Estado"] = df["Estado"].replace(STATE_ALIASES)
    df = df[~df["Estado"].isin(NON_STATES)].copy()

    df["mes_sin"] = np.sin(2 * np.pi * df["Mes"] / 12)
    df["mes_cos"] = np.cos(2 * np.pi * df["Mes"] / 12)

    es_lluvia = df["Tipo de fenómeno"] == TIPO_LLUVIAS
    cortes_lluvia = tuple(
        float(v) for v in df.loc[es_lluvia, "mm_CHIRPS"].quantile([1 / 3, 2 / 3])
    )

    df["intensidad"] = [
        nivel_lluvia(mm, cortes_lluvia) if tipo == TIPO_LLUVIAS else nivel_ciclon(viento)
        for tipo, mm, viento in zip(df["Tipo de fenómeno"], df["mm_CHIRPS"], df["WMO_WIND"])
    ]

    popmap = load_population_table()
    df = df.merge(popmap, on=["Estado", "Año"], how="left")
    return df, popmap, cortes_lluvia


def features_de(tipo):
    return CAT_FEATURES + NUM_COMUNES + NUM_POR_TIPO[tipo]


def filas_utilizables(df, tipo):
    """Filas del tipo con las features BASE presentes.

    El filtro nunca exige las columnas propias del tipo: si se exigiera `WMO_PRES`, los
    18 ciclones que no la traen desaparecerían y cada variante del modelo se evaluaría
    sobre un conjunto distinto, que fue exactamente el error que dio por perjudicial a esa
    columna. Los nulos los maneja HistGradientBoosting de forma nativa.
    """
    return df[df["Tipo de fenómeno"] == tipo].dropna(
        subset=CAT_FEATURES + NUM_COMUNES + [TARGET]
    )


def build_preprocessor(tipo):
    return ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CAT_FEATURES),
            ("num", "passthrough", NUM_COMUNES + NUM_POR_TIPO[tipo]),
        ]
    )


def _restriccion_monotona(ancho_total, tipo):
    """Vector de restricciones: +1 en la columna de intensidad, 0 en el resto.

    Sin esto el modelo llega a predecir menos daño para un huracán categoría 5 que para una
    depresión tropical, porque las clases altas tienen 2 y 7 eventos.
    """
    cst = np.zeros(ancho_total)
    n_extra = len(NUM_POR_TIPO[tipo])
    # El passthrough conserva el orden de NUM_COMUNES + NUM_POR_TIPO, y la intensidad es la
    # última de NUM_COMUNES.
    cst[ancho_total - n_extra - 1] = 1
    return cst


def entrena(train_df, tipo):
    feats = features_de(tipo)
    prep = build_preprocessor(tipo)
    X = prep.fit_transform(train_df[feats])
    modelo = HistGradientBoostingRegressor(
        random_state=42, monotonic_cst=_restriccion_monotona(X.shape[1], tipo)
    )
    modelo.fit(X, np.log1p(train_df[TARGET].values))
    return modelo, prep


def evalua_por_cortes(df, tipo):
    """R² y MAE promediados sobre varios cortes temporales, más la línea base por tipo.

    La línea base es la que hay que batir: predecir el promedio histórico del tipo de
    fenómeno gana al modelo anterior del proyecto en R² y en MAE.
    """
    d = filas_utilizables(df, tipo)
    r2s, maes, r2_base = [], [], []

    for corte in CORTES:
        train, test = d[d["Año"] < corte], d[d["Año"] >= corte]
        if len(test) < 20 or len(train) < 50:
            continue
        modelo, prep = entrena(train, tipo)
        pred = modelo.predict(prep.transform(test[features_de(tipo)]))
        y_test = np.log1p(test[TARGET])
        r2s.append(r2_score(y_test, pred))
        maes.append(mean_absolute_error(np.expm1(y_test), np.expm1(pred)))
        base = np.full(len(test), np.log1p(train[TARGET]).mean())
        r2_base.append(r2_score(y_test, base))

    if not r2s:
        return {"nota": "sin datos suficientes para validación temporal"}
    return {
        "R2_log_medio": round(float(np.mean(r2s)), 4),
        "R2_log_peor": round(float(np.min(r2s)), 4),
        "R2_log_por_corte": [round(float(v), 4) for v in r2s],
        "MAE_medio": round(float(np.mean(maes)), 2),
        "R2_linea_base_media_del_tipo": round(float(np.mean(r2_base)), 4),
        "cortes": list(CORTES),
        "n_filas": int(len(d)),
    }


def verifica_monotonia(modelo, prep, tipo, df):
    """Comprueba que subir la intensidad nunca baje el daño predicho.

    Es la prueba que impide el fallo que llegaría a una demo: un huracán categoría 5
    anunciando menos daño que una depresión tropical.
    """
    base = filas_utilizables(df, tipo).iloc[0]
    niveles = range(1, 8 if tipo == TIPO_CICLONES else 4)
    predicciones = []
    for nivel in niveles:
        fila = base.copy()
        fila["intensidad"] = nivel
        X = prep.transform(pd.DataFrame([fila])[features_de(tipo)])
        predicciones.append(float(np.expm1(modelo.predict(X))[0]))
    decrecientes = [
        (a, b) for a, b in zip(predicciones, predicciones[1:]) if b < a - 1e-9
    ]
    return predicciones, decrecientes


def main():
    df, popmap, cortes_lluvia = clean_base()
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Filas tras limpieza: {len(df)}")
    print(f"Cortes de lluvia (cuantiles): {cortes_lluvia[0]:.2f} mm / {cortes_lluvia[1]:.2f} mm")
    for tipo in TIPOS:
        print(f"  {tipo}: {int((df['Tipo de fenómeno'] == tipo).sum())} filas")

    metricas, modelos = {}, {}
    for tipo in TIPOS:
        d = filas_utilizables(df, tipo)
        metricas[tipo] = evalua_por_cortes(df, tipo)
        modelo, prep = entrena(d, tipo)
        modelos[tipo] = (modelo, prep, len(d))

        predicciones, decrecientes = verifica_monotonia(modelo, prep, tipo, df)
        estado = "OK" if not decrecientes else f"FALLA ({len(decrecientes)} tramos decrecientes)"
        print(f"\n{tipo}")
        print(f"  métricas: {json.dumps(metricas[tipo], ensure_ascii=False)}")
        print(f"  monotonía: {estado} -> {[round(p, 2) for p in predicciones]}")
        if decrecientes:
            raise SystemExit(
                f"El modelo de {tipo} predice menos daño al subir la intensidad. "
                "Revisa la restricción monótona antes de publicar los artefactos."
            )

    # Dataset del dashboard: mismos dos tipos que el modelo, por coherencia del proyecto.
    stats_data = df.dropna(subset=[TARGET, "Año"]).copy()
    stats_data = stats_data[stats_data[TARGET] >= 0].copy()
    print(f"\nFilas para el dashboard: {len(stats_data)}")

    for tipo, nombre in ((TIPO_LLUVIAS, "lluvias"), (TIPO_CICLONES, "ciclones")):
        modelo, prep, _ = modelos[tipo]
        joblib.dump(modelo, ARTIFACTS_DIR / f"model_{nombre}.joblib")
        joblib.dump(prep, ARTIFACTS_DIR / f"preprocessor_{nombre}.joblib")

    joblib.dump(stats_data, ARTIFACTS_DIR / "data.joblib")
    joblib.dump({"cortes_lluvia": cortes_lluvia}, ARTIFACTS_DIR / "intensidad.joblib")

    pop_lookup = {
        (r["Estado"], int(r["Año"])): float(r["Población estatal"])
        for _, r in popmap.iterrows()
    }
    joblib.dump(
        {
            "by_state_year": pop_lookup,
            "year_min": int(popmap["Año"].min()),
            "year_max": int(popmap["Año"].max()),
            "national_median": float(
                popmap[popmap["Año"] == popmap["Año"].max()]["Población estatal"].median()
            ),
        },
        ARTIFACTS_DIR / "poblacion_estatal.joblib",
    )

    metadata = {
        "mode": "intensidad-por-tipo",
        "target": TARGET,
        "model_type": "HistGradientBoostingRegressor",
        "target_transform": "log1p_expm1",
        "cortes_lluvia_mm": [round(c, 4) for c in cortes_lluvia],
        "models": {
            "lluvias": {
                "artifact": "model_lluvias.joblib",
                "preprocessor": "preprocessor_lluvias.joblib",
                "features": features_de(TIPO_LLUVIAS),
                "rows_used": modelos[TIPO_LLUVIAS][2],
                "metrics_temporal": metricas[TIPO_LLUVIAS],
            },
            "ciclones": {
                "artifact": "model_ciclones.joblib",
                "preprocessor": "preprocessor_ciclones.joblib",
                "features": features_de(TIPO_CICLONES),
                "rows_used": modelos[TIPO_CICLONES][2],
                "metrics_temporal": metricas[TIPO_CICLONES],
                "advertencia": (
                    "Entrenado con pocas filas: la métrica tiene un intervalo amplio y debe "
                    "reportarse con cautela."
                ),
            },
        },
        "notes": (
            "Un modelo por tipo de fenómeno. La intensidad entra como ordinal con restricción "
            "de monotonía, de modo que un evento más intenso nunca prediga menos daño. "
            "R2_linea_base_media_del_tipo es la referencia a batir: predecir el promedio "
            "histórico del tipo de fenómeno. El modelo deja de ser ex-ante puro, ya que la "
            "intensidad solo se conoce una vez medido el fenómeno."
        ),
    }
    (ARTIFACTS_DIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nArtifacts guardados en: {ARTIFACTS_DIR}")
    for f in sorted(p.name for p in ARTIFACTS_DIR.glob("*")):
        print(f"- {f}")


if __name__ == "__main__":
    main()
