// ============================================================
// Tema visual y formato de números del dashboard
// ------------------------------------------------------------
// Un solo lugar define colores, métricas y formateadores. Las gráficas se
// escriben contra estos nombres (COLOR.serie, fmtCompacto...) y no contra
// hex sueltos, para que un cambio de paleta no obligue a tocar cada gráfica.
// ============================================================

// Paleta categórica validada para daltonismo (separación CVD ΔE 24.7 entre los
// dos primeros slots). No se generan colores nuevos: cuando una gráfica tiene
// más de dos categorías se usa UNA sola serie y la longitud de la barra —no el
// color— es lo que codifica la magnitud.
export const COLOR = {
  serie: "#2a78d6", // azul, slot categórico 1
  serieOscura: "#1c5cab", // el mismo azul, paso más oscuro: selección/énfasis
  serie2: "#eb6834", // naranja, slot categórico 2
  serie2Oscura: "#c14d22",

  texto: "#111827",
  textoSuave: "#52514e",
  textoTenue: "#9ca3af",

  superficie: "#ffffff",
  fondo: "#f3f4f6",
  rejilla: "#f3f4f6",
  eje: "#e5e7eb",
  borde: "#e5e7eb",
  neutro: "#f3f4f6", // relleno de "sin datos"
};

// Rampa secuencial de un solo tono (azul, claro → oscuro) para el mapa.
// Un solo tono es obligatorio en codificación de magnitud: un arcoíris haría
// que saltos de color no correspondan a saltos de valor.
export const RAMPA_SECUENCIAL = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#184f95",
  "#0d366b",
];

// ------------------------------------------------------------
// Métricas seleccionables
// ------------------------------------------------------------
// `campo` es la propiedad del evento que se suma. La métrica "eventos" no suma
// ningún campo: cuenta filas, y por eso lleva campo `null`.
export const METRICAS = [
  {
    clave: "daños",
    campo: "daños",
    etiqueta: "Daños económicos",
    corto: "Daños",
    unidad: "millones de pesos",
    prefijo: "$",
    sufijo: " M",
    decimales: 1,
  },
  {
    clave: "poblacion",
    campo: "poblacion",
    etiqueta: "Población afectada",
    corto: "Población",
    unidad: "personas",
    prefijo: "",
    sufijo: "",
    decimales: 0,
  },
  {
    clave: "defunciones",
    campo: "defunciones",
    etiqueta: "Defunciones",
    corto: "Defunciones",
    unidad: "personas",
    prefijo: "",
    sufijo: "",
    decimales: 0,
  },
  {
    clave: "viviendas",
    campo: "viviendas",
    etiqueta: "Viviendas dañadas",
    corto: "Viviendas",
    unidad: "viviendas",
    prefijo: "",
    sufijo: "",
    decimales: 0,
  },
  {
    clave: "eventos",
    campo: null,
    etiqueta: "Número de eventos",
    corto: "Eventos",
    unidad: "eventos",
    prefijo: "",
    sufijo: "",
    decimales: 0,
  },
];

export const metricaPorClave = (clave) =>
  METRICAS.find((m) => m.clave === clave) ?? METRICAS[0];

export const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export const MESES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ------------------------------------------------------------
// Formateadores
// ------------------------------------------------------------

/** Número completo con separador de millares en español de México. */
export function fmtNumero(valor, decimales = 0) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  return Number(valor).toLocaleString("es-MX", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Versión abreviada para ejes y etiquetas de barra, donde no cabe el número
 * completo. La unidad la nombra el título del eje, no esta función: para daños
 * "84.2 mil" se lee sobre un eje rotulado "millones de pesos".
 */
export function fmtCompacto(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  const abs = Math.abs(valor);
  if (abs >= 1e9) return `${(valor / 1e9).toFixed(1)} mil M`;
  if (abs >= 1e6) return `${(valor / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${(valor / 1e3).toFixed(abs >= 1e4 ? 0 : 1)} mil`;
  if (abs >= 10) return valor.toFixed(0);
  if (abs === 0) return "0";
  return valor.toFixed(1);
}

/** Valor con el prefijo y sufijo propios de la métrica ($ … M, etc.). */
export function fmtMetrica(valor, metrica, compacto = false) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  const cuerpo = compacto
    ? fmtCompacto(valor)
    : fmtNumero(valor, valor < 100 && metrica.decimales > 0 ? metrica.decimales : 0);
  return `${metrica.prefijo}${cuerpo}${metrica.sufijo}`;
}
