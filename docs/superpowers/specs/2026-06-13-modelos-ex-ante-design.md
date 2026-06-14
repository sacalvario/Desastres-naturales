# Diseño: Modelos A y B ex-ante (full-stack)

Fecha: 2026-06-13
Estado: Aprobado por el usuario

## Objetivo

Rediseñar el predictor para que opere en modo **ex-ante** (predecir *antes* de
conocer los daños), eliminando la fuga de información (leakage) del modelo
actual, y añadir un segundo modelo que prediga la **población afectada**.

## Contexto y motivación

El modelo actual (`ExtraTreesRegressor` con 7 inputs) usa como features
`Impacto humano` y `Daños a infraestructura`, que son **medidas post-evento** y
componentes del propio target `Total de daños`. Esto es leakage: el modelo
"re-suma" partes del total en vez de predecir desde causas conocibles de
antemano. Verificado empíricamente (CV k=5):

- Con proxies de daño físico: R²log ≈ 0.71 (inflado, no disponible ex-ante).
- Solo exposición ex-ante: R²log ≈ 0.64.
- Solo categóricas + tiempo: R²log ≈ 0.35.

Decisión del usuario: **modo ex-ante**.

Además se añadió `Poblacion_01.xlsx` (censo INEGI 2000/2005/2010/2020 por
estado). Experimento: la población estatal resultó **neutra** para el Modelo A
(redundante con el one-hot de `Estado`), pero se conserva como feature de
exposición y para el dashboard. Para el Modelo B (población afectada) se comparó
predecir el **número directo** vs la **fracción del estado**: ganó el número
directo por amplio margen (R²log 0.314 vs −1.286).

## Arquitectura de modelos

Dos modelos **independientes y paralelos** (no en cascada, no multi-output):

| | Modelo A | Modelo B |
|---|---|---|
| Predice | Daño económico (MDP) | Población afectada (número) |
| Target | `log1p(Total de daños (millones de pesos))` | `log1p(Población afectada)` |
| Algoritmo | `HistGradientBoostingRegressor` | `HistGradientBoostingRegressor` |
| Inversión | `expm1`, clamp ≥ 0 | `expm1`, clamp ≥ 0 |

### Features ex-ante (preprocesador compartido)

- Categóricas (OneHotEncoder, `handle_unknown="ignore"`, `sparse_output=False`):
  `Clasificación del fenómeno`, `Tipo de fenómeno`, `Estado`.
- Numéricas (passthrough): `Año`, `mes_sin`, `mes_cos`, `Población estatal`.

`mes_sin = sin(2π·Mes/12)`, `mes_cos = cos(2π·Mes/12)`.

### Eliminado del modelo

`Impacto humano` y `Daños a infraestructura` (post-evento → leakage).

## Datos de población (censo)

- Fuente: `Poblacion_01.xlsx`, hoja `Tabulado`, filas con `Grupo edad == "Total"`.
- Años censales: 2000, 2005, 2010, 2020. Se **interpola linealmente** por estado
  para cada año 2000–2023; fuera de rango, extrapolación plana.
- Normalización de nombres censo → Base:
  `"Coahuila de Zaragoza"→"Coahuila"`, `"Michoacán de Ocampo"→"Michoacán"`,
  `"Veracruz de Ignacio de la Llave"→"Veracruz"`. El resto coincide.
- Se guarda como artifact `poblacion_estatal.joblib`: tabla
  `{Estado, Año → PoblacionEstatal}` para el lookup en la API.

## Validación

- Métrica titular con **split temporal**: train años ≤ 2019, test 2020–2023.
  Reportar `R²log`, `MedAE`, `MAE` para cada modelo.
- El modelo final servido se reentrena con **todos** los años.
- Expectativa realista: Modelo A R²log ≈ 0.37–0.40; Modelo B R²log ≈ 0.31.

## Artifacts producidos por `train_model_simple.py`

```
model_danos.joblib        ← Modelo A
model_poblacion.joblib    ← Modelo B
preprocessor.joblib       ← compartido (re-fit sobre todos los datos)
poblacion_estatal.joblib  ← {Estado, Año → población}
data.joblib               ← sin cambios (dataset del dashboard)
metadata.json             ← 2 modelos, 2 targets, métricas temporales de c/u
```

Se eliminan `model.joblib` y `feature_importance.csv` del flujo (reemplazados).

## API (`backend/app/main.py`)

- `PredictRequest`: `Año, Mes, Clasificación_del_fenómeno, Tipo_de_fenómeno,
  Estado`. Se quitan `Impacto_humano`, `Daños_a_infraestructura`.
- Carga `model_danos`, `model_poblacion`, `preprocessor`, `poblacion_estatal`.
- `predict()`:
  1. Normaliza `Estado`: `"Estado de México"→"México"`, `"CDMX"→"Ciudad de México"`,
     toma el primero si viene separado por `,` o ` y `.
  2. Lookup de `Población estatal` por (Estado, Año); años > 2023 usan 2023;
     si el estado no está, usa la mediana nacional como fallback.
  3. Calcula `mes_sin/cos`, arma la fila con las columnas exactas del
     preprocesador, transforma, corre ambos modelos.
  4. Respuesta:
     ```json
     { "prediction": {
         "Total de daños (millones de pesos)": 123.4,
         "Población afectada": 50000 } }
     ```
- `/health` reporta ambos modelos cargados y sus métricas.

## Frontend (`frontend/src/App.jsx`, `frontend/src/api.js`)

- Quitar la sección "Nivel de afectación reportado" (selects `Impacto_humano` y
  `Daños_a_infraestructura`) y los campos del `form`/payload/`limpiar`.
- Mostrar **dos tarjetas** de resultado: daño económico (como hoy) + población
  afectada estimada (formateada con separador de miles).
- El selector `Estado` mantiene `"Estado de México"` como etiqueta; la API lo
  normaliza a `"México"`.

## Limitaciones documentadas (fuera de alcance)

- Target en **pesos nominales** sin deflactar: `Año` absorbe algo de inflación.
  Mejora futura: deflactar a pesos constantes.
- Sin datos de **intensidad del evento** (categoría huracán, magnitud sismo,
  lluvia). Es el mayor techo de mejora, pero requiere fuentes externas
  (IBTrACS, CHIRPS/ERA5, USGS/SSN, Monitor de Sequía CONAGUA). Pospuesto.

## Criterios de aceptación

1. `train_model_simple.py` corre y genera los 6 artifacts sin error.
2. `metadata.json` contiene métricas temporales de ambos modelos.
3. `GET /health` muestra ambos modelos cargados.
4. `POST /predict` con el nuevo payload devuelve ambas predicciones ≥ 0.
5. El dashboard (`/stats/*`) sigue funcionando igual (data.joblib intacto).
6. El frontend envía el payload sin los campos post-evento y muestra ambos
   resultados.
