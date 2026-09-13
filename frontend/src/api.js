const API_URL = import.meta.env.VITE_API_URL;

export async function predict(payload) {
  const res = await fetch(`${API_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${text}`);
  }

  // { prediction: { "Total de daños (millones de pesos)": x },
  //   modelo: "Ciclones", intensidad_usada: "Huracán categoría 3" }
  return res.json();
}

/**
 * Categorías de intensidad válidas por tipo de fenómeno.
 *
 * Se piden al backend en vez de escribirlas en el frontend porque los cortes de
 * lluvia son cuantiles del conjunto de entrenamiento: si se reentrena con otros
 * datos, los rangos cambian y una copia local quedaría mintiendo.
 *
 * Devuelve { "Lluvias e Inundaciones": [{nivel, etiqueta, rango}, ...], ... }
 */
export async function intensidades() {
  const res = await fetch(`${API_URL}/intensidades`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.tipos ?? {};
}
