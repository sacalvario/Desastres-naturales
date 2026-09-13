// ============================================================
// Barra de filtros
// ------------------------------------------------------------
// Todos los controles viven en una sola fila superior, no repartidos entre las
// gráficas: el usuario tiene que poder ver de un vistazo qué recorte está
// mirando. Las "píldoras" de filtros activos cumplen esa función —dicen el
// estado actual y permiten deshacerlo pieza por pieza.
// ============================================================

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { COLOR, METRICAS, MESES_LARGO, fmtNumero } from "./tema";

const estiloCampo = {
  width: "auto",
  padding: "7px 10px",
  fontSize: 12.5,
  borderRadius: 8,
  border: `1px solid ${COLOR.borde}`,
  background: COLOR.superficie,
};

// ------------------------------------------------------------
// Chip: un botón de dos estados. Se usa para métrica y clasificación.
// ------------------------------------------------------------
function Chip({ activo, children, onClick, titulo }) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      style={{
        padding: "6px 13px",
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 999,
        cursor: "pointer",
        whiteSpace: "nowrap",
        border: `1px solid ${activo ? COLOR.serie : COLOR.borde}`,
        background: activo ? COLOR.serie : COLOR.superficie,
        color: activo ? "#fff" : COLOR.textoSuave,
        transition: "background 0.12s ease, border-color 0.12s ease",
      }}
    >
      {children}
    </button>
  );
}

Chip.propTypes = {
  activo: PropTypes.bool,
  children: PropTypes.node,
  onClick: PropTypes.func,
  titulo: PropTypes.string,
};

// ------------------------------------------------------------
// Selector múltiple con búsqueda (estados, tipos de fenómeno)
// ------------------------------------------------------------
// Un `<select multiple>` nativo obliga a mantener Ctrl presionado y no se puede
// buscar dentro. Con 32 estados eso no escala, así que se arma un panel propio.
function SelectorMultiple({ etiqueta, opciones, seleccion, onCambio, ancho = 190 }) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const contenedor = useRef(null);

  // Cerrar al hacer clic fuera: sin esto el panel se queda abierto y tapa las
  // gráficas de abajo.
  useEffect(() => {
    if (!abierto) return;
    const alClicFuera = (e) => {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("mousedown", alClicFuera);
    return () => document.removeEventListener("mousedown", alClicFuera);
  }, [abierto]);

  const visibles = opciones.filter((o) =>
    o.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  const resumen =
    seleccion.length === 0
      ? `${etiqueta}: todos`
      : seleccion.length === 1
        ? seleccion[0]
        : `${etiqueta}: ${seleccion.length}`;

  return (
    <div ref={contenedor} style={{ position: "relative" }}>
      <button
        onClick={() => setAbierto((v) => !v)}
        style={{
          ...estiloCampo,
          width: ancho,
          textAlign: "left",
          cursor: "pointer",
          fontWeight: seleccion.length ? 700 : 400,
          color: seleccion.length ? COLOR.texto : COLOR.textoSuave,
          borderColor: seleccion.length ? COLOR.serie : COLOR.borde,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {resumen}
        </span>
        <span style={{ color: COLOR.textoTenue, fontSize: 10 }}>{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            width: Math.max(ancho, 230),
            background: COLOR.superficie,
            border: `1px solid ${COLOR.borde}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 500,
            padding: 9,
          }}
        >
          <input
            autoFocus
            placeholder="Buscar…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ ...estiloCampo, width: "100%", marginBottom: 7 }}
          />

          <div style={{ maxHeight: 230, overflowY: "auto" }}>
            {visibles.length === 0 && (
              <p style={{ margin: 6, fontSize: 12, color: COLOR.textoTenue }}>Sin coincidencias</p>
            )}
            {visibles.map((o) => {
              const activo = seleccion.includes(o);
              return (
                <label
                  key={o}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 6px",
                    borderRadius: 6,
                    fontSize: 12.5,
                    cursor: "pointer",
                    background: activo ? "#eff6ff" : "transparent",
                    fontWeight: activo ? 600 : 400,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={() =>
                      onCambio(activo ? seleccion.filter((s) => s !== o) : [...seleccion, o])
                    }
                    style={{ width: 14, height: 14, padding: 0, margin: 0 }}
                  />
                  {o}
                </label>
              );
            })}
          </div>

          {seleccion.length > 0 && (
            <button
              onClick={() => onCambio([])}
              style={{
                ...estiloCampo,
                width: "100%",
                marginTop: 7,
                cursor: "pointer",
                color: COLOR.textoSuave,
              }}
            >
              Quitar selección ({seleccion.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

SelectorMultiple.propTypes = {
  etiqueta: PropTypes.string.isRequired,
  opciones: PropTypes.array.isRequired,
  seleccion: PropTypes.array.isRequired,
  onCambio: PropTypes.func.isRequired,
  ancho: PropTypes.number,
};

// ------------------------------------------------------------
// Rango de años con dos pulgares
// ------------------------------------------------------------
// El input range nativo tiene un solo pulgar. Se superponen dos y se deja pasar
// el puntero solo a los pulgares (pointerEvents: none en la pista, auto en el
// pulgar) para que ambos sigan siendo arrastrables.
function RangoAños({ min, max, desde, hasta, onCambio }) {
  const pct = (v) => ((v - min) / (max - min)) * 100;

  const estiloPulgar = {
    position: "absolute",
    width: "100%",
    top: 0,
    height: 20,
    margin: 0,
    padding: 0,
    background: "none",
    border: "none",
    appearance: "none",
    WebkitAppearance: "none",
    pointerEvents: "none",
    outline: "none",
  };

  return (
    <div style={{ minWidth: 210 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLOR.textoSuave, marginBottom: 3 }}>
        <span>Años</span>
        <strong style={{ color: COLOR.texto }}>{desde} – {hasta}</strong>
      </div>

      <div style={{ position: "relative", height: 20 }}>
        {/* Pista */}
        <div style={{ position: "absolute", top: 8, left: 0, right: 0, height: 4, borderRadius: 3, background: COLOR.eje }} />
        {/* Tramo seleccionado */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `${pct(desde)}%`,
            width: `${pct(hasta) - pct(desde)}%`,
            height: 4,
            borderRadius: 3,
            background: COLOR.serie,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={desde}
          onChange={(e) => onCambio(Math.min(Number(e.target.value), hasta), hasta)}
          style={{ ...estiloPulgar, zIndex: desde > max - (max - min) / 8 ? 5 : 3 }}
          className="pulgar-rango"
          aria-label="Año inicial"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={hasta}
          onChange={(e) => onCambio(desde, Math.max(Number(e.target.value), desde))}
          style={{ ...estiloPulgar, zIndex: 4 }}
          className="pulgar-rango"
          aria-label="Año final"
        />
      </div>
    </div>
  );
}

RangoAños.propTypes = {
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  desde: PropTypes.number.isRequired,
  hasta: PropTypes.number.isRequired,
  onCambio: PropTypes.func.isRequired,
};

// ------------------------------------------------------------
// Píldora de filtro activo
// ------------------------------------------------------------
function Pildora({ children, onQuitar }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 6px 3px 11px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: "#eff6ff",
        border: `1px solid #bfdbfe`,
        color: COLOR.serieOscura,
      }}
    >
      {children}
      <button
        onClick={onQuitar}
        aria-label="Quitar filtro"
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: COLOR.serieOscura,
          fontSize: 15,
          lineHeight: 1,
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </span>
  );
}

Pildora.propTypes = { children: PropTypes.node, onQuitar: PropTypes.func };

// ============================================================
// BARRA COMPLETA
// ============================================================
export function Controles({
  dimensiones,
  filtro,
  setFiltro,
  metricaClave,
  setMetricaClave,
  totalFiltrado,
  totalGeneral,
  puedeLimpiar,
  onLimpiar,
}) {
  const parche = (cambios) => setFiltro({ ...filtro, ...cambios });

  // Los tipos ofrecidos se acotan a la clasificación elegida: no tiene sentido
  // ofrecer "Sismos" cuando ya se filtró por Hidrometeorológico.
  const tiposDisponibles = filtro.clasificaciones.length
    ? filtro.clasificaciones.flatMap((c) => dimensiones.tipos_por_clasificacion[c] ?? [])
    : dimensiones.tipos;

  const hayFiltrosDeLista =
    filtro.estados.length || filtro.tipos.length || filtro.meses.length || filtro.clasificaciones.length;

  return (
    <div
      style={{
        background: COLOR.superficie,
        border: `1px solid ${COLOR.borde}`,
        borderRadius: 14,
        padding: "14px 18px",
        marginBottom: 20,
        boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
      }}
    >
      {/* Fila 1 — métrica: gobierna QUÉ miden todas las gráficas a la vez */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 13 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLOR.textoSuave, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Medir por
        </span>
        {METRICAS.map((m) => (
          <Chip
            key={m.clave}
            activo={metricaClave === m.clave}
            onClick={() => setMetricaClave(m.clave)}
            titulo={`Expresar todas las gráficas en ${m.unidad}`}
          >
            {m.etiqueta}
          </Chip>
        ))}
      </div>

      {/* Fila 2 — filtros */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <RangoAños
          min={dimensiones.años.min}
          max={dimensiones.años.max}
          desde={filtro.añoMin}
          hasta={filtro.añoMax}
          onCambio={(a, b) => parche({ añoMin: a, añoMax: b })}
        />

        <SelectorMultiple
          etiqueta="Estado"
          opciones={dimensiones.estados}
          seleccion={filtro.estados}
          onCambio={(estados) => parche({ estados })}
        />

        <SelectorMultiple
          etiqueta="Fenómeno"
          opciones={tiposDisponibles}
          seleccion={filtro.tipos}
          onCambio={(tipos) => parche({ tipos })}
        />

        <SelectorMultiple
          etiqueta="Mes"
          opciones={MESES_LARGO}
          seleccion={filtro.meses.map((m) => MESES_LARGO[m - 1])}
          onCambio={(nombres) => parche({ meses: nombres.map((n) => MESES_LARGO.indexOf(n) + 1) })}
          ancho={150}
        />

        <div style={{ display: "flex", gap: 6 }}>
          {dimensiones.clasificaciones.map((c) => (
            <Chip
              key={c}
              activo={filtro.clasificaciones.includes(c)}
              onClick={() => {
                const nuevas = filtro.clasificaciones.includes(c)
                  ? filtro.clasificaciones.filter((x) => x !== c)
                  : [...filtro.clasificaciones, c];
                // Al cambiar de clasificación se sueltan los tipos que ya no
                // pertenecen a ella; si no, quedarían filtros invisibles activos.
                const permitidos = nuevas.length
                  ? nuevas.flatMap((x) => dimensiones.tipos_por_clasificacion[x] ?? [])
                  : dimensiones.tipos;
                parche({
                  clasificaciones: nuevas,
                  tipos: filtro.tipos.filter((t) => permitidos.includes(t)),
                });
              }}
            >
              {c}
            </Chip>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: COLOR.textoSuave }}>
            <strong style={{ color: COLOR.texto }}>{fmtNumero(totalFiltrado)}</strong>
            {" de "}{fmtNumero(totalGeneral)} eventos
          </span>
          <button
            onClick={onLimpiar}
            disabled={!puedeLimpiar}
            style={{
              ...estiloCampo,
              cursor: puedeLimpiar ? "pointer" : "not-allowed",
              fontWeight: 600,
              color: puedeLimpiar ? COLOR.serieOscura : COLOR.textoTenue,
              borderColor: puedeLimpiar ? COLOR.serie : COLOR.borde,
            }}
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Fila 3 — píldoras de lo que está activo */}
      {hayFiltrosDeLista ? (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 13, paddingTop: 12, borderTop: `1px solid ${COLOR.rejilla}` }}>
          {filtro.clasificaciones.map((c) => (
            <Pildora key={`c-${c}`} onQuitar={() => parche({ clasificaciones: filtro.clasificaciones.filter((x) => x !== c) })}>
              {c}
            </Pildora>
          ))}
          {filtro.tipos.map((t) => (
            <Pildora key={`t-${t}`} onQuitar={() => parche({ tipos: filtro.tipos.filter((x) => x !== t) })}>
              {t}
            </Pildora>
          ))}
          {filtro.estados.map((e) => (
            <Pildora key={`e-${e}`} onQuitar={() => parche({ estados: filtro.estados.filter((x) => x !== e) })}>
              {e}
            </Pildora>
          ))}
          {filtro.meses.map((m) => (
            <Pildora key={`m-${m}`} onQuitar={() => parche({ meses: filtro.meses.filter((x) => x !== m) })}>
              {MESES_LARGO[m - 1]}
            </Pildora>
          ))}
        </div>
      ) : null}
    </div>
  );
}

Controles.propTypes = {
  dimensiones: PropTypes.object.isRequired,
  filtro: PropTypes.object.isRequired,
  setFiltro: PropTypes.func.isRequired,
  metricaClave: PropTypes.string.isRequired,
  setMetricaClave: PropTypes.func.isRequired,
  totalFiltrado: PropTypes.number.isRequired,
  totalGeneral: PropTypes.number.isRequired,
  puedeLimpiar: PropTypes.bool.isRequired,
  onLimpiar: PropTypes.func.isRequired,
};
