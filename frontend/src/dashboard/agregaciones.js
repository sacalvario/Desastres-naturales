// ============================================================
// Filtrado y agregación en memoria
// ------------------------------------------------------------
// El backend manda los 3,958 eventos una sola vez (~40 KB comprimidos) y todo
// el cálculo del dashboard ocurre aquí, en el navegador. Eso es lo que permite
// que un clic en un estado o un arrastre sobre los años reordene todas las
// gráficas al instante, sin esperar al servidor.
//
// Todas las funciones de este módulo son puras: reciben datos y devuelven datos
// nuevos, sin tocar el estado de React. Así se pueden memorizar con useMemo y,
// llegado el caso, probar sin montar un componente.
// ============================================================

/** Filtro vacío: el estado inicial y también el destino del botón "Limpiar". */
export function filtroInicial(dimensiones) {
  return {
    añoMin: dimensiones?.años?.min ?? 2000,
    añoMax: dimensiones?.años?.max ?? 2023,
    estados: [],
    clasificaciones: [],
    tipos: [],
    meses: [],
    busqueda: "",
  };
}

/** ¿El filtro está en su estado neutro? Sirve para deshabilitar "Limpiar". */
export function filtroVacio(filtro, dimensiones) {
  const base = filtroInicial(dimensiones);
  return (
    filtro.añoMin === base.añoMin &&
    filtro.añoMax === base.añoMax &&
    filtro.estados.length === 0 &&
    filtro.clasificaciones.length === 0 &&
    filtro.tipos.length === 0 &&
    filtro.meses.length === 0 &&
    filtro.busqueda.trim() === ""
  );
}

/**
 * Aplica el filtro a los eventos.
 *
 * `omitir` excluye una dimensión del filtrado, y es lo que hace que el tablero
 * se comporte como un filtro cruzado de verdad: **cada gráfica ignora su propio
 * filtro**.
 *
 * Sin esa regla, seleccionar "Ciclones" dejaría al ranking de fenómenos con una
 * sola barra y al reparto por clasificación con un único 100%: dos gráficas que
 * ya no comparan nada. Con ella, el ranking sigue mostrando los nueve fenómenos
 * —recortados por año, estado y mes— y marca el seleccionado. Lo mismo aplica al
 * mapa y al ranking de estados con `"estados"`, y a la estacionalidad con
 * `"meses"`.
 *
 * El rango de años nunca se omite: es un acotamiento del periodo que se está
 * mirando, no una categoría que se compare contra sus hermanas.
 */
export function filtrar(eventos, filtro, omitir = null) {
  const texto = filtro.busqueda.trim().toLowerCase();

  return eventos.filter((e) => {
    if (e.año < filtro.añoMin || e.año > filtro.añoMax) return false;
    if (omitir !== "estados" && filtro.estados.length && !filtro.estados.includes(e.estado)) return false;
    if (omitir !== "clasificaciones" && filtro.clasificaciones.length && !filtro.clasificaciones.includes(e.clasificacion)) return false;
    if (omitir !== "tipos" && filtro.tipos.length && !filtro.tipos.includes(e.tipo)) return false;
    if (omitir !== "meses" && filtro.meses.length && !filtro.meses.includes(e.mes)) return false;
    if (texto && !`${e.estado} ${e.tipo} ${e.clasificacion}`.toLowerCase().includes(texto)) return false;
    return true;
  });
}

/** Suma la métrica sobre un conjunto de eventos (o los cuenta, si es "eventos"). */
export function totalDe(eventos, metrica) {
  if (metrica.campo === null) return eventos.length;
  let suma = 0;
  for (const e of eventos) suma += e[metrica.campo] ?? 0;
  return suma;
}

/**
 * Agrupa por una propiedad y devuelve `[{ llave, valor, eventos }]`.
 * `orden`: "valor" (descendente, para rankings) o "llave" (ascendente, para
 * series temporales, donde reordenar por magnitud rompería la lectura).
 */
export function agrupar(eventos, propiedad, metrica, orden = "valor") {
  const acumulado = new Map();

  for (const e of eventos) {
    const llave = e[propiedad];
    if (llave === null || llave === undefined) continue;
    const previo = acumulado.get(llave) ?? { llave, valor: 0, eventos: 0 };
    previo.valor += metrica.campo === null ? 1 : (e[metrica.campo] ?? 0);
    previo.eventos += 1;
    acumulado.set(llave, previo);
  }

  const filas = [...acumulado.values()];
  return orden === "llave"
    ? filas.sort((a, b) => (a.llave > b.llave ? 1 : -1))
    : filas.sort((a, b) => b.valor - a.valor);
}

/**
 * Serie anual continua: incluye los años sin eventos como cero.
 *
 * Sin este relleno la gráfica de líneas uniría 2003 con 2006 en un solo tramo y
 * daría a entender que hubo datos en medio.
 */
export function serieAnual(eventos, metrica, añoMin, añoMax, agregacion = "suma") {
  const porAño = new Map();
  for (const e of eventos) {
    if (!porAño.has(e.año)) porAño.set(e.año, []);
    porAño.get(e.año).push(metrica.campo === null ? 1 : (e[metrica.campo] ?? 0));
  }

  const serie = [];
  for (let año = añoMin; año <= añoMax; año++) {
    const valores = porAño.get(año) ?? [];
    serie.push({
      año,
      valor: agregacion === "mediana" ? mediana(valores) : valores.reduce((a, b) => a + b, 0),
      eventos: valores.length,
    });
  }
  return serie;
}

/** Serie de 12 meses, siempre completa, para el patrón estacional. */
export function serieMensual(eventos, metrica) {
  const acumulado = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    valor: 0,
    eventos: 0,
  }));

  for (const e of eventos) {
    const celda = acumulado[e.mes - 1];
    if (!celda) continue;
    celda.valor += metrica.campo === null ? 1 : (e[metrica.campo] ?? 0);
    celda.eventos += 1;
  }
  return acumulado;
}

export function mediana(valores) {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2
    ? ordenados[medio]
    : (ordenados[medio - 1] + ordenados[medio]) / 2;
}

// Cortes del histograma de magnitud. Son potencias de diez porque los daños
// abarcan siete órdenes de magnitud (de 0 a 84,207 millones): en una escala
// lineal el 73% de los eventos se apilaría en la primera barra y no se vería
// nada. Esta misma asimetría es la razón por la que el modelo entrena sobre
// log1p del objetivo en vez de sobre el valor crudo.
const CORTES = [0, 0.1, 1, 10, 100, 1000, 10000, Infinity];
const ETIQUETAS_CORTES = [
  "0",
  "0 – 0.1",
  "0.1 – 1",
  "1 – 10",
  "10 – 100",
  "100 – 1 mil",
  "1 mil – 10 mil",
  "> 10 mil",
];

/**
 * Reparte los eventos en bandas logarítmicas de daño.
 * El cero vive en su propia banda: log(0) no existe y además "no hubo daño
 * económico registrado" es una categoría distinta de "hubo poco".
 */
export function histogramaMagnitud(eventos, campo = "daños") {
  const cubetas = ETIQUETAS_CORTES.map((etiqueta) => ({ etiqueta, eventos: 0 }));

  for (const e of eventos) {
    const v = e[campo] ?? 0;
    if (v === 0) {
      cubetas[0].eventos += 1;
      continue;
    }
    for (let i = 0; i < CORTES.length - 1; i++) {
      if (v > CORTES[i] && v <= CORTES[i + 1]) {
        cubetas[i + 1].eventos += 1;
        break;
      }
    }
  }
  return cubetas;
}

/** KPIs de cabecera para el conjunto filtrado. */
export function resumen(eventos) {
  const daños = eventos.reduce((s, e) => s + (e.daños ?? 0), 0);
  const valoresDaño = eventos.map((e) => e.daños ?? 0);

  return {
    eventos: eventos.length,
    daños,
    medianaDaños: mediana(valoresDaño),
    poblacion: eventos.reduce((s, e) => s + (e.poblacion ?? 0), 0),
    defunciones: eventos.reduce((s, e) => s + (e.defunciones ?? 0), 0),
    viviendas: eventos.reduce((s, e) => s + (e.viviendas ?? 0), 0),
    estados: new Set(eventos.map((e) => e.estado)).size,
  };
}

/** Alterna un valor dentro de un arreglo de selección (clic para filtrar). */
export function alternar(lista, valor) {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}
