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
    "https://desastres-naturales-gamma.vercel.app/",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "model.joblib"
PREP_PATH = ARTIFACTS_DIR / "preprocessor.joblib"
META_PATH = ARTIFACTS_DIR / "metadata.json"

model = None
preprocessor = None
target = "Total de daños (millones de pesos)"
metadata = {}

if MODEL_PATH.exists() and PREP_PATH.exists():
    model = joblib.load(MODEL_PATH)
    preprocessor = joblib.load(PREP_PATH)

    if META_PATH.exists():
        metadata = json.loads(META_PATH.read_text(encoding="utf-8"))
        target = metadata.get("target", target)


class PredictRequest(BaseModel):
    Año: int
    Mes: int
    Clasificación_del_fenómeno: str
    Tipo_de_fenómeno: str
    Estado: str
    Impacto_humano: int
    Daños_a_infraestructura: int


@app.get("/")
def root():
    return {"message": "API activa. Ve a /docs para probar endpoints."}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "preprocessor_loaded": preprocessor is not None,
        "target": target,
        "inputs": metadata.get("inputs"),
        "metrics_test": metadata.get("metrics_test"),
    }


@app.post("/predict")
def predict(req: PredictRequest):
    if model is None or preprocessor is None:
        return {
            "error": "Model o preprocessor no cargados",
            "hint": "Verifica que model.joblib y preprocessor.joblib estén en backend/app/artifacts/"
        }

    d = req.dict()

    row = {
        "Año": d["Año"],
        "Mes": d["Mes"],
        "Clasificación del fenómeno": d["Clasificación_del_fenómeno"],
        "Tipo de fenómeno": d["Tipo_de_fenómeno"],
        "Estado": d["Estado"].split(",")[0].strip(),
        "Impacto humano": d["Impacto_humano"],
        "Daños a infraestructura": d["Daños_a_infraestructura"],
    }

    df = pd.DataFrame([row])

    X = preprocessor.transform(df)

    if hasattr(X, "toarray"):
        X = X.toarray()

    pred_log = model.predict(X)
    pred = np.expm1(pred_log)

    prediction = float(pred[0])
    prediction = max(prediction, 0)

    return {
        "prediction": {
            target: prediction
        }
    }
