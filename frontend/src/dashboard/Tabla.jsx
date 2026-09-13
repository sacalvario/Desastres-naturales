// ============================================================
// Tabla de eventos
// ------------------------------------------------------------
// La tabla anterior mostraba los diez eventos más caros y nada más. Esta es la
// vista completa del recorte filtrado: ordenable por cualquier columna,
// paginada y exportable.
//
// Cumple además una función de accesibilidad: es la "vista de tabla" que
// respalda a las gráficas. Quien no distinga los tonos del mapa puede leer aquí
// exactamente los mismos números.
// ============================================================

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { COLOR, MESES, fmtNumero } from "./tema";
import { descargarCSV } from "./datos";

const COLUMNAS = [
  { clave: "año", titulo: "Año", tipo: "numero", ancho: 58 },
  { clave: "mes", titulo: "Mes", tipo: "mes", ancho: 54 },
  { clave: "estado", titulo: "Estado", tipo: "texto" },
  { clave: "tipo", titulo: "Fenómeno", tipo: "texto" },
  { clave: "duracion", titulo: "Días", tipo: "numero", ancho: 54 },
  { clave: "daños", titulo: "Daños (M$)", tipo: "decimal", ancho: 104 },
  { clave: "poblacion", titulo: "Población", tipo: "numero", ancho: 98 },
  { clave: "defunciones", titulo: "Defunciones", tipo: "numero", ancho: 96 },
  { clave: "viviendas", titulo: "Viviendas", tipo: "numero", ancho: 92 },
];

const POR_PAGINA = 12;

export function Tabla({ eventos }) {
  const [orden, setOrden] = useState({ columna: "daños", direccion: "desc" });
  const [pagina, setPagina] = useState(0);

  const ordenados = useMemo(() => {
    const copia = [...eventos];
    const { columna, direccion } = orden;
    const signo = direccion === "asc" ? 1 : -1;

    copia.sort((a, b) => {
      const va = a[columna];
      const vb = b[columna];
      // Los nulos ("SD" en el Excel original) van siempre al final, ordene como
      // ordene: son ausencia de dato, no un cero.
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string") return signo * va.localeCompare(vb, "es");
      return signo * (va - vb);
    });
    return copia;
  }, [eventos, orden]);

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas - 1);
  const visibles = ordenados.slice(paginaSegura * POR_PAGINA, (paginaSegura + 1) * POR_PAGINA);

  const alOrdenar = (clave) => {
    setPagina(0);
    setOrden((prev) =>
      prev.columna === clave
        ? { columna: clave, direccion: prev.direccion === "asc" ? "desc" : "asc" }
        : { columna: clave, direccion: "desc" }
    );
  };

  const formatear = (valor, tipo) => {
    if (valor === null || valor === undefined) return <span style={{ color: COLOR.textoTenue }}>s/d</span>;
    if (tipo === "mes") return MESES[valor - 1] ?? valor;
    if (tipo === "decimal") return fmtNumero(valor, valor < 100 ? 2 : 0);
    if (tipo === "numero") return fmtNumero(valor);
    return valor;
  };

  if (!eventos.length) {
    return (
      <p style={{ margin: 0, padding: "28px 0", textAlign: "center", color: COLOR.textoTenue, fontSize: 13 }}>
        No hay eventos con los filtros actuales
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: COLOR.textoSuave }}>
          {fmtNumero(ordenados.length)} eventos · ordenados por{" "}
          <strong style={{ color: COLOR.texto }}>
            {COLUMNAS.find((c) => c.clave === orden.columna)?.titulo}
          </strong>{" "}
          {orden.direccion === "desc" ? "de mayor a menor" : "de menor a mayor"}
        </span>
        <button
          onClick={() => descargarCSV(ordenados)}
          style={{
            padding: "6px 13px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            cursor: "pointer",
            border: `1px solid ${COLOR.serie}`,
            background: COLOR.superficie,
            color: COLOR.serieOscura,
          }}
        >
          Descargar CSV
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {COLUMNAS.map((c) => {
                const activa = orden.columna === c.clave;
                return (
                  <th
                    key={c.clave}
                    data-ordenable="true"
                    onClick={() => alOrdenar(c.clave)}
                    style={{
                      padding: "9px 11px",
                      textAlign: c.tipo === "texto" || c.tipo === "mes" ? "left" : "right",
                      fontWeight: 700,
                      fontSize: 11.5,
                      color: activa ? COLOR.serieOscura : COLOR.textoSuave,
                      background: "#f9fafb",
                      borderBottom: `2px solid ${COLOR.eje}`,
                      whiteSpace: "nowrap",
                      width: c.ancho,
                    }}
                  >
                    {c.titulo}
                    <span style={{ marginLeft: 4, opacity: activa ? 1 : 0.25 }}>
                      {activa && orden.direccion === "asc" ? "▲" : "▼"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibles.map((e, i) => (
              <tr key={`${e.año}-${e.estado}-${e.tipo}-${i}`} style={{ borderBottom: `1px solid ${COLOR.rejilla}` }}>
                {COLUMNAS.map((c) => (
                  <td
                    key={c.clave}
                    style={{
                      padding: "8px 11px",
                      color: COLOR.textoSuave,
                      textAlign: c.tipo === "texto" || c.tipo === "mes" ? "left" : "right",
                      // Cifras alineadas en columna: aquí sí conviene el ancho
                      // fijo de dígito, para que los millares cuadren.
                      fontVariantNumeric: c.tipo === "texto" ? "normal" : "tabular-nums",
                      fontWeight: c.clave === "daños" ? 700 : 400,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatear(e[c.clave], c.tipo)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
          <button
            onClick={() => setPagina((p) => Math.max(0, p - 1))}
            disabled={paginaSegura === 0}
            style={estiloPaginacion(paginaSegura === 0)}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 12.5, color: COLOR.textoSuave }}>
            Página <strong style={{ color: COLOR.texto }}>{paginaSegura + 1}</strong> de {totalPaginas}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
            disabled={paginaSegura >= totalPaginas - 1}
            style={estiloPaginacion(paginaSegura >= totalPaginas - 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

const estiloPaginacion = (deshabilitado) => ({
  padding: "5px 13px",
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 8,
  border: `1px solid ${COLOR.borde}`,
  background: COLOR.superficie,
  color: deshabilitado ? COLOR.textoTenue : COLOR.textoSuave,
  cursor: deshabilitado ? "not-allowed" : "pointer",
});

Tabla.propTypes = { eventos: PropTypes.array.isRequired };
