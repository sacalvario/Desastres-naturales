// ============================================================
// Dashboard Histórico — desastres naturales en México
// ------------------------------------------------------------
// Un solo estado de filtro gobierna todo lo que se ve. Cada gráfica es a la vez
// una salida (muestra datos) y una entrada (clic para filtrar): al pulsar un
// estado del mapa, una barra de fenómeno o un mes, el resto del tablero se
// recalcula al instante. Eso es posible porque los 3,958 eventos se descargan
// una sola vez y toda la agregación ocurre en el navegador.
//
// Reparto de responsabilidades:
//   datos.js         carga y exportación
//   agregaciones.js  filtrado y agregación (funciones puras)
//   tema.js          paleta, métricas y formato de números
//   Controles.jsx    barra de filtros
//   Graficas.jsx     serie anual, rankings, estacionalidad, histograma
//   Mapa.jsx         coroplético interactivo
//   Tabla.jsx        detalle evento por evento
//   este archivo     composición y estado compartido
// ============================================================

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";

import "./dashboard/dashboard.css";
import { cargarDashboard } from "./dashboard/datos";
import { COLOR, metricaPorClave, fmtNumero } from "./dashboard/tema";
import {
  agrupar,
  alternar,
  filtrar,
  filtroInicial,
  filtroVacio,
  histogramaMagnitud,
  resumen,
  serieAnual,
  serieMensual,
} from "./dashboard/agregaciones";
import { Controles } from "./dashboard/Controles";
import {
  BarraProporcion,
  BarrasHorizontales,
  GraficaAnual,
  GraficaEstacional,
  Histograma,
} from "./dashboard/Graficas";
import { Mapa } from "./dashboard/Mapa";
import { Tabla } from "./dashboard/Tabla";

// ------------------------------------------------------------
// Piezas de presentación
// ------------------------------------------------------------

function Tarjeta({ titulo, ayuda, children, acciones }) {
  return (
    <div
      style={{
        background: COLOR.superficie,
        borderRadius: 14,
        padding: "18px 22px 20px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
        border: `1px solid ${COLOR.borde}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          borderBottom: `1px solid ${COLOR.rejilla}`,
          paddingBottom: 10,
          marginBottom: 15,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: COLOR.texto }}>{titulo}</h3>
          {ayuda && (
            <p style={{ margin: "3px 0 0", fontSize: 11.5, color: COLOR.textoTenue, lineHeight: 1.45 }}>
              {ayuda}
            </p>
          )}
        </div>
        {acciones}
      </div>
      {children}
    </div>
  );
}

Tarjeta.propTypes = {
  titulo: PropTypes.node.isRequired,
  ayuda: PropTypes.node,
  children: PropTypes.node,
  acciones: PropTypes.node,
};

/**
 * Tarjeta de KPI. Cuando hay filtros activos muestra además qué porcentaje del
 * total nacional representa el recorte: sin esa referencia un número filtrado
 * se puede leer como si fuera el total.
 */
function KPI({ etiqueta, valor, nota, porcentaje }) {
  return (
    <div
      style={{
        background: COLOR.superficie,
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
        border: `1px solid ${COLOR.borde}`,
        flex: "1 1 180px",
        minWidth: 0,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10.5,
          color: COLOR.textoSuave,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {etiqueta}
      </p>
      {/* Cifras proporcionales, no tabulares: a tamaño grande el ancho fijo de
          dígito deja los números sueltos. */}
      <p style={{ margin: "7px 0 0", fontSize: 25, fontWeight: 800, color: COLOR.texto, lineHeight: 1.15 }}>
        {valor}
      </p>
      <p style={{ margin: "3px 0 0", fontSize: 11, color: COLOR.textoTenue }}>
        {nota}
        {porcentaje !== null && porcentaje !== undefined && (
          <span style={{ color: COLOR.serieOscura, fontWeight: 700 }}>
            {" · "}{porcentaje.toFixed(1)}% del total
          </span>
        )}
      </p>
    </div>
  );
}

KPI.propTypes = {
  etiqueta: PropTypes.string.isRequired,
  valor: PropTypes.node.isRequired,
  nota: PropTypes.string,
  porcentaje: PropTypes.number,
};

function Aviso({ tono, children }) {
  const paleta = {
    error: { fondo: "#fef2f2", borde: "#fecaca", texto: "#991b1b" },
    info: { fondo: "#eff6ff", borde: "#bfdbfe", texto: "#1e40af" },
  }[tono];

  return (
    <div
      style={{
        background: paleta.fondo,
        border: `1px solid ${paleta.borde}`,
        color: paleta.texto,
        borderRadius: 12,
        padding: "13px 17px",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  );
}

Aviso.propTypes = { tono: PropTypes.string.isRequired, children: PropTypes.node };

// ============================================================
// DASHBOARD
// ============================================================
export default function DashboardHistorico() {
  const [eventos, setEventos] = useState([]);
  const [dimensiones, setDimensiones] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [filtro, setFiltro] = useState(() => filtroInicial(null));
  const [metricaClave, setMetricaClave] = useState("daños");
  const [agregacion, setAgregacion] = useState("suma");
  const [topN, setTopN] = useState(10);

  const metrica = metricaPorClave(metricaClave);

  // ── Carga inicial: dos peticiones y ninguna más ──────────────
  useEffect(() => {
    let vigente = true;

    cargarDashboard()
      .then(({ dimensiones, eventos }) => {
        if (!vigente) return;
        setDimensiones(dimensiones);
        setEventos(eventos);
        setFiltro(filtroInicial(dimensiones));
      })
      .catch((e) => {
        if (vigente) setError(e.message);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    // Evita escribir estado si el componente se desmonta antes de que llegue la
    // respuesta (cambio de pestaña rápido).
    return () => { vigente = false; };
  }, []);

  // ── Derivados ────────────────────────────────────────────────
  // Un conjunto por gráfica, no uno solo. Cada ranking se calcula sobre los
  // eventos filtrados por todo MENOS su propia dimensión, para que siga
  // comparando sus categorías entre sí en vez de quedarse con una sola barra
  // cuando el usuario selecciona algo. La explicación completa está en el
  // comentario de `filtrar()` en agregaciones.js.
  const filtrados = useMemo(() => filtrar(eventos, filtro), [eventos, filtro]);
  const sinEstado = useMemo(() => filtrar(eventos, filtro, "estados"), [eventos, filtro]);
  const sinTipo = useMemo(() => filtrar(eventos, filtro, "tipos"), [eventos, filtro]);
  const sinClasificacion = useMemo(() => filtrar(eventos, filtro, "clasificaciones"), [eventos, filtro]);
  const sinMes = useMemo(() => filtrar(eventos, filtro, "meses"), [eventos, filtro]);

  const kpis = useMemo(() => resumen(filtrados), [filtrados]);
  const totales = useMemo(() => resumen(eventos), [eventos]);

  const anual = useMemo(
    () => serieAnual(filtrados, metrica, filtro.añoMin, filtro.añoMax, agregacion),
    [filtrados, metrica, filtro.añoMin, filtro.añoMax, agregacion]
  );
  const mensual = useMemo(() => serieMensual(sinMes, metrica), [sinMes, metrica]);
  const porEstado = useMemo(() => agrupar(sinEstado, "estado", metrica), [sinEstado, metrica]);
  const porTipo = useMemo(() => agrupar(sinTipo, "tipo", metrica), [sinTipo, metrica]);
  const porClasificacion = useMemo(
    () => agrupar(sinClasificacion, "clasificacion", metrica),
    [sinClasificacion, metrica]
  );
  const cubetas = useMemo(() => histogramaMagnitud(filtrados), [filtrados]);

  // ¿El dataset tiene más de una clasificación? Si no, las piezas que comparan
  // clasificaciones se ocultan en lugar de mostrar un 100 % sin información.
  const hayClasificaciones = (dimensiones?.clasificaciones?.length ?? 0) > 1;

  // Porcentaje del total nacional que representa el recorte actual.
  const participacion = (parte, todo) => (todo > 0 ? (parte / todo) * 100 : 0);
  const hayFiltro = dimensiones ? !filtroVacio(filtro, dimensiones) : false;

  const alternarEn = (campo) => (valor) =>
    setFiltro((f) => ({ ...f, [campo]: alternar(f[campo], valor) }));

  // ── Estados de carga y error ─────────────────────────────────
  if (cargando) {
    return (
      <Marco>
        <p style={{ textAlign: "center", padding: 60, color: COLOR.textoTenue, fontSize: 14 }}>
          Cargando eventos históricos…
        </p>
      </Marco>
    );
  }

  if (error || !dimensiones) {
    // Se muestra el error, no datos de ejemplo. La versión anterior arrancaba
    // con constantes MOCK_* que quedaban en pantalla si la API no respondía, y
    // no había forma de saber que las cifras eran inventadas.
    return (
      <Marco>
        <Aviso tono="error">
          <strong>No se pudieron cargar los datos.</strong>
          <br />
          {error || "Respuesta vacía del servidor."}
          <br />
          <span style={{ fontSize: 12 }}>
            Verifica que la API esté corriendo y que <code>VITE_API_URL</code> apunte a ella
            (<code>{import.meta.env.VITE_API_URL || "sin definir"}</code>).
          </span>
        </Aviso>
      </Marco>
    );
  }

  return (
    <Marco>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 25, fontWeight: 800, color: COLOR.texto, margin: 0 }}>
          Dashboard Histórico
        </h1>
        <p style={{ margin: "4px 0 0", color: COLOR.textoSuave, fontSize: 13.5 }}>
          {fmtNumero(totales.eventos)} desastres naturales registrados en México entre{" "}
          {dimensiones.años.min} y {dimensiones.años.max}. Todas las gráficas filtran: haz clic en
          un estado, un fenómeno o un mes.
        </p>
      </div>

      <Controles
        dimensiones={dimensiones}
        filtro={filtro}
        setFiltro={setFiltro}
        metricaClave={metricaClave}
        setMetricaClave={setMetricaClave}
        totalFiltrado={filtrados.length}
        totalGeneral={eventos.length}
        puedeLimpiar={hayFiltro}
        onLimpiar={() => setFiltro(filtroInicial(dimensiones))}
      />

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <KPI
          etiqueta="Eventos"
          valor={fmtNumero(kpis.eventos)}
          nota={`${kpis.estados} estados`}
          porcentaje={hayFiltro ? participacion(kpis.eventos, totales.eventos) : null}
        />
        <KPI
          etiqueta="Daños económicos"
          valor={`$${fmtNumero(kpis.daños)} M`}
          nota="millones de pesos"
          porcentaje={hayFiltro ? participacion(kpis.daños, totales.daños) : null}
        />
        <KPI
          etiqueta="Daño mediano"
          valor={`$${fmtNumero(kpis.medianaDaños, 2)} M`}
          nota="por evento"
        />
        <KPI
          etiqueta="Población afectada"
          valor={fmtNumero(kpis.poblacion)}
          nota="personas"
          porcentaje={hayFiltro ? participacion(kpis.poblacion, totales.poblacion) : null}
        />
        <KPI
          etiqueta="Defunciones"
          valor={fmtNumero(kpis.defunciones)}
          nota="personas"
          porcentaje={hayFiltro ? participacion(kpis.defunciones, totales.defunciones) : null}
        />
        <KPI
          etiqueta="Viviendas dañadas"
          valor={fmtNumero(kpis.viviendas)}
          nota="viviendas"
          porcentaje={hayFiltro ? participacion(kpis.viviendas, totales.viviendas) : null}
        />
      </div>

      {/* El contraste entre suma y mediana es el hallazgo central del dataset y
          justifica una nota fija: sin ella, un lector concluiría que el desastre
          promedio en México cuesta 169 millones de pesos, y no es así. */}
      {metricaClave === "daños" && kpis.eventos > 0 && (
        <Aviso tono="info">
          El daño <strong>mediano</strong> por evento es de ${fmtNumero(kpis.medianaDaños, 2)} M,
          frente a un <strong>promedio</strong> de ${fmtNumero(kpis.daños / kpis.eventos, 1)} M: unos
          pocos desastres concentran casi todo el costo. Es la misma asimetría que obliga al modelo a
          entrenar sobre el logaritmo del daño en lugar del valor crudo — se ve completa en el
          histograma de magnitud, más abajo.
        </Aviso>
      )}

      {/* ── Serie anual ──────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <Tarjeta
          titulo={`${metrica.etiqueta} por año`}
          ayuda="Suma: costo total del año. Mediana: el evento típico."
        >
          <GraficaAnual
            serie={anual}
            metrica={metrica}
            agregacion={agregacion}
            onAgregacion={setAgregacion}
            onRango={(a, b) => setFiltro((f) => ({ ...f, añoMin: a, añoMax: b }))}
          />
        </Tarjeta>
      </div>

      {/* ── Estacionalidad + clasificación ───────────────────── */}
      {/* Con una sola clasificación en los datos, el reparto es un 100 % trivial:
          una barra de un solo segmento que no compara nada. En ese caso la
          estacionalidad ocupa el ancho completo. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: hayClasificaciones ? "minmax(0, 1fr) 270px" : "minmax(0, 1fr)",
        gap: 18,
        marginBottom: 20,
      }}>
        <Tarjeta
          titulo="Patrón estacional"
          ayuda="Clic para filtrar."
        >
          <GraficaEstacional
            serie={mensual}
            metrica={metrica}
            seleccion={filtro.meses}
            onClic={alternarEn("meses")}
          />
        </Tarjeta>

        {hayClasificaciones && (
          <Tarjeta titulo="Reparto por clasificación" ayuda="Clic para filtrar.">
            <BarraProporcion
              datos={porClasificacion}
              metrica={metrica}
              seleccion={filtro.clasificaciones}
              onClic={alternarEn("clasificaciones")}
            />
          </Tarjeta>
        )}
      </div>

      {/* ── Rankings ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18, marginBottom: 20 }}>
        <Tarjeta
          titulo={`Estados por ${metrica.corto.toLowerCase()}`}
          ayuda="Ignora su propio filtro: los 32 estados siguen visibles."
          acciones={
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              style={{ width: "auto", padding: "5px 8px", fontSize: 12, borderRadius: 8 }}
            >
              {[5, 10, 15, 32].map((n) => (
                <option key={n} value={n}>Top {n === 32 ? "todos" : n}</option>
              ))}
            </select>
          }
        >
          <BarrasHorizontales
            datos={porEstado.slice(0, topN)}
            metrica={metrica}
            seleccion={filtro.estados}
            onClic={alternarEn("estados")}
          />
        </Tarjeta>

        <Tarjeta
          titulo={`Fenómenos por ${metrica.corto.toLowerCase()}`}
          ayuda="Ignora su propio filtro: los nueve tipos siguen visibles."
        >
          <BarrasHorizontales
            datos={porTipo}
            metrica={metrica}
            seleccion={filtro.tipos}
            onClic={alternarEn("tipos")}
            anchoEtiqueta={172}
          />
        </Tarjeta>
      </div>

      {/* ── Histograma ───────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <Tarjeta
          titulo="Distribución de la magnitud del daño"
          ayuda="Bandas de potencias de diez."
        >
          <Histograma cubetas={cubetas} />
        </Tarjeta>
      </div>

      {/* ── Mapa ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <Tarjeta titulo={`${metrica.etiqueta} por estado`}>
          <Mapa
            porEstado={porEstado}
            metrica={metrica}
            seleccion={filtro.estados}
            onClicEstado={alternarEn("estados")}
          />
        </Tarjeta>
      </div>

      {/* ── Detalle ──────────────────────────────────────────── */}
      <Tarjeta
        titulo="Detalle de eventos"
        ayuda="Ordena por cualquier columna."
      >
        <Tabla eventos={filtrados} />
      </Tarjeta>

      <p style={{ margin: "22px 0 0", fontSize: 11.5, color: COLOR.textoTenue, textAlign: "center", lineHeight: 1.6 }}>
        Fuente: registros de desastres de CENAPRED y censos de población del INEGI, procesados por{" "}
        <code>train_model_simple.py</code>. Los importes están en pesos corrientes de cada año, sin
        ajustar por inflación: los daños de {dimensiones.años.min} y {dimensiones.años.max} no son
        directamente comparables.
      </p>
    </Marco>
  );
}

/** Fondo y ancho de página, compartido por los tres estados de la vista. */
function Marco({ children }) {
  return (
    <div
      className="dashboard"
      style={{
        minHeight: "100vh",
        background: COLOR.fondo,
        padding: "30px 20px 48px",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

Marco.propTypes = { children: PropTypes.node };
