import { useState, useEffect } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleLinear } from "d3-scale";

// ============================================================
// DATOS PLACEHOLDER — reemplazar con fetch a FastAPI
// ============================================================

// CONECTAR: GET /stats/kpis
// Respuesta: { total_eventos, total_daños, poblacion_afectada, estados_afectados }
const MOCK_KPIS = {
  total_eventos:      1842,
  total_daños:        524300.5,
  poblacion_afectada: 12450000,
  estados_afectados:  32,
};

// CONECTAR: GET /stats/evolucion-anual
// Respuesta: [{ año: number, daños: number }]
const MOCK_EVOLUCION = [
  { año: 2010, daños: 14200 },
  { año: 2011, daños:  9800 },
  { año: 2012, daños: 11500 },
  { año: 2013, daños: 21400 },
  { año: 2014, daños: 13200 },
  { año: 2015, daños: 18600 },
  { año: 2016, daños: 15800 },
  { año: 2017, daños: 57200 },
  { año: 2018, daños: 12400 },
  { año: 2019, daños: 16800 },
  { año: 2020, daños: 31500 },
  { año: 2021, daños: 14200 },
  { año: 2022, daños: 19800 },
  { año: 2023, daños: 16400 },
];

// CONECTAR: GET /stats/top-estados?limit=10
// Respuesta: [{ estado: string, daños: number }]
const MOCK_TOP_ESTADOS = [
  { estado: "Ciudad de México", daños: 68400 },
  { estado: "Tabasco",          daños: 52800 },
  { estado: "Guerrero",         daños: 41200 },
  { estado: "Veracruz",         daños: 38700 },
  { estado: "Sinaloa",          daños: 32900 },
  { estado: "Oaxaca",           daños: 28500 },
  { estado: "Chiapas",          daños: 24100 },
  { estado: "Jalisco",          daños: 19800 },
  { estado: "Sonora",           daños: 16400 },
  { estado: "Puebla",           daños: 13200 },
];

// CONECTAR: GET /stats/por-estado
// Respuesta: [{ estado, daños, poblacion, total_eventos }]
const MOCK_POR_ESTADO = MOCK_TOP_ESTADOS.map((d) => ({
  ...d,
  poblacion:     0,
  total_eventos: 0,
}));

// CONECTAR: GET /stats/clasificacion
// Respuesta: [{ label: string, value: number, color: string }]
const MOCK_DISTRIBUCION = [
  { label: "Hidrometeorológico", value: 72, color: "#3b82f6" },
  { label: "Geológico",          value: 28, color: "#f97316" },
];

// CONECTAR: GET /stats/top-eventos?limit=10
// Respuesta: [{ año, estado, tipo, daños }]
const MOCK_TOP_EVENTOS = [
  { año: 2017, estado: "Ciudad de México", tipo: "Sismos",                daños: 48700.0 },
  { año: 2020, estado: "Tabasco",          tipo: "Lluvias e Inundaciones", daños: 22800.5 },
  { año: 2015, estado: "Guerrero",         tipo: "Ciclones",              daños: 18400.0 },
  { año: 2013, estado: "Guerrero",         tipo: "Lluvias e Inundaciones", daños: 15200.3 },
  { año: 2019, estado: "Sinaloa",          tipo: "Ciclones",              daños: 12900.8 },
  { año: 2016, estado: "Oaxaca",           tipo: "Sismos",                daños: 11500.0 },
  { año: 2018, estado: "Veracruz",         tipo: "Lluvias e Inundaciones", daños:  9800.4 },
  { año: 2021, estado: "Jalisco",          tipo: "Sequía",                daños:  8700.2 },
  { año: 2014, estado: "Chiapas",          tipo: "Movimientos de Masa",   daños:  7600.1 },
  { año: 2022, estado: "Sonora",           tipo: "Calor Extremo",         daños:  6200.0 },
];

// ============================================================
// KPI CARD
// ============================================================
function KpiCard({ label, value, sub }) {
  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        border: "1px solid #f0f0f0",
        flex: "1 1 200px",
        minWidth: 0,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "#6b7280",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </p>
      <p style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 800, color: "#111827" }}>
        {value}
      </p>
      {sub && (
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{sub}</p>
      )}
    </div>
  );
}

// ============================================================
// GRÁFICO DE LÍNEAS — SVG puro
// ============================================================
function LineChart({ data }) {
  const W = 560, H = 230;
  const ml = 58, mr = 18, mt = 16, mb = 42;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const n  = data.length;

  const maxRaw = Math.max(...data.map((d) => d.daños));
  const maxY   = Math.ceil(maxRaw / 10000) * 10000 * 1.15;

  const px = (i) => ml + (i / (n - 1)) * cw;
  const py = (v) => mt + ch - (v / maxY) * ch;

  const pts  = data.map((d, i) => `${px(i).toFixed(1)},${py(d.daños).toFixed(1)}`).join(" ");
  const area =
    `M${px(0).toFixed(1)},${(mt + ch).toFixed(1)} ` +
    data.map((d, i) => `L${px(i).toFixed(1)},${py(d.daños).toFixed(1)}`).join(" ") +
    ` L${px(n - 1).toFixed(1)},${(mt + ch).toFixed(1)} Z`;

  const TICKS = 5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Líneas de cuadrícula + etiquetas Y */}
      {Array.from({ length: TICKS + 1 }, (_, i) => {
        const v  = (maxY / TICKS) * i;
        const y  = py(v);
        const lbl = i === 0 ? "0" : `${Math.round(v / 1000)}K`;
        return (
          <g key={i}>
            <line x1={ml} y1={y} x2={ml + cw} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={ml - 5} y={y + 4} textAnchor="end" fontSize={9.5} fill="#9ca3af">
              {lbl}
            </text>
          </g>
        );
      })}

      {/* Área */}
      <path d={area} fill="url(#areaGrad)" />

      {/* Línea */}
      <polyline
        points={pts}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Puntos */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={px(i)}
          cy={py(d.daños)}
          r={3}
          fill="#3b82f6"
          stroke="#fff"
          strokeWidth={1.5}
        />
      ))}

      {/* Etiquetas X (cada 2 años) */}
      {data.map((d, i) =>
        i % 2 !== 0 ? null : (
          <text
            key={i}
            x={px(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={10}
            fill="#6b7280"
          >
            {d.año}
          </text>
        )
      )}

      {/* Ejes */}
      <line x1={ml} y1={mt} x2={ml} y2={mt + ch} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={ml} y1={mt + ch} x2={ml + cw} y2={mt + ch} stroke="#e5e7eb" strokeWidth={1} />

      {/* Título eje Y */}
      <text
        transform={`translate(11,${mt + ch / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={9}
        fill="#9ca3af"
      >
        Millones de pesos
      </text>
    </svg>
  );
}

// ============================================================
// GRÁFICO DE BARRAS HORIZONTALES — SVG puro
// ============================================================
function BarChart({ data }) {
  const W    = 560;
  const ml   = 158, mr = 64, mt = 6, mb = 6;
  const barH = 22, gap = 9;
  const H    = mt + mb + data.length * (barH + gap) - gap;
  const bw   = W - ml - mr;

  const maxV = Math.max(...data.map((d) => d.daños));
  const fmtV = (v) => `$${(v / 1000).toFixed(0)}K`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {data.map((d, i) => {
        const y      = mt + i * (barH + gap);
        const filled = (d.daños / maxV) * bw;
        return (
          <g key={i}>
            {/* Etiqueta estado */}
            <text
              x={ml - 8}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fill="#374151"
            >
              {d.estado}
            </text>
            {/* Fondo */}
            <rect x={ml} y={y} width={bw} height={barH} rx={4} fill="#f3f4f6" />
            {/* Barra */}
            <rect
              x={ml}
              y={y}
              width={filled}
              height={barH}
              rx={4}
              fill={i === 0 ? "#1d4ed8" : "#3b82f6"}
            />
            {/* Valor */}
            <text
              x={ml + filled + 6}
              y={y + barH / 2 + 4}
              fontSize={11}
              fontWeight="600"
              fill="#374151"
            >
              {fmtV(d.daños)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================
// GRÁFICO DE PASTEL (DONUT) — SVG puro
// ============================================================
function DonutChart({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 90, cy = 90, r = 72, ir = 42;
  let angle = -Math.PI / 2;

  const slices = data.map((d) => {
    const start = angle;
    const span  = (d.value / total) * 2 * Math.PI;
    angle      += span;
    const end   = angle;
    const large = span > Math.PI ? 1 : 0;
    const c = (a) => Math.cos(a), s = (a) => Math.sin(a);
    const f = (n) => n.toFixed(2);
    const path = [
      `M${f(cx + r  * c(start))},${f(cy + r  * s(start))}`,
      `A${r},${r} 0 ${large},1 ${f(cx + r  * c(end))},${f(cy + r  * s(end))}`,
      `L${f(cx + ir * c(end))},${f(cy + ir * s(end))}`,
      `A${ir},${ir} 0 ${large},0 ${f(cx + ir * c(start))},${f(cy + ir * s(start))}`,
      "Z",
    ].join(" ");
    return { ...d, path, pct: ((d.value / total) * 100).toFixed(1) };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <svg viewBox="0 0 180 180" width={180} height={180}>
        {slices.map((s) => (
          <path key={s.label} d={s.path} fill={s.color} stroke="#fff" strokeWidth={2} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={9.5} fill="#9ca3af">
          Eventos
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={21} fontWeight="800" fill="#111827">
          {total.toLocaleString("es-MX")}
        </text>
      </svg>

      {/* Leyenda */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#374151", flex: 1 }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TABLA DE EVENTOS
// ============================================================
function TablaEventos({ eventos }) {
  const fmt = (v) =>
    Number(v).toLocaleString("es-MX", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Año", "Estado", "Tipo de fenómeno", "Total de daños (M$)"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "9px 12px",
                  textAlign: "left",
                  fontWeight: 700,
                  color: "#374151",
                  background: "#f9fafb",
                  borderBottom: "2px solid #e5e7eb",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {eventos.map((ev, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={tdStyle}>{ev.año}</td>
              <td style={tdStyle}>{ev.estado}</td>
              <td style={tdStyle}>{ev.tipo}</td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>${fmt(ev.daños)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tdStyle = { padding: "9px 12px", color: "#374151" };

// ============================================================
// MAPA COROPLÉTICO — react-simple-maps + GeoJSON local
// ============================================================

// Mapa entre nombres del GeoJSON → nombres usados en los datos
const GEO_NAME_MAP = {
  "Coahuila de Zaragoza":            "Coahuila",
  "Distrito Federal":                "Ciudad de México",
  "Michoacán de Ocampo":             "Michoacán",
  "Veracruz de Ignacio de la Llave": "Veracruz",
};

// CONECTAR: GET /stats/por-estado
// data esperado: [{ estado, daños, poblacion, total_eventos }]
function MapaMexico({ data }) {
  const [tooltip, setTooltip] = useState(null);

  const lookup = Object.fromEntries(
    data.map((d) => [
      d.estado,
      { daños: d.daños, poblacion: d.poblacion ?? 0, total_eventos: d.total_eventos ?? 0 },
    ])
  );
  const maxVal = Math.max(...data.map((d) => d.daños), 1);

  const colorScale = scaleLinear()
    .domain([0, maxVal])
    .range(["#fecaca", "#7f1d1d"]);

  return (
    <div style={{ position: "relative" }}>
      {tooltip && (
        <div
          style={{
            position:     "fixed",
            left:         tooltip.x + 14,
            top:          tooltip.y - 10,
            background:   "#ffffff",
            color:        "#111827",
            borderRadius: 10,
            padding:      "12px 16px",
            fontSize:     13,
            pointerEvents:"none",
            zIndex:       9999,
            boxShadow:    "0 6px 20px rgba(0,0,0,0.15)",
            border:       "1px solid #e5e7eb",
            minWidth:     200,
            lineHeight:   1.7,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14, borderBottom: "1px solid #f3f4f6", paddingBottom: 6 }}>{tooltip.nombre}</div>
          <div>
            <span style={{ color: "#6b7280" }}>Daños económicos: </span>
            <strong style={{ color: "#111827" }}>${tooltip.daños.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M</strong>
          </div>
          <div>
            <span style={{ color: "#6b7280" }}>Población afectada: </span>
            <strong style={{ color: "#111827" }}>{tooltip.poblacion.toLocaleString("es-MX")}</strong>
          </div>
          <div>
            <span style={{ color: "#6b7280" }}>Eventos registrados: </span>
            <strong style={{ color: "#111827" }}>{tooltip.total_eventos}</strong>
          </div>
        </div>
      )}

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 1600, center: [-102, 24] }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography="/mexico.geojson">
          {({ geographies }) =>
            geographies.map((geo) => {
              const nombre = GEO_NAME_MAP[geo.properties.name] ?? geo.properties.name;
              const info   = lookup[nombre] ?? { daños: 0, poblacion: 0, total_eventos: 0 };
              const val    = info.daños;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, nombre, ...info })}
                  onMouseMove={(e)  => setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={()  => setTooltip(null)}
                  style={{
                    default: {
                      fill:        val > 0 ? colorScale(val) : "#f3f4f6",
                      stroke:      "#ffffff",
                      strokeWidth: 0.6,
                      outline:     "none",
                    },
                    hover: {
                      fill:        val > 0 ? colorScale(val * 0.8) : "#e5e7eb",
                      stroke:      "#ffffff",
                      strokeWidth: 0.6,
                      outline:     "none",
                      cursor:      "pointer",
                    },
                    pressed: { outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Leyenda de color */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>Menor daño</span>
        <div
          style={{
            flex: 1,
            height: 10,
            borderRadius: 6,
            background: "linear-gradient(to right, #fecaca, #7f1d1d)",
          }}
        />
        <span style={{ fontSize: 11, color: "#6b7280" }}>Mayor daño</span>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
        Estados sin datos aparecen en gris claro
      </p>
    </div>
  );
}

// ============================================================
// CARD REUTILIZABLE
// ============================================================
function Card({ title, children }) {
  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 16,
        padding: "20px 24px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        border: "1px solid #f0f0f0",
      }}
    >
      <h3
        style={{
          margin: "0 0 16px",
          fontSize: 14,
          fontWeight: 700,
          color: "#111827",
          borderBottom: "1px solid #f3f4f6",
          paddingBottom: 10,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

// ============================================================
// DASHBOARD PRINCIPAL
// ============================================================
export default function DashboardHistorico() {
  const [kpis,         setKpis]         = useState(MOCK_KPIS);
  const [evolucion,    setEvolucion]    = useState(MOCK_EVOLUCION);
  const [topEstados,   setTopEstados]   = useState(MOCK_TOP_ESTADOS);
  const [porEstado,    setPorEstado]    = useState(MOCK_POR_ESTADO);
  const [distribucion, setDistribucion] = useState(MOCK_DISTRIBUCION);
  const [topEventos,   setTopEventos]   = useState(MOCK_TOP_EVENTOS);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  useEffect(() => {
    const API = import.meta.env.VITE_API_URL;

    async function fetchAll() {
      setLoading(true);
      setError("");

      // Fetch mapa independiente para que un fallo en otros endpoints no lo afecte
      fetch(`${API}/stats/por-estado`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data) setPorEstado(data); })
        .catch(() => {});

      try {
        const [r1, r2, r3, r4, r5] = await Promise.all([
          fetch(`${API}/stats/kpis`),
          fetch(`${API}/stats/evolucion-anual`),
          fetch(`${API}/stats/top-estados?limit=10`),
          fetch(`${API}/stats/clasificacion`),
          fetch(`${API}/stats/top-eventos?limit=10`),
        ]);

        if (!r1.ok || !r2.ok || !r3.ok || !r4.ok || !r5.ok)
          throw new Error("Error al cargar datos del servidor.");

        setKpis(await r1.json());
        setEvolucion(await r2.json());
        setTopEstados(await r3.json());
        setDistribucion(await r4.json());
        setTopEventos(await r5.json());
      } catch (e) {
        setError(`${e.message} — Mostrando datos de ejemplo.`);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, []);

  const fmtNum = (v) => Number(v).toLocaleString("es-MX", { maximumFractionDigits: 0 });

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "#6b7280", fontFamily: "system-ui" }}>
        Cargando datos históricos…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "32px 20px",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Encabezado */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#111827", margin: 0 }}>
            Dashboard Histórico
          </h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>
            Análisis de desastres naturales registrados en México
          </p>
        </div>

        {error && (
          <p style={{ color: "#dc2626", fontWeight: 600, marginBottom: 20 }}>
            Error: {error}
          </p>
        )}

        {/* ── ROW 1: KPIs ─────────────────────────────────────── */}
        {/* CONECTAR: GET /stats/kpis */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <KpiCard
            label="Total de eventos registrados"
            value={fmtNum(kpis.total_eventos)}
            sub="eventos históricos"
          />
          <KpiCard
            label="Total de daños económicos"
            value={`$${fmtNum(kpis.total_daños)} M`}
            sub="millones de pesos"
          />
          <KpiCard
            label="Población afectada"
            value={`${(kpis.poblacion_afectada / 1e6).toFixed(2)} M`}
            sub="personas"
          />
          <KpiCard
            label="Estados afectados"
            value={kpis.estados_afectados}
            sub="de 32 estados"
          />
        </div>

        {/* ── ROW 2: Gráfico de líneas + Pastel ────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 290px",
            gap: 20,
            marginBottom: 20,
          }}
        >
          {/* CONECTAR: GET /stats/evolucion-anual */}
          <Card title="Evolución de daños económicos por año">
            <LineChart data={evolucion} />
          </Card>

          {/* CONECTAR: GET /stats/clasificacion */}
          <Card title="Distribución de eventos por clasificación">
            <DonutChart data={distribucion} />
          </Card>
        </div>

        {/* ── ROW 3: Barras horizontales ───────────────────────── */}
        {/* CONECTAR: GET /stats/top-estados?limit=10 */}
        <div style={{ marginBottom: 20 }}>
          <Card title="Top 10 estados con mayores daños económicos">
            <BarChart data={topEstados} />
          </Card>
        </div>

        {/* ── ROW 4: Tabla ─────────────────────────────────────── */}
        {/* CONECTAR: GET /stats/top-eventos?limit=10 */}
        <div style={{ marginBottom: 20 }}>
          <Card title="Eventos más costosos registrados">
            <TablaEventos eventos={topEventos} />
          </Card>
        </div>

        {/* ── ROW 5: Mapa completo — todos los estados ─────────── */}
        <Card title="Distribución geográfica (México)">
          <MapaMexico data={porEstado} />
        </Card>

      </div>
    </div>
  );
}
