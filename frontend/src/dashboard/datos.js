// ============================================================
// Carga de datos del dashboard
// ------------------------------------------------------------
// Dos peticiones al arrancar y ninguna más: el catálogo de filtros y el dataset
// completo de eventos. A partir de ahí el dashboard trabaja sin red.
// ============================================================

const API = import.meta.env.VITE_API_URL;

/**
 * El endpoint devuelve las filas como arreglos (`[2017, 9, "Oaxaca", ...]`) para
 * no repetir los nombres de las 14 columnas 3,958 veces. Aquí se rehidratan a
 * objetos: cuesta unos milisegundos una sola vez y a cambio el resto del código
 * se lee como `e.estado` en lugar de `fila[2]`.
 */
function aObjetos({ columnas, filas }) {
  return filas.map((fila) => {
    const evento = {};
    for (let i = 0; i < columnas.length; i++) evento[columnas[i]] = fila[i];
    return evento;
  });
}

async function pedir(ruta) {
  const respuesta = await fetch(`${API}${ruta}`);
  if (!respuesta.ok) throw new Error(`${ruta} respondió ${respuesta.status}`);
  const cuerpo = await respuesta.json();
  if (cuerpo?.error) throw new Error(cuerpo.error);
  return cuerpo;
}

export async function cargarDashboard() {
  const [dimensiones, eventos] = await Promise.all([
    pedir("/stats/dimensiones"),
    pedir("/stats/eventos"),
  ]);

  return { dimensiones, eventos: aObjetos(eventos) };
}

/** Exporta a CSV lo que el usuario tiene filtrado en pantalla. */
export function descargarCSV(eventos, nombre = "eventos-filtrados.csv") {
  if (!eventos.length) return;

  const columnas = Object.keys(eventos[0]);
  const escapar = (v) => {
    if (v === null || v === undefined) return "";
    const texto = String(v);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const csv = [
    columnas.join(","),
    ...eventos.map((e) => columnas.map((c) => escapar(e[c])).join(",")),
  ].join("\n");

  // El BOM hace que Excel abra el archivo con los acentos correctos.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}
