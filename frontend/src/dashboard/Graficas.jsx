// ============================================================
// Gráficas en SVG
// ------------------------------------------------------------
// Todas se dibujan a mano en SVG, sin librería de gráficas. Es una decisión
// deliberada del proyecto: son cuatro formas simples, el control sobre la
// interacción (arrastre, clic, cursor) es total y el bundle no crece.
//
// Reglas de diseño que se respetan en las cuatro:
//  - Una serie, un color. La longitud de la barra codifica la magnitud; usar
//    además el color para lo mismo desperdicia el único canal libre que queda.
//  - Rejilla y ejes en hairline, un tono por encima del fondo: no compiten con
//    los datos.
//  - Toda gráfica tiene capa de hover. Un SVG en pantalla es interactivo por
//    definición; no aprovecharlo es dejar información en la mesa.
//  - Se etiqueta de forma selectiva (extremos y valores de barra), nunca cada
//    punto: un número sobre cada dato es ruido y nadie lo lee.
// ============================================================

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { COLOR, MESES, MESES_LARGO, fmtCompacto, fmtMetrica, fmtNumero } from "./tema";

// ------------------------------------------------------------
// Piezas compartidas
// ------------------------------------------------------------

/** Tooltip flotante anclado al cursor. Fixed para que no lo recorte la tarjeta. */
export function Tooltip({ x, y, titulo, filas }) {
  return (
    <div
      style={{
        position: "fixed",
        left: Math.min(x + 14, window.innerWidth - 240),
        top: y - 12,
        background: COLOR.superficie,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 13,
        pointerEvents: "none",
        zIndex: 9999,
        boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
        border: `1px solid ${COLOR.borde}`,
        minWidth: 190,
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 13.5,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: `1px solid ${COLOR.rejilla}`,
        }}
      >
        {titulo}
      </div>
      {filas.map((f) => (
        <div key={f.etiqueta} style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <span style={{ color: COLOR.textoSuave }}>{f.etiqueta}</span>
          <strong style={{ color: COLOR.texto }}>{f.valor}</strong>
        </div>
      ))}
    </div>
  );
}

Tooltip.propTypes = {
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  titulo: PropTypes.node.isRequired,
  filas: PropTypes.array.isRequired,
};

/** Mensaje cuando el filtro no deja ningún evento. Evita gráficas vacías rotas. */
function SinDatos({ alto = 200 }) {
  return (
    <div
      style={{
        height: alto,
        display: "grid",
        placeItems: "center",
        color: COLOR.textoTenue,
        fontSize: 13,
      }}
    >
      No hay eventos con los filtros actuales
    </div>
  );
}

SinDatos.propTypes = { alto: PropTypes.number };

/** Convierte coordenadas del puntero a coordenadas del viewBox del SVG. */
function coordenadaEnSvg(evento, svg, anchoViewBox) {
  const caja = svg.getBoundingClientRect();
  return ((evento.clientX - caja.left) / caja.width) * anchoViewBox;
}

// ============================================================
// SERIE ANUAL — línea + área, con cursor y selección por arrastre
// ============================================================
export function GraficaAnual({ serie, metrica, agregacion, onAgregacion, onRango }) {
  const svgRef = useRef(null);
  const [cursor, setCursor] = useState(null); // índice del año bajo el puntero
  const [arrastre, setArrastre] = useState(null); // { desde, hasta } en índices

  const W = 620, H = 250;
  const ml = 62, mr = 20, mt = 14, mb = 44;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const n = serie.length;

  if (!n) return <SinDatos alto={H} />;

  const maxValor = Math.max(...serie.map((d) => d.valor), 1);
  const maxY = maxValor * 1.15;

  const px = (i) => (n === 1 ? ml + cw / 2 : ml + (i / (n - 1)) * cw);
  const py = (v) => mt + ch - (v / maxY) * ch;
  const indiceDesdeX = (x) =>
    Math.max(0, Math.min(n - 1, Math.round(((x - ml) / cw) * (n - 1))));

  const puntos = serie.map((d, i) => `${px(i).toFixed(1)},${py(d.valor).toFixed(1)}`).join(" ");
  const area =
    `M${px(0).toFixed(1)},${(mt + ch).toFixed(1)} ` +
    serie.map((d, i) => `L${px(i).toFixed(1)},${py(d.valor).toFixed(1)}`).join(" ") +
    ` L${px(n - 1).toFixed(1)},${(mt + ch).toFixed(1)} Z`;

  const TICKS = 4;

  // El punto más alto se etiqueta directamente: es el dato que se busca a
  // primera vista y así no depende del hover.
  const iMax = serie.reduce((mejor, d, i) => (d.valor > serie[mejor].valor ? i : mejor), 0);

  const alSoltar = () => {
    if (arrastre && Math.abs(arrastre.hasta - arrastre.desde) >= 1) {
      const a = serie[Math.min(arrastre.desde, arrastre.hasta)].año;
      const b = serie[Math.max(arrastre.desde, arrastre.hasta)].año;
      onRango(a, b);
    }
    setArrastre(null);
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Selector de agregación: la suma responde "cuánto costó en total" y la
          mediana "cómo fue el evento típico". Con una distribución tan sesgada
          las dos cuentan historias distintas y las dos son ciertas. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[
          { clave: "suma", etiqueta: "Suma" },
          { clave: "mediana", etiqueta: "Mediana" },
        ].map((op) => (
          <button
            key={op.clave}
            onClick={() => onAgregacion(op.clave)}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${agregacion === op.clave ? COLOR.serie : COLOR.borde}`,
              background: agregacion === op.clave ? COLOR.serie : COLOR.superficie,
              color: agregacion === op.clave ? "#fff" : COLOR.textoSuave,
            }}
          >
            {op.etiqueta}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: COLOR.textoTenue, alignSelf: "center" }}>
          Arrastra sobre la gráfica para acotar los años
        </span>
      </div>

      {cursor !== null && !arrastre && (
        <Tooltip
          x={cursor.x}
          y={cursor.y}
          titulo={serie[cursor.i].año}
          filas={[
            {
              etiqueta: agregacion === "mediana" ? `${metrica.corto} (mediana)` : metrica.corto,
              valor: fmtMetrica(serie[cursor.i].valor, metrica),
            },
            { etiqueta: "Eventos", valor: fmtNumero(serie[cursor.i].eventos) },
          ]}
        />
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", cursor: "crosshair", userSelect: "none" }}
        onMouseMove={(e) => {
          const x = coordenadaEnSvg(e, svgRef.current, W);
          const i = indiceDesdeX(x);
          setCursor({ i, x: e.clientX, y: e.clientY });
          if (arrastre) setArrastre((prev) => ({ ...prev, hasta: i }));
        }}
        onMouseLeave={() => { setCursor(null); setArrastre(null); }}
        onMouseDown={(e) => {
          const i = indiceDesdeX(coordenadaEnSvg(e, svgRef.current, W));
          setArrastre({ desde: i, hasta: i });
        }}
        onMouseUp={alSoltar}
      >
        <defs>
          <linearGradient id="gradAnual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR.serie} stopOpacity="0.20" />
            <stop offset="100%" stopColor={COLOR.serie} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Rejilla y escala Y */}
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const v = (maxY / TICKS) * i;
          const y = py(v);
          return (
            <g key={i}>
              <line x1={ml} y1={y} x2={ml + cw} y2={y} stroke={COLOR.rejilla} strokeWidth={1} />
              <text x={ml - 6} y={y + 4} textAnchor="end" fontSize={9.5} fill={COLOR.textoTenue}>
                {i === 0 ? "0" : fmtCompacto(v)}
              </text>
            </g>
          );
        })}

        {/* Banda de selección mientras se arrastra */}
        {arrastre && (
          <rect
            x={Math.min(px(arrastre.desde), px(arrastre.hasta))}
            y={mt}
            width={Math.abs(px(arrastre.hasta) - px(arrastre.desde))}
            height={ch}
            fill={COLOR.serie}
            fillOpacity={0.12}
          />
        )}

        <path d={area} fill="url(#gradAnual)" />
        <polyline
          points={puntos}
          fill="none"
          stroke={COLOR.serie}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Línea de cursor */}
        {cursor !== null && (
          <line
            x1={px(cursor.i)} y1={mt}
            x2={px(cursor.i)} y2={mt + ch}
            stroke={COLOR.serie} strokeWidth={1} strokeOpacity={0.45}
          />
        )}

        {/* Puntos: anillo del color de la superficie para que no se fundan */}
        {serie.map((d, i) => (
          <circle
            key={d.año}
            cx={px(i)}
            cy={py(d.valor)}
            r={cursor?.i === i ? 5 : 3}
            fill={COLOR.serie}
            stroke={COLOR.superficie}
            strokeWidth={2}
          />
        ))}

        {/* Etiqueta directa del máximo */}
        {maxValor > 0 && (
          <text
            x={px(iMax)}
            y={py(serie[iMax].valor) - 10}
            textAnchor={iMax > n - 3 ? "end" : iMax < 2 ? "start" : "middle"}
            fontSize={10.5}
            fontWeight={700}
            fill={COLOR.textoSuave}
          >
            {fmtCompacto(serie[iMax].valor)}
          </text>
        )}

        {/* Eje X: se rotula uno de cada dos años para que no se encimen */}
        {serie.map((d, i) =>
          i % Math.ceil(n / 12) !== 0 ? null : (
            <text key={d.año} x={px(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={COLOR.textoSuave}>
              {d.año}
            </text>
          )
        )}

        <line x1={ml} y1={mt} x2={ml} y2={mt + ch} stroke={COLOR.eje} strokeWidth={1} />
        <line x1={ml} y1={mt + ch} x2={ml + cw} y2={mt + ch} stroke={COLOR.eje} strokeWidth={1} />

        <text
          transform={`translate(13,${mt + ch / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={9.5}
          fill={COLOR.textoTenue}
        >
          {metrica.unidad}
        </text>
      </svg>
    </div>
  );
}

GraficaAnual.propTypes = {
  serie: PropTypes.array.isRequired,
  metrica: PropTypes.object.isRequired,
  agregacion: PropTypes.string.isRequired,
  onAgregacion: PropTypes.func.isRequired,
  onRango: PropTypes.func.isRequired,
};

// ============================================================
// BARRAS HORIZONTALES — ranking clicable (estados, tipos de fenómeno)
// ============================================================
export function BarrasHorizontales({ datos, metrica, seleccion, onClic, anchoEtiqueta = 150 }) {
  const [hover, setHover] = useState(null);

  if (!datos.length) return <SinDatos alto={180} />;

  const W = 620;
  const ml = anchoEtiqueta, mr = 74, mt = 4, mb = 4;
  const barH = 21, hueco = 9;
  const H = mt + mb + datos.length * (barH + hueco) - hueco;
  const bw = W - ml - mr;
  const maxV = Math.max(...datos.map((d) => d.valor), 1);

  return (
    <div style={{ position: "relative" }}>
      {hover && (
        <Tooltip
          x={hover.x}
          y={hover.y}
          titulo={hover.dato.llave}
          filas={[
            { etiqueta: metrica.corto, valor: fmtMetrica(hover.dato.valor, metrica) },
            { etiqueta: "Eventos", valor: fmtNumero(hover.dato.eventos) },
            { etiqueta: "Participación", valor: `${((hover.dato.valor / datos.reduce((s, d) => s + d.valor, 0)) * 100).toFixed(1)}%` },
          ]}
        />
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {datos.map((d, i) => {
          const y = mt + i * (barH + hueco);
          const ancho = Math.max((d.valor / maxV) * bw, d.valor > 0 ? 3 : 0);
          const activo = seleccion.includes(d.llave);
          const etiqueta = d.llave.length > 22 ? `${d.llave.slice(0, 21)}…` : d.llave;

          return (
            <g
              key={d.llave}
              style={{ cursor: "pointer" }}
              onClick={() => onClic(d.llave)}
              onMouseEnter={(e) => setHover({ dato: d, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null))}
              onMouseLeave={() => setHover(null)}
            >
              {/* Zona de clic completa: el objetivo es toda la fila, no la barra */}
              <rect x={0} y={y - hueco / 2} width={W} height={barH + hueco} fill="transparent" />

              <text
                x={ml - 10}
                y={y + barH / 2 + 4}
                textAnchor="end"
                fontSize={11.5}
                fontWeight={activo ? 700 : 400}
                fill={activo ? COLOR.texto : COLOR.textoSuave}
              >
                {activo ? "✓ " : ""}{etiqueta}
              </text>

              <rect x={ml} y={y} width={bw} height={barH} rx={4} fill={COLOR.rejilla} />
              <rect
                x={ml}
                y={y}
                width={ancho}
                height={barH}
                rx={4}
                fill={activo ? COLOR.serieOscura : COLOR.serie}
                fillOpacity={hover?.dato?.llave === d.llave ? 0.85 : 1}
              />
              <text
                x={ml + ancho + 7}
                y={y + barH / 2 + 4}
                fontSize={11}
                fontWeight={600}
                fill={COLOR.textoSuave}
              >
                {fmtCompacto(d.valor)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

BarrasHorizontales.propTypes = {
  datos: PropTypes.array.isRequired,
  metrica: PropTypes.object.isRequired,
  seleccion: PropTypes.array.isRequired,
  onClic: PropTypes.func.isRequired,
  anchoEtiqueta: PropTypes.number,
};

// ============================================================
// ESTACIONALIDAD — barras verticales por mes, clicables
// ============================================================
// Es la dimensión que más dice del fenómeno y la que el dashboard anterior no
// mostraba. También es la que conecta con el modelo: `mes_sin` y `mes_cos` son
// dos de sus siete variables de entrada, y aquí se ve por qué importan.
export function GraficaEstacional({ serie, metrica, seleccion, onClic }) {
  const [hover, setHover] = useState(null);

  const W = 620, H = 210;
  const ml = 56, mr = 14, mt = 14, mb = 34;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const anchoBanda = cw / 12;
  const barW = anchoBanda - 8; // 8 px de aire: separa sin necesidad de bordes

  const maxV = Math.max(...serie.map((d) => d.valor), 1);
  const TICKS = 4;

  return (
    <div style={{ position: "relative" }}>
      {hover && (
        <Tooltip
          x={hover.x}
          y={hover.y}
          titulo={MESES_LARGO[hover.dato.mes - 1]}
          filas={[
            { etiqueta: metrica.corto, valor: fmtMetrica(hover.dato.valor, metrica) },
            { etiqueta: "Eventos", valor: fmtNumero(hover.dato.eventos) },
          ]}
        />
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const v = (maxV / TICKS) * i;
          const y = mt + ch - (v / maxV) * ch;
          return (
            <g key={i}>
              <line x1={ml} y1={y} x2={ml + cw} y2={y} stroke={COLOR.rejilla} strokeWidth={1} />
              <text x={ml - 6} y={y + 4} textAnchor="end" fontSize={9.5} fill={COLOR.textoTenue}>
                {i === 0 ? "0" : fmtCompacto(v)}
              </text>
            </g>
          );
        })}

        {serie.map((d, i) => {
          const alto = (d.valor / maxV) * ch;
          const x = ml + i * anchoBanda + 4;
          const activo = seleccion.includes(d.mes);
          return (
            <g
              key={d.mes}
              style={{ cursor: "pointer" }}
              onClick={() => onClic(d.mes)}
              onMouseEnter={(e) => setHover({ dato: d, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null))}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={x} y={mt} width={barW} height={ch} fill="transparent" />
              <rect
                x={x}
                y={mt + ch - alto}
                width={barW}
                height={Math.max(alto, d.valor > 0 ? 2 : 0)}
                rx={4}
                fill={activo ? COLOR.serieOscura : COLOR.serie}
                fillOpacity={hover?.dato?.mes === d.mes ? 0.85 : 1}
              />
              <text
                x={x + barW / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize={10}
                fontWeight={activo ? 700 : 400}
                fill={activo ? COLOR.texto : COLOR.textoSuave}
              >
                {MESES[i]}
              </text>
            </g>
          );
        })}

        <line x1={ml} y1={mt + ch} x2={ml + cw} y2={mt + ch} stroke={COLOR.eje} strokeWidth={1} />
      </svg>
    </div>
  );
}

GraficaEstacional.propTypes = {
  serie: PropTypes.array.isRequired,
  metrica: PropTypes.object.isRequired,
  seleccion: PropTypes.array.isRequired,
  onClic: PropTypes.func.isRequired,
};

// ============================================================
// HISTOGRAMA DE MAGNITUD — cuántos eventos hay de cada tamaño
// ============================================================
// La gráfica que explica el modelo. Los daños abarcan siete órdenes de
// magnitud, así que las bandas son potencias de diez. Ver la montaña apilada a
// la izquierda y la cola larga a la derecha es ver, exactamente, por qué el
// modelo entrena sobre log1p del objetivo.
export function Histograma({ cubetas }) {
  const [hover, setHover] = useState(null);

  const total = cubetas.reduce((s, c) => s + c.eventos, 0) || 1;
  const W = 620, H = 200;
  const ml = 44, mr = 14, mt = 18, mb = 46;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const anchoBanda = cw / cubetas.length;
  const barW = anchoBanda - 8;
  const maxV = Math.max(...cubetas.map((c) => c.eventos), 1);

  return (
    <div style={{ position: "relative" }}>
      {hover && (
        <Tooltip
          x={hover.x}
          y={hover.y}
          titulo={hover.cubeta.etiqueta === "0" ? "Sin daño registrado" : `${hover.cubeta.etiqueta} millones`}
          filas={[
            { etiqueta: "Eventos", valor: fmtNumero(hover.cubeta.eventos) },
            { etiqueta: "Del total", valor: `${((hover.cubeta.eventos / total) * 100).toFixed(1)}%` },
          ]}
        />
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {[0, 0.5, 1].map((f) => {
          const y = mt + ch - f * ch;
          return <line key={f} x1={ml} y1={y} x2={ml + cw} y2={y} stroke={COLOR.rejilla} strokeWidth={1} />;
        })}
        <text x={ml - 6} y={mt + 4} textAnchor="end" fontSize={9.5} fill={COLOR.textoTenue}>
          {fmtCompacto(maxV)}
        </text>
        <text x={ml - 6} y={mt + ch + 4} textAnchor="end" fontSize={9.5} fill={COLOR.textoTenue}>0</text>

        {cubetas.map((c, i) => {
          const alto = (c.eventos / maxV) * ch;
          const x = ml + i * anchoBanda + 4;
          return (
            <g
              key={c.etiqueta}
              onMouseEnter={(e) => setHover({ cubeta: c, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null))}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={x} y={mt} width={barW} height={ch} fill="transparent" />
              <rect
                x={x}
                y={mt + ch - alto}
                width={barW}
                height={Math.max(alto, c.eventos > 0 ? 2 : 0)}
                rx={4}
                fill={COLOR.serie}
                fillOpacity={hover?.cubeta?.etiqueta === c.etiqueta ? 0.85 : 1}
              />
              {c.eventos > 0 && (
                <text
                  x={x + barW / 2}
                  y={mt + ch - alto - 5}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={600}
                  fill={COLOR.textoSuave}
                >
                  {c.eventos}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={H - 26}
                textAnchor="middle"
                fontSize={9}
                fill={COLOR.textoSuave}
              >
                {c.etiqueta}
              </text>
            </g>
          );
        })}

        <line x1={ml} y1={mt + ch} x2={ml + cw} y2={mt + ch} stroke={COLOR.eje} strokeWidth={1} />
        <text x={ml + cw / 2} y={H - 6} textAnchor="middle" fontSize={9.5} fill={COLOR.textoTenue}>
          Daño del evento (millones de pesos, escala logarítmica)
        </text>
      </svg>
    </div>
  );
}

Histograma.propTypes = { cubetas: PropTypes.array.isRequired };

// ============================================================
// BARRA DE PROPORCIÓN — reparto entre dos o tres categorías
// ============================================================
// Sustituye a la dona anterior. Con solo dos categorías (92% / 8%) una dona
// obliga a comparar ángulos para leer un dato que una barra dice directo.
export function BarraProporcion({ datos, metrica, seleccion, onClic }) {
  const total = datos.reduce((s, d) => s + d.valor, 0) || 1;
  const colores = [COLOR.serie, COLOR.serie2];
  const coloresActivos = [COLOR.serieOscura, COLOR.serie2Oscura];

  return (
    <div>
      <div style={{ display: "flex", height: 30, gap: 2, marginBottom: 14 }}>
        {datos.map((d, i) => {
          const activo = seleccion.includes(d.llave);
          const pct = (d.valor / total) * 100;
          return (
            <div
              key={d.llave}
              onClick={() => onClic(d.llave)}
              title={`${d.llave}: ${pct.toFixed(1)}%`}
              style={{
                width: `${Math.max(pct, 2)}%`,
                background: activo ? coloresActivos[i % 2] : colores[i % 2],
                borderRadius: i === 0 ? "6px 0 0 6px" : i === datos.length - 1 ? "0 6px 6px 0" : 0,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                overflow: "hidden",
              }}
            >
              {/* La etiqueta solo se dibuja si cabe; si no, vive en la leyenda */}
              {pct >= 12 ? `${pct.toFixed(0)}%` : ""}
            </div>
          );
        })}
      </div>

      {/* Leyenda: siempre presente, porque hay dos series y la identidad nunca
          puede depender solo del color. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {datos.map((d, i) => {
          const activo = seleccion.includes(d.llave);
          return (
            <div
              key={d.llave}
              onClick={() => onClic(d.llave)}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: activo ? coloresActivos[i % 2] : colores[i % 2],
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, color: COLOR.textoSuave, fontWeight: activo ? 700 : 400 }}>
                {activo ? "✓ " : ""}{d.llave}
              </span>
              <span style={{ fontWeight: 700, color: COLOR.texto }}>
                {fmtCompacto(d.valor)}
              </span>
            </div>
          );
        })}
        <p style={{ margin: "2px 0 0", fontSize: 10.5, color: COLOR.textoTenue }}>
          Medido en {metrica.unidad}. Clic para filtrar.
        </p>
      </div>
    </div>
  );
}

BarraProporcion.propTypes = {
  datos: PropTypes.array.isRequired,
  metrica: PropTypes.object.isRequired,
  seleccion: PropTypes.array.isRequired,
  onClic: PropTypes.func.isRequired,
};
