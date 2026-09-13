// ============================================================
// Mapa coroplético interactivo de México
// ------------------------------------------------------------
// Tres cambios de fondo frente a la versión anterior:
//
//  1. El mapa filtra. Un clic sobre un estado lo añade o lo quita de la
//     selección, y eso reordena todo el dashboard.
//  2. El mapa ignora su propio filtro. Si respetara la selección de estados, al
//     elegir Veracruz los otros 31 se apagarían y el mapa dejaría de servir para
//     comparar. En su lugar sigue pintando el país completo —ya recortado por
//     año, fenómeno y mes— y marca lo seleccionado con un contorno.
//  3. Responde a la métrica activa: los mismos polígonos expresan daños,
//     población afectada, defunciones, viviendas o número de eventos.
//
// La rampa es de un solo tono (azul, claro → oscuro). Un arcoíris haría que
// saltos de color no correspondieran a saltos de valor.
// ============================================================

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { scaleLinear } from "d3-scale";
import PropTypes from "prop-types";
import { COLOR, RAMPA_SECUENCIAL, fmtCompacto, fmtMetrica, fmtNumero } from "./tema";
import { Tooltip } from "./Graficas";

// El GeoJSON usa los nombres largos y oficiales; los datos usan los nombres
// normalizados por train_model_simple.py. Sin este puente, cuatro estados
// quedarían siempre en gris.
const NOMBRES_GEO = {
  "Coahuila de Zaragoza": "Coahuila",
  "Distrito Federal": "Ciudad de México",
  "Michoacán de Ocampo": "Michoacán",
  "Veracruz de Ignacio de la Llave": "Veracruz",
};

const VISTA_INICIAL = { coordinates: [-102, 24], zoom: 1 };

export function Mapa({ porEstado, metrica, seleccion, onClicEstado }) {
  const [tooltip, setTooltip] = useState(null);
  const [vista, setVista] = useState(VISTA_INICIAL);

  const { indice, maxValor } = useMemo(() => {
    const indice = new Map(porEstado.map((d) => [d.llave, d]));
    return { indice, maxValor: Math.max(...porEstado.map((d) => d.valor), 1) };
  }, [porEstado]);

  // Escala en raíz cuadrada, no lineal: los daños se concentran en unos pocos
  // estados, y una escala lineal dejaría a casi todo el país en el tono más
  // claro, indistinguible del "sin datos".
  const escala = scaleLinear()
    .domain([0, Math.sqrt(maxValor)])
    .range([0, RAMPA_SECUENCIAL.length - 1])
    .clamp(true);

  const colorDe = (valor) => {
    if (!valor) return COLOR.neutro;
    const paso = Math.round(escala(Math.sqrt(valor)));
    return RAMPA_SECUENCIAL[Math.max(1, Math.min(paso, RAMPA_SECUENCIAL.length - 1))];
  };

  const enVistaInicial = vista.zoom === 1 && vista.coordinates[0] === -102;

  return (
    <div style={{ position: "relative" }}>
      {tooltip && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          titulo={
            <span>
              {tooltip.nombre}
              {seleccion.includes(tooltip.nombre) && (
                <span style={{ color: COLOR.serie, fontWeight: 400 }}> · seleccionado</span>
              )}
            </span>
          }
          filas={[
            { etiqueta: metrica.corto, valor: fmtMetrica(tooltip.valor, metrica) },
            { etiqueta: "Eventos", valor: fmtNumero(tooltip.eventos) },
            {
              etiqueta: "Del total nacional",
              valor: `${((tooltip.valor / porEstado.reduce((s, d) => s + d.valor, 0) || 0) * 100).toFixed(1)}%`,
            },
          ]}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: COLOR.textoTenue }}>
          Clic en un estado para filtrar · rueda para acercar · arrastra para mover
        </span>
        {!enVistaInicial && (
          <button
            onClick={() => setVista(VISTA_INICIAL)}
            style={{
              padding: "4px 11px",
              fontSize: 11.5,
              fontWeight: 600,
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${COLOR.borde}`,
              background: COLOR.superficie,
              color: COLOR.textoSuave,
            }}
          >
            Centrar mapa
          </button>
        )}
      </div>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 1600, center: [-102, 24] }}
        style={{ width: "100%", height: "auto" }}
      >
        <ZoomableGroup
          center={vista.coordinates}
          zoom={vista.zoom}
          minZoom={1}
          maxZoom={8}
          onMoveEnd={({ coordinates, zoom }) => setVista({ coordinates, zoom })}
        >
          <Geographies geography="/mexico.geojson">
            {({ geographies }) =>
              geographies.map((geo) => {
                const nombre = NOMBRES_GEO[geo.properties.name] ?? geo.properties.name;
                const dato = indice.get(nombre) ?? { valor: 0, eventos: 0 };
                const activo = seleccion.includes(nombre);
                const relleno = colorDe(dato.valor);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onClick={() => onClicEstado(nombre)}
                    onMouseEnter={(e) =>
                      setTooltip({ x: e.clientX, y: e.clientY, nombre, valor: dato.valor, eventos: dato.eventos })
                    }
                    onMouseMove={(e) =>
                      setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null))
                    }
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      // La selección se marca con un contorno oscuro y grueso,
                      // no cambiando el relleno: el relleno ya está ocupado
                      // codificando la magnitud.
                      default: {
                        fill: relleno,
                        stroke: activo ? COLOR.texto : COLOR.superficie,
                        strokeWidth: activo ? 1.3 : 0.45,
                        outline: "none",
                      },
                      hover: {
                        fill: relleno,
                        fillOpacity: 0.8,
                        stroke: activo ? COLOR.texto : COLOR.serieOscura,
                        strokeWidth: activo ? 1.3 : 1,
                        outline: "none",
                        cursor: "pointer",
                      },
                      pressed: { fill: relleno, outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Leyenda: escalones discretos con sus cortes, para que el color sea
          legible como valor y no solo como "más o menos". */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
          {RAMPA_SECUENCIAL.map((c, i) => (
            <div key={c} style={{ flex: 1, height: 9, background: i === 0 ? COLOR.neutro : c, borderRadius: i === 0 ? "4px 0 0 4px" : i === RAMPA_SECUENCIAL.length - 1 ? "0 4px 4px 0" : 0 }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: COLOR.textoTenue }}>
          <span>Sin registro</span>
          <span>{metrica.corto} por estado</span>
          <span>{fmtCompacto(maxValor)}</span>
        </div>
      </div>
    </div>
  );
}

Mapa.propTypes = {
  porEstado: PropTypes.array.isRequired,
  metrica: PropTypes.object.isRequired,
  seleccion: PropTypes.array.isRequired,
  onClicEstado: PropTypes.func.isRequired,
};
