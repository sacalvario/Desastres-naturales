// ============================================================
// Pruebas de las agregaciones del dashboard
// ------------------------------------------------------------
// El proyecto no tiene suite de pruebas. Este archivo cubre la parte donde un
// error pasaría inadvertido: el filtrado y la agregación en el navegador. No
// usa datos inventados, sino los 3,958 eventos que sirve la API, y compara
// contra totales calculados aparte con pandas.
//
//   npm run prueba:agregaciones          (API en el puerto 8001)
//   VITE_API_URL=http://127.0.0.1:8002 npm run prueba:agregaciones
//
// Sale con código 1 si algo falla, así que sirve en CI.
// ============================================================
import { filtrar, filtroInicial, filtroVacio, agrupar, serieAnual, serieMensual,
         histogramaMagnitud, resumen, alternar, mediana } from "../src/dashboard/agregaciones.js";

const API = process.env.VITE_API_URL ?? "http://127.0.0.1:8001";
const dim = await (await fetch(`${API}/stats/dimensiones`)).json();
const cru = await (await fetch(`${API}/stats/eventos`)).json();
const eventos = cru.filas.map((f) => Object.fromEntries(cru.columnas.map((c, i) => [c, f[i]])));

let fallos = 0;
const chk = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${ok ? "" : ` -> obtuve ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`}`);
};

const f0 = filtroInicial(dim);
chk("filtro inicial no filtra nada", filtrar(eventos, f0).length, 3958);
chk("filtro inicial se reconoce vacio", filtroVacio(f0, dim), true);

// --- Filtro por estado
const fVer = { ...f0, estados: ["Veracruz"] };
chk("Veracruz -> 392 eventos", filtrar(eventos, fVer).length, 392);
chk("omitir 'estados' devuelve el pais completo", filtrar(eventos, fVer, "estados").length, 3958);

// --- Filtro cruzado: cada gráfica ignora su propia dimensión
const fCiclones = { ...f0, tipos: ["Ciclones"] };
chk("Ciclones -> 241 eventos", filtrar(eventos, fCiclones).length, 241);
chk("omitir 'tipos' devuelve los 3,958", filtrar(eventos, fCiclones, "tipos").length, 3958);
chk("con Ciclones el ranking de fenomenos conserva los 9 tipos",
    agrupar(filtrar(eventos, fCiclones, "tipos"), "tipo", { campo: null }).length, 9);
chk("sin omitir, el ranking colapsaria a 1 barra",
    agrupar(filtrar(eventos, fCiclones), "tipo", { campo: null }).length, 1);

const fSepOmitir = { ...f0, meses: [9] };
chk("omitir 'meses' devuelve los 3,958", filtrar(eventos, fSepOmitir, "meses").length, 3958);
chk("con septiembre la estacionalidad conserva 12 meses con datos",
    serieMensual(filtrar(eventos, fSepOmitir, "meses"), { campo: null }).filter((m) => m.eventos > 0).length, 12);

const fGeo = { ...f0, clasificaciones: ["Geológico"] };
chk("omitir 'clasificaciones' devuelve los 3,958", filtrar(eventos, fGeo, "clasificaciones").length, 3958);
chk("el filtro cruzado si respeta las OTRAS dimensiones",
    filtrar(eventos, { ...fCiclones, estados: ["Veracruz"] }, "tipos").length, 392);

// --- Filtro combinado
const fComb = { ...f0, estados: ["Veracruz"], tipos: ["Ciclones"] };
const comb = filtrar(eventos, fComb);
chk("Veracruz + Ciclones: todos cumplen", comb.every((e) => e.estado === "Veracruz" && e.tipo === "Ciclones"), true);
console.log(`     (Veracruz + Ciclones = ${comb.length} eventos)`);

// --- Rango de años
const f2020 = { ...f0, añoMin: 2020, añoMax: 2023 };
const r2020 = filtrar(eventos, f2020);
chk("rango 2020-2023 respeta los limites", r2020.every((e) => e.año >= 2020 && e.año <= 2023), true);
console.log(`     (2020-2023 = ${r2020.length} eventos)`);

// --- Meses
const fSep = { ...f0, meses: [9] };
chk("septiembre -> 684 eventos", filtrar(eventos, fSep).length, 684);

// --- Clasificación
chk("Geologico -> 302 eventos", filtrar(eventos, { ...f0, clasificaciones: ["Geológico"] }).length, 302);

// --- Agregaciones
const mDanos = { clave: "daños", campo: "daños", corto: "Daños" };
const mEventos = { clave: "eventos", campo: null, corto: "Eventos" };

const porEstado = agrupar(eventos, "estado", mDanos);
chk("32 estados agrupados", porEstado.length, 32);
chk("ranking ordenado descendente", porEstado.every((d, i) => i === 0 || porEstado[i-1].valor >= d.valor), true);
console.log(`     (1o: ${porEstado[0].llave} con ${porEstado[0].valor.toFixed(0)} M)`);

const sumaTotal = porEstado.reduce((s, d) => s + d.valor, 0);
chk("la suma por estado cuadra con el total (668,035.68)", Math.abs(sumaTotal - 668035.68) < 0.5, true);

const conteo = agrupar(eventos, "tipo", mEventos);
chk("el conteo por tipo suma 3958", conteo.reduce((s, d) => s + d.valor, 0), 3958);
chk("9 tipos de fenomeno", conteo.length, 9);

// --- Serie anual: rellena huecos y ordena
const sa = serieAnual(eventos, mDanos, 2000, 2023, "suma");
chk("serie anual tiene 24 puntos", sa.length, 24);
chk("serie anual ordenada por año", sa.every((d, i) => i === 0 || sa[i-1].año < d.año), true);
chk("los eventos de la serie anual suman 3958", sa.reduce((s, d) => s + d.eventos, 0), 3958);

const saHueco = serieAnual(filtrar(eventos, fSep), mDanos, 2000, 2023, "suma");
chk("serie anual filtrada sigue teniendo 24 puntos (rellena ceros)", saHueco.length, 24);

// --- Serie mensual siempre 12
const sm = serieMensual(eventos, mEventos);
chk("serie mensual tiene 12 meses", sm.length, 12);
chk("septiembre es el mes con mas eventos", sm.reduce((m, d) => d.eventos > m.eventos ? d : m).mes, 9);
chk("los meses suman 3958", sm.reduce((s, d) => s + d.eventos, 0), 3958);

// --- Histograma
const h = histogramaMagnitud(eventos);
chk("el histograma reparte los 3958 eventos", h.reduce((s, c) => s + c.eventos, 0), 3958);
chk("banda cero = 1065", h[0].eventos, 1065);
chk("cola > 10 mil = 12", h[h.length-1].eventos, 12);

// --- Resumen / KPIs
const res = resumen(eventos);
chk("KPI eventos", res.eventos, 3958);
chk("KPI estados", res.estados, 32);
chk("KPI defunciones", res.defunciones, 4697);
chk("KPI daños cuadra", Math.abs(res.daños - 668035.68) < 0.5, true);
console.log(`     (mediana de daño = ${res.medianaDaños} M · promedio = ${(res.daños/res.eventos).toFixed(1)} M)`);

// --- Alternar (clic para filtrar)
chk("alternar agrega", alternar(["a"], "b"), ["a", "b"]);
chk("alternar quita", alternar(["a", "b"], "a"), ["b"]);
chk("mediana de lista par", mediana([1, 2, 3, 4]), 2.5);
chk("mediana de lista vacia", mediana([]), 0);

// --- Filtro que no deja nada: las graficas no deben reventar
const vacio = filtrar(eventos, { ...f0, estados: ["Yucatán"], tipos: ["Sismos"] });
chk("combinacion imposible da 0 eventos", vacio.length, 0);
chk("resumen de 0 eventos no revienta", resumen(vacio).eventos, 0);
chk("histograma de 0 eventos suma 0", histogramaMagnitud(vacio).reduce((s,c)=>s+c.eventos,0), 0);

console.log(fallos === 0 ? "\n== TODAS LAS PRUEBAS PASAN ==" : `\n== ${fallos} FALLAS ==`);
process.exit(fallos ? 1 : 0);
