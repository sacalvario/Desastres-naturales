import pandas as pd
import numpy as np
import json
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, PolynomialFeatures
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

# =====================================================
# AJUSTA ESTA RUTA A TU ARCHIVO EXCEL REAL
# =====================================================
EXCEL_PATH = r"C:\Users\monyr\OneDrive\Escritorio\Impacto Desastres\Base.xlsx"

# =====================================================
# LECTURA DEL ARCHIVO
# =====================================================
df = pd.read_excel(EXCEL_PATH)
df.columns = [c.strip() for c in df.columns]

print("Columnas detectadas:")
print(df.columns.tolist())

# =====================================================
# CONFIGURACIÓN
# =====================================================
target = "Total de daños (millones de pesos)"

input_cols = [
    "Año",
    "Mes",
    "Clasificación del fenómeno",
    "Tipo de fenómeno",
    "Estado",
    "Impacto humano",
    "Daños a infraestructura",
]

# =====================================================
# LIMPIEZA BÁSICA
# =====================================================
# Target
df[target] = pd.to_numeric(df[target], errors="coerce")

# Numéricas
df["Año"] = pd.to_numeric(df["Año"], errors="coerce")
df["Mes"] = pd.to_numeric(df["Mes"], errors="coerce")
df["Impacto humano"] = pd.to_numeric(df["Impacto humano"], errors="coerce")
df["Daños a infraestructura"] = pd.to_numeric(df["Daños a infraestructura"], errors="coerce")

# Texto
df["Clasificación del fenómeno"] = df["Clasificación del fenómeno"].astype(str).str.strip()
df["Tipo de fenómeno"] = df["Tipo de fenómeno"].astype(str).str.strip()
df["Estado"] = df["Estado"].astype(str).str.strip()

# Si viene más de un estado en la misma celda, tomar el primero
df["Estado"] = df["Estado"].str.split(",").str[0].str.strip()

# =====================================================
# FILTRADO DE DATOS
# =====================================================
data = df.dropna(subset=input_cols + [target]).copy()

# quitar daños negativos por seguridad
data = data[data[target] >= 0].copy()

print(f"\nFilas originales: {len(df)}")
print(f"Filas usadas para entrenamiento: {len(data)}")

# =====================================================
# FEATURES Y TARGET
# =====================================================
X = data[input_cols].copy()
y = data[target].copy()

# Transformación log al target
y_log = np.log1p(y)

# =====================================================
# TRAIN / TEST
# =====================================================
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y_log,
    test_size=0.2,
    random_state=42
)

# =====================================================
# PREPROCESAMIENTO
# =====================================================
cat_features = [
    "Clasificación del fenómeno",
    "Tipo de fenómeno",
    "Estado",
]

num_features = [
    "Año",
    "Mes",
    "Impacto humano",
    "Daños a infraestructura",
]

categorical_transformer = Pipeline(
    steps=[
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ]
)

numeric_transformer = Pipeline(
    steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("poly", PolynomialFeatures(degree=2, include_bias=False)),
    ]
)

preprocessor = ColumnTransformer(
    transformers=[
        ("cat", categorical_transformer, cat_features),
        ("num", numeric_transformer, num_features),
    ]
)

# =====================================================
# MODELO
# =====================================================
model = ExtraTreesRegressor(
    n_estimators=300,
    random_state=42,
    n_jobs=-1,
    min_samples_leaf=2,
)

# =====================================================
# ENTRENAMIENTO
# =====================================================
Xtr = preprocessor.fit_transform(X_train)
model.fit(Xtr, y_train)

# =====================================================
# PREDICCIÓN
# =====================================================
Xte = preprocessor.transform(X_test)
pred_log = model.predict(Xte)

# volver a escala original
pred = np.expm1(pred_log)
true = np.expm1(y_test.to_numpy())

# evitar negativos residuales
pred = np.maximum(pred, 0)

# =====================================================
# MÉTRICAS
# =====================================================
mae = mean_absolute_error(true, pred)
r2 = r2_score(true, pred)

metrics = {
    "MAE": float(mae),
    "R2": float(r2)
}

print("\nMétricas:")
print(json.dumps(metrics, ensure_ascii=False, indent=2))

# =====================================================
# IMPORTANCIA DE VARIABLES (opcional, útil)
# =====================================================
try:
    feature_names = preprocessor.get_feature_names_out()
    importances = model.feature_importances_

    importance_df = pd.DataFrame({
        "feature": feature_names,
        "importance": importances
    }).sort_values("importance", ascending=False)

    print("\nTop 15 variables más importantes:")
    print(importance_df.head(15).to_string(index=False))
except Exception as e:
    print("\nNo se pudieron obtener importancias de variables:", str(e))
    importance_df = None

# =====================================================
# GUARDAR ARTIFACTS
# =====================================================
art_dir = Path(__file__).resolve().parent / "app" / "artifacts"
art_dir.mkdir(parents=True, exist_ok=True)

joblib.dump(model, art_dir / "model.joblib")
joblib.dump(preprocessor, art_dir / "preprocessor.joblib")

metadata = {
    "inputs": input_cols,
    "target": target,
    "rows_used": int(len(data)),
    "model_type": "ExtraTreesRegressor",
    "target_transform": "log1p_expm1",
    "metrics_test": metrics,
    "notes": "Modelo de daños económicos usando Año, Mes, Clasificación, Tipo de fenómeno, Estado, Impacto humano y Daños a infraestructura."
}

(art_dir / "metadata.json").write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

if importance_df is not None:
    importance_df.to_csv(art_dir / "feature_importance.csv", index=False, encoding="utf-8")

print(f"\n✅ Artifacts guardados en: {art_dir}")
print("✅ Archivos generados:")
print("- model.joblib")
print("- preprocessor.joblib")
print("- metadata.json")
if importance_df is not None:
    print("- feature_importance.csv")