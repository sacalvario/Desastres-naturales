# Rediseño del predictor: intensidad del evento y modelos por tipo

**Fecha:** 2026-09-13
**Estado:** aprobado, pendiente de implementación

## Por qué

El predictor actual estima el daño económico con cinco variables ex-ante: clasificación,
tipo de fenómeno, estado, año y mes. Al evaluarlo contra líneas base aprendidas solo con
los datos de entrenamiento (`<2020`) y medidas sobre el mismo conjunto de prueba (`>=2020`),
aparece el problema que motiva este rediseño:

| predictor | R²_log | MAE (millones) |
|---|---|---|
| media global | -0.0521 | 204.14 |
| **media por tipo de fenómeno** | **+0.2760** | **201.51** |
| media por tipo × estado | +0.1804 | 216.75 |
| modelo entregado | +0.1649 | 209.10 |

Una regla de una línea —predecir el promedio histórico del tipo de fenómeno— gana al modelo
en ambas métricas. La descomposición por tipo explica por qué: el modelo tiene R² negativo
dentro de seis de los ocho tipos, es decir, no supera al promedio de su propio grupo.

| tipo | n | R²_log dentro del grupo |
|---|---|---|
| Lluvias e Inundaciones | 435 | -0.1476 |
| Calor Extremo | 93 | -2.6859 |
| Frío Extremo | 60 | +0.0978 |
| Ciclones | 51 | -0.2437 |
| Movimientos de Masa | 45 | +0.0335 |
| Viento Extremo | 28 | -2.0468 |
| Sismos | 14 | -1.7582 |
| Sequía | 6 | -0.2813 |

Conclusión: con las variables actuales el techo del modelo es distinguir tipos de fenómeno.
Para subir de ahí hace falta saber **qué tan fuerte fue el evento**, y esa es la variable que
introduce este rediseño.

## Alcance

1. Restringir el dominio a Lluvias e Inundaciones y Ciclones, quitando los eventos térmicos.
2. Añadir una variable de intensidad por tipo, derivada de los datos físicos ya integrados.
3. Sustituir el modelo único por dos modelos especializados, uno por tipo.
4. Eliminar por completo el modelo B (población afectada).
5. Permitir que el usuario elija la intensidad en el formulario de predicción.

Fuera de alcance: los endpoints `/stats/*` y el dashboard, que pertenecen a otro frente de
trabajo.

## Datos

Fuente: `Base_unificada_bueno.xlsx`, que integra el registro de desastres con tres variables
físicas. Al quitar los 705 eventos térmicos quedan **2 683 filas**: 2 441 lluvias y 242 ciclones.

Las variables físicas son **estructuralmente disjuntas**: ninguna fila tiene lluvia y viento a
la vez. `mm_CHIRPS` existe solo para lluvias (99.8 % de ellas) y `WMO_WIND`/`WMO_PRES` solo para
ciclones (92.1 %). Este hecho determina la arquitectura: en un modelo único, `WMO_PRES` estaría
ausente en el 91.7 % de las filas y competiría por profundidad del árbol sin informar.

### Higiene obligatoria

El archivo trae defectos que fallan en silencio si no se tratan en la carga:

- Nombres de columna con espacio final: `'Población afectada '`, `'Hospitales '`.
- Valores de estado con espacio final: `'Campeche '` (48 filas), `'Ciudad de México '` (68).
  Sin normalizar, el one-hot los toma como categorías nuevas y el join con `mexico.geojson`
  los pintaría de gris.
- `Clasificación del fenómeno` es constante (todo Hidrometeorológico): se elimina de las
  features porque no aporta información.
- Ocho celdas del objetivo son texto (`'SD'`, `'sd'`, `'NSR'`): se convierten a nulo y se
  descartan.

## Intensidad

Una escala ordinal por tipo, con el estándar donde existe y cuantiles donde no.

**Ciclones — Saffir-Simpson sobre `WMO_WIND`** (nudos), el estándar internacional:

| nivel | categoría | umbral | eventos |
|---|---|---|---|
| 1 | Depresión tropical | < 34 | 82 |
| 2 | Tormenta tropical | 34-63 | 71 |
| 3 | Huracán categoría 1 | 64-82 | 38 |
| 4 | Huracán categoría 2 | 83-95 | 12 |
| 5 | Huracán categoría 3 | 96-112 | 11 |
| 6 | Huracán categoría 4 | 113-136 | 7 |
| 7 | Huracán categoría 5 | >= 137 | 2 |

**Lluvias — cuantiles de `mm_CHIRPS`**, porque es lluvia acumulada de toda la ventana del
evento y no le corresponde la escala oficial del SMN, definida sobre mm en 24 horas:

| nivel | categoría | umbral | eventos |
|---|---|---|---|
| 1 | Baja | < 4.47 mm | 812 |
| 2 | Media | 4.47-13.54 mm | 812 |
| 3 | Alta | > 13.54 mm | 813 |

Los cortes de lluvia se calculan una vez en el entrenamiento y se guardan como artefacto, para
que la API clasifique con los mismos umbrales con los que se entrenó.

Los 22 eventos sin dato de intensidad (0.8 %) reciben la categoría `Desconocida`, disponible
también en el formulario para el usuario que no conoce la intensidad.

### Ordinal con monotonía forzada

La intensidad entra como **variable numérica ordinal**, no como one-hot, y el modelo se entrena
con `monotonic_cst` para forzar que a mayor intensidad nunca corresponda menor daño predicho.

La restricción no es cosmética. Sin ella, el modelo produce esto al mover solo la categoría
(Guerrero, septiembre), porque las clases altas tienen 12, 11, 7 y 2 eventos:

| | Dep | Trop | Cat 1 | Cat 2 | Cat 3 | Cat 4 | Cat 5 |
|---|---|---|---|---|---|---|---|
| one-hot | 0.38 | 0.48 | 0.42 | 0.33 | 0.33 | 0.33 | 0.33 |
| ordinal sin restricción | 83 | 150 | 304 | 955 | 500 | 266 | 130 |
| **ordinal con monotonía** | **105** | **291** | **550** | **972** | **972** | **972** | **972** |

En las dos primeras filas un huracán categoría 5 predice menos daño que una depresión tropical.
La monotonía cuesta 0.004 de R² y elimina esa contradicción: satura a partir de categoría 2,
que es lo honesto cuando no hay datos para separarlas, pero nunca contradice la física.

## Modelos

Dos `HistGradientBoostingRegressor`, uno por tipo, cada uno con su variable de intensidad
completa y su propio preprocesador ajustado sobre sus propias filas.

| modelo | filas | features |
|---|---|---|
| lluvias | 2 441 | Estado (one-hot) · Año · mes_sin · mes_cos · Población estatal · intensidad |
| ciclones | 242 | Estado (one-hot) · Año · mes_sin · mes_cos · Población estatal · intensidad · WMO_PRES |

Medido con validación de cinco cortes temporales: dos modelos dan R² medio **0.1455** frente a
**0.1272** del modelo único.

Cada modelo guarda su preprocesador junto a él. El diseño actual ajusta dos preprocesadores y
descarta el de población, sirviendo ambos modelos con uno solo; hoy funciona porque las
categorías coinciden, pero es una dependencia accidental que este rediseño elimina.

### Honestidad sobre el modelo de ciclones

242 filas son pocas, y el conjunto de prueba de una validación temporal queda en unas decenas.
Su métrica se reporta con la advertencia explícita de que el intervalo es amplio. Se conserva
porque la alternativa —no predecir ciclones— es peor, y porque la monotonía garantiza que su
comportamiento sea coherente aunque su precisión sea baja.

## API

`POST /predict` acepta dos campos nuevos y devuelve una sola métrica:

```
{ "Año", "Mes", "Tipo_de_fenómeno", "Estado",
  "intensidad": "Huracán categoría 3",
  "WMO_PRES": 960 }

→ { "prediction": { "Total de daños (millones de pesos)": 1234.5 },
    "modelo": "ciclones" }
```

- `Clasificación_del_fenómeno` desaparece de la entrada: era constante.
- `WMO_PRES` es opcional y solo se usa en el modelo de ciclones.
- Desaparece `"Población afectada"` de la respuesta.
- `GET /intensidades` nuevo: devuelve las categorías válidas por tipo, para que el frontend no
  las lleve escritas a mano.
- `/health` deja de reportar `model_poblacion_loaded` y pasa a reportar un modelo por tipo.

## Frontend

- El selector de intensidad se muestra condicionado al tipo elegido, con las opciones que
  devuelve `GET /intensidades`.
- El campo de presión aparece solo para ciclones.
- El selector de tipo de fenómeno se reduce a Lluvias e Inundaciones y Ciclones.
- Se elimina la entrada `"Población afectada"` del registro `ESCALAS` de `App.jsx`: las
  tarjetas se generan a partir de la respuesta, pero el esqueleto de la primera carga sale de
  ese registro y mostraría una tarjeta que nunca llega.
- Las bandas y la rejilla ECDF de la escala de impacto se recalculan contra el dataset nuevo.

## Qué se elimina

`model_poblacion.joblib`, `TARGET_POBL`, su evaluación temporal, su entrada en `metadata.json`,
su flag en `/health` y su renderizado en el frontend.

## Verificación

1. Validación de cinco cortes temporales (2017-2021), no un solo split: el R² de este proyecto
   oscila entre 0.01 y 0.24 según dónde se corte, así que una cifra única no es evidencia.
2. Comparación contra la línea base por tipo, que es la que hay que batir.
3. Prueba de monotonía: recorrer las categorías de cada tipo y comprobar que la predicción
   nunca decrece. Automatizada, porque es el fallo que llegaría a la demo.
4. `npm run lint`, `npm run build` y el arranque real de la API con una predicción de extremo
   a extremo.

## Riesgos asumidos

- **El R² global bajará** respecto al 0.1912 medido sobre el dataset con eventos térmicos.
  No es degradación del modelo: desaparecen los eventos térmicos, que son fáciles de predecir
  e inflaban la cifra. Sobre los mismos eventos de prueba, el rediseño mejora de 0.1101 a
  0.1272.
- **El modelo deja de ser ex-ante puro.** El proyecto conserva el nombre "ex-ante", que sigue
  siendo correcto respecto al daño, pero con la aclaración de la sección siguiente.
- El dashboard queda restringido a los mismos dos tipos, por decisión de coherencia del
  proyecto. Eso saca del panel histórico los eventos geológicos, incluidos los sismos de 2017.

## Qué significa "ex-ante" a partir de este rediseño

El proyecto conserva el nombre, porque el modelo sigue sin ver ninguna consecuencia del daño.
Pero "ex-ante" deja de ser una sola cosa: las variables se reparten en tres niveles, y cada una
está en un sitio distinto.

| nivel | variables | por qué |
|---|---|---|
| **Fuga** | `Daños a infraestructura`, `Impacto humano` | Son componentes del objetivo. Conocerlas equivale a conocer parte de la respuesta. Excluidas. |
| **Ex-ante respecto al daño** | categoría de ciclón, derivada de `WMO_WIND` | Causa física, no consecuencia. El viento máximo sostenido se pronostica 24-72 horas antes de que el ciclón toque tierra, que es justo cuando la estimación sirve para algo. |
| **Contemporánea al daño** | categoría de lluvia, derivada de `mm_CHIRPS` | Causa física, tampoco consecuencia, pero es el acumulado de la ventana `[Fecha de Inicio, Fecha de Fin]`: se mide cuando el evento terminó. Y el 79.1 % de las lluvias duran un solo día, así que la lluvia y el daño ocurren en la misma ventana. |

La distinción no es retórica: la primera categoría invalidaría el modelo, la segunda permite
predecir de verdad y la tercera solo permite explicar o simular escenarios.

Las métricas apuntan en el mismo sentido. El modelo cuya variable de intensidad es genuinamente
anticipatoria —ciclones— supera su línea base (+0.0467 frente a -0.0110); el de lluvias, cuya
intensidad es contemporánea, no la supera (-0.1376 frente a -0.0671).

Consecuencia práctica para quien use el predictor: pedirle la intensidad al usuario cambia el
caso de uso. Con ciclones sirve para anticipar un evento pronosticado; con lluvias sirve para
estimar el costo de un episodio ya ocurrido o para simular uno hipotético, no para planeación a
meses vista.
