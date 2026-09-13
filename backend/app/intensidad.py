"""Escalas de intensidad del evento, compartidas por el entrenamiento y la API.

Este módulo es la única fuente de verdad de las categorías: si el entrenamiento y la API
las definieran por separado, bastaría con que una de las dos cambiara para que el modelo
recibiera un nivel distinto del que aprendió, sin que nada fallara de forma visible.

La intensidad se representa como un ORDINAL (1, 2, 3...), no como una categoría one-hot.
El motivo es que las clases altas de ciclón tienen muy pocos eventos (12, 11, 7 y 2), y con
one-hot el modelo las vuelve indistinguibles e incluso las invierte: llegaba a predecir menos
daño para un huracán categoría 5 que para una depresión tropical. Como ordinal, y con la
restricción de monotonía que aplica el entrenamiento, más intensidad nunca predice menos daño.
"""

from __future__ import annotations

TIPO_LLUVIAS = "Lluvias e Inundaciones"
TIPO_CICLONES = "Ciclones"
TIPOS = (TIPO_LLUVIAS, TIPO_CICLONES)

DESCONOCIDA = "Desconocida"
NIVEL_DESCONOCIDA = 0

# Saffir-Simpson sobre la velocidad máxima de viento sostenido (nudos), el estándar
# internacional. Cada entrada es (nivel ordinal, etiqueta, umbral inferior en nudos).
ESCALA_CICLONES = (
    (1, "Depresión tropical", 0),
    (2, "Tormenta tropical", 34),
    (3, "Huracán categoría 1", 64),
    (4, "Huracán categoría 2", 83),
    (5, "Huracán categoría 3", 96),
    (6, "Huracán categoría 4", 113),
    (7, "Huracán categoría 5", 137),
)

# Para lluvia no se usa la escala del SMN: aquella se define sobre milímetros en 24 horas y
# mm_CHIRPS es el acumulado de toda la ventana del evento. Un evento de diez días con 60 mm
# totales quedaría como "muy fuerte" cuando fueron 6 mm diarios. Se usan cuantiles del propio
# dataset, cuyos cortes calcula el entrenamiento y guarda como artefacto.
ETIQUETAS_LLUVIAS = ((1, "Baja"), (2, "Media"), (3, "Alta"))


def nivel_ciclon(viento_nudos: float | None) -> int:
    """Nivel Saffir-Simpson (1-7) para una velocidad de viento sostenido en nudos."""
    if viento_nudos is None or viento_nudos != viento_nudos:  # None o NaN
        return NIVEL_DESCONOCIDA
    nivel = NIVEL_DESCONOCIDA
    for n, _etiqueta, minimo in ESCALA_CICLONES:
        if viento_nudos >= minimo:
            nivel = n
    return nivel


def nivel_lluvia(mm: float | None, cortes: tuple[float, float]) -> int:
    """Nivel 1-3 para una lluvia acumulada, dados los dos cortes de cuantiles."""
    if mm is None or mm != mm:
        return NIVEL_DESCONOCIDA
    bajo, alto = cortes
    if mm < bajo:
        return 1
    if mm < alto:
        return 2
    return 3


def etiquetas_lluvia(cortes: tuple[float, float]) -> list[dict]:
    """Categorías de lluvia con su rango, para mostrarlas en el formulario."""
    bajo, alto = cortes
    rangos = (f"menos de {bajo:.1f} mm", f"{bajo:.1f} a {alto:.1f} mm", f"más de {alto:.1f} mm")
    return [
        {"nivel": nivel, "etiqueta": etiqueta, "rango": rango}
        for (nivel, etiqueta), rango in zip(ETIQUETAS_LLUVIAS, rangos)
    ]


def etiquetas_ciclon() -> list[dict]:
    """Categorías Saffir-Simpson con su rango de viento, para el formulario."""
    salida = []
    for i, (nivel, etiqueta, minimo) in enumerate(ESCALA_CICLONES):
        siguiente = ESCALA_CICLONES[i + 1][2] if i + 1 < len(ESCALA_CICLONES) else None
        rango = f"{minimo}-{siguiente - 1} nudos" if siguiente else f"{minimo}+ nudos"
        salida.append({"nivel": nivel, "etiqueta": etiqueta, "rango": rango})
    return salida


def opciones(cortes_lluvia: tuple[float, float]) -> dict[str, list[dict]]:
    """Catálogo completo de intensidades por tipo, tal y como lo sirve GET /intensidades."""
    desconocida = {"nivel": NIVEL_DESCONOCIDA, "etiqueta": DESCONOCIDA, "rango": "sin dato"}
    return {
        TIPO_LLUVIAS: etiquetas_lluvia(cortes_lluvia) + [desconocida],
        TIPO_CICLONES: etiquetas_ciclon() + [desconocida],
    }


def nivel_desde_etiqueta(tipo: str, etiqueta: str, cortes_lluvia: tuple[float, float]) -> int:
    """Traduce la etiqueta que eligió el usuario al ordinal que espera el modelo."""
    if etiqueta == DESCONOCIDA:
        return NIVEL_DESCONOCIDA
    for opcion in opciones(cortes_lluvia).get(tipo, []):
        if opcion["etiqueta"] == etiqueta:
            return opcion["nivel"]
    raise ValueError(f"Intensidad '{etiqueta}' no es válida para el tipo '{tipo}'")
