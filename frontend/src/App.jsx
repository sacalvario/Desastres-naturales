import { useEffect, useState } from "react";
import PropTypes from "prop-types";

import { intensidades, predict } from "./api";
import DashboardHistorico from "./DashboardHistorico";

// El predictor cubre los dos fenómenos para los que existe una medida física de
// intensidad: lluvia acumulada para las inundaciones y viento sostenido para los
// ciclones. El modelo se entrena solo con ellos, así que ofrecer más tipos en el
// formulario prometería predicciones que el backend rechaza con un 503.
//
// La clasificación del fenómeno desapareció del formulario: en este dataset todos
// los eventos son hidrometeorológicos, de modo que era un campo con una sola
// respuesta posible.
const TIPOS = ["Lluvias e Inundaciones", "Ciclones"];

// ============================================================
// Escalas de impacto
// ------------------------------------------------------------
// La barra del resultado no es un porcentaje arbitrario: es una escala con los
// cortes de banda clavados SIEMPRE en la misma marca del riel (40% y 70%). Por
// construcción, el color y el llenado ya no pueden contradecirse: si el texto
// dice "Alto", la barra está pasada del 70%. Antes no era así — el ancho salía
// de min(monto / 2000, 1) mientras los cortes estaban en 100 y 500, así que un
// evento de 500 M se pintaba de rojo "Impacto Alto" con la barra al 25%, y
// cruzar de Bajo a Medio (99 -> 100) movía la barra 0.05%.
//
// Dentro de cada banda se interpola en log1p, no linealmente, porque la
// distribución es muy sesgada: la mediana del daño es 0.16 M y el máximo
// 84,207 M (Otis, Guerrero, octubre 2023). Con escala lineal, 19 de cada 20
// predicciones quedarían pegadas al extremo izquierdo, indistinguibles entre
// sí. Es el mismo motivo por el que los modelos entrenan sobre log1p.
//
// Los cortes, el techo y la rejilla `ecdf` salen de los 2,674 eventos de
// backend/app/artifacts/data.joblib (2000-2023). Son una foto del dataset: si
// se reentrena con datos nuevos, hay que recalcularlos.
//
// `ESCALAS` está indexado por el nombre EXACTO del campo que devuelve
// /predict. La UI recorre las claves de la respuesta, no una lista fija: si el
// contrato de la API cambia (se quita una métrica o se agrega otra), las
// tarjetas siguen a la respuesta. Una métrica sin escala registrada se muestra
// como número sin barra en vez de romper la pantalla.
// ============================================================

const NIVELES = {
  bajo: { texto: "Bajo", color: "#16a34a", fondo: "#f0fdf4", borde: "#bbf7d0" },
  medio: { texto: "Medio", color: "#d97706", fondo: "#fffbeb", borde: "#fde68a" },
  alto: { texto: "Alto", color: "#dc2626", fondo: "#fef2f2", borde: "#fecaca" },
};

const PERIODO = "2000-2023";

const ESCALAS = {
  "Total de daños (millones de pesos)": {
    etiqueta: "Daño económico estimado",
    unidad: "millones de pesos",
    prefijo: "$",
    formato: "moneda",
    nEventos: "2,674",
    textoCero: "Sin daños económicos estimados",
    notaCero:
      "472 de los 2,674 eventos registrados tampoco reportaron daño económico.",
    nota: "Costo directo estimado del evento en el estado seleccionado.",
    bandas: [
      { hasta: 100, posicion: 0.4, nivel: NIVELES.bajo },
      { hasta: 500, posicion: 0.7, nivel: NIVELES.medio },
      { hasta: 84207.02, posicion: 1, nivel: NIVELES.alto },
    ],
    marcas: [
      { posicion: 0.4, etiqueta: "$100 M" },
      { posicion: 0.7, etiqueta: "$500 M" },
    ],
    // P(daño <= x) sobre los 2,674 eventos, en por ciento.
    ecdf: [
      [0, 17.65], [0.001, 17.76], [0.01, 21.28], [0.1, 40.2], [0.5, 57.7],
      [1, 63.8], [5, 74.61], [10, 79.13], [25, 83.4], [50, 85.83],
      [100, 87.85], [250, 91.88], [500, 94.5], [1000, 97.08], [2500, 98.92],
      [5000, 99.44], [10000, 99.63], [25000, 99.93], [50000, 99.96],
      [84207.02, 100],
    ],
  },
};

/** Banda (Bajo/Medio/Alto) a la que pertenece un valor. */
function bandaDe(valor, bandas) {
  const v = Math.max(0, Number(valor) || 0);
  return bandas.find((b) => v < b.hasta) ?? bandas[bandas.length - 1];
}

/**
 * Posición del valor en el riel, de 0 a 1.
 * Interpolación log1p dentro de cada banda; los bordes de banda caen exactamente
 * en `posicion`, que es lo que mantiene coherentes color y llenado.
 */
function posicionEnEscala(valor, bandas) {
  const v = Math.max(0, Number(valor) || 0);
  let piso = 0;
  let posPiso = 0;

  for (const banda of bandas) {
    const esUltima = banda === bandas[bandas.length - 1];

    if (v < banda.hasta || esUltima) {
      const lo = Math.log1p(piso);
      const hi = Math.log1p(banda.hasta);
      const t = hi > lo ? (Math.log1p(v) - lo) / (hi - lo) : 0;
      const acotado = Math.min(1, Math.max(0, t));
      return posPiso + (banda.posicion - posPiso) * acotado;
    }

    piso = banda.hasta;
    posPiso = banda.posicion;
  }

  return 1;
}

/** Porcentaje de eventos históricos con valor menor o igual. Interpola en log1p. */
function percentilHistorico(valor, ecdf) {
  if (!ecdf?.length) return null;

  const v = Math.max(0, Number(valor) || 0);
  if (v <= ecdf[0][0]) return ecdf[0][1];

  for (let i = 1; i < ecdf.length; i += 1) {
    const [x0, y0] = ecdf[i - 1];
    const [x1, y1] = ecdf[i];

    if (v <= x1) {
      const lo = Math.log1p(x0);
      const hi = Math.log1p(x1);
      const t = hi > lo ? (Math.log1p(v) - lo) / (hi - lo) : 1;
      return y0 + (y1 - y0) * t;
    }
  }

  return 100;
}

/**
 * Decimales adaptativos. La API expone los daños con CUATRO decimales a
 * propósito: el daño no nulo más pequeño del registro es 0.00047 M y 76 eventos
 * caen por debajo de 0.005. Formatear a dos decimales los mostraría como "$0",
 * reintroduciendo en la pantalla el mismo error que el backend ya corrigió.
 */
function fmtValor(valor, escala) {
  const n = Number(valor) || 0;

  if (escala?.formato !== "moneda") {
    return Math.round(n).toLocaleString("es-MX");
  }

  const decimales = n < 0.01 ? 4 : n < 1 ? 3 : n < 1000 ? 2 : 0;
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

const ESTILOS_PROGRESO = `
@keyframes pred-barrido {
  0%   { transform: translateX(-110%); }
  100% { transform: translateX(340%); }
}
.pred-riel-indeterminado::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 30%;
  border-radius: 20px;
  background: linear-gradient(90deg, rgba(148,163,184,0) 0%, #94a3b8 50%, rgba(148,163,184,0) 100%);
  animation: pred-barrido 1.2s ease-in-out infinite;
}
@keyframes pred-latido {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
.pred-esqueleto { animation: pred-latido 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .pred-riel-indeterminado::after { animation-duration: 3.5s; }
  .pred-esqueleto { animation: none; opacity: 0.6; }
}
`;

export default function App() {
  const [tab, setTab] = useState("predictor");

  const [form, setForm] = useState({
    Año: new Date().getFullYear(),
    Mes: "",
    Tipo_de_fenómeno: "",
    Estado: "",
    intensidad: "",
  });

  // Catálogo de intensidades por tipo, servido por GET /intensidades.
  const [catalogoIntensidad, setCatalogoIntensidad] = useState({});

  const [pred, setPred] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Segundos transcurridos de la petición en curso, y duración congelada de la
  // última predicción lograda. Sirven para que la espera no sea muda.
  const [segundos, setSegundos] = useState(0);
  const [duracion, setDuracion] = useState(null);

  // Qué tarjetas dibujar mientras aún no hay respuesta. Arranca con las métricas
  // conocidas y se reajusta a lo que /predict devolvió la última vez.
  //
  // Ojo con el alcance de ese auto-ajuste: solo corrige DESPUÉS de la primera
  // respuesta. En la primera carga de la página el esqueleto se dibuja a partir
  // de ESCALAS, así que si se quita una métrica del contrato de /predict sin
  // quitar su entrada de ESCALAS, el usuario ve una tarjeta fantasma durante esa
  // primera espera. Al cambiar el contrato, borrar también la entrada.
  const [clavesEsperadas, setClavesEsperadas] = useState(() =>
    Object.keys(ESCALAS),
  );

  // Las categorías de intensidad vienen del backend: los cortes de lluvia son
  // cuantiles del entrenamiento y cambian si se reentrena. Si la petición falla,
  // el selector queda vacío y la predicción sigue funcionando como "Desconocida",
  // así que no se interrumpe al usuario con un error por esto.
  useEffect(() => {
    let vigente = true;
    intensidades()
      .then((tipos) => {
        if (vigente) setCatalogoIntensidad(tipos);
      })
      .catch(() => {
        if (vigente) setCatalogoIntensidad({});
      });
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) return undefined;

    const t0 = Date.now();
    setSegundos(0);
    const id = setInterval(() => setSegundos((Date.now() - t0) / 1000), 200);

    return () => clearInterval(id);
  }, [loading]);

  const onChange = (e) => {
    const { name, value } = e.target;

    // Cada tipo tiene su propia escala de intensidad, así que al cambiar de tipo
    // la categoría elegida deja de ser válida.
    if (name === "Tipo_de_fenómeno") {
      setForm({ ...form, Tipo_de_fenómeno: value, intensidad: "" });
      return;
    }

    setForm({ ...form, [name]: value });
  };

  const limpiar = () => {
    setForm({
      Año: new Date().getFullYear(),
      Mes: "",
      Tipo_de_fenómeno: "",
      Estado: "",
      intensidad: "",
    });
    setPred(null);
    setErr("");
    setDuracion(null);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setPred(null);
    setDuracion(null);
    setLoading(true);

    const t0 = Date.now();

    try {
      const payload = {
        Año: Number(form.Año),
        Mes: Number(form.Mes),
        Tipo_de_fenómeno: form.Tipo_de_fenómeno,
        Estado: form.Estado,
        // Sin categoría elegida, el backend usa "Desconocida".
        intensidad: form.intensidad || null,
      };

      const data = await predict(payload);
      const prediccion = data.prediction ?? {};

      setPred(prediccion);
      setDuracion((Date.now() - t0) / 1000);

      const claves = Object.keys(prediccion);
      if (claves.length > 0) setClavesEsperadas(claves);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Las tarjetas siguen a la respuesta, no a una lista fija de campos.
  const claves = pred ? Object.keys(pred) : clavesEsperadas;

  // /predict es un solo viaje de red: no hay etapas internas que informar, así
  // que en vez de inventar porcentajes se informa el tiempo y, si se alarga, el
  // motivo más probable (el backend despertando tras estar inactivo).
  const textoEspera =
    segundos < 4
      ? "Consultando el modelo…"
      : "Consultando el modelo… puede tardar si el servidor llevaba rato inactivo.";

  const opcionesIntensidad = catalogoIntensidad[form.Tipo_de_fenómeno] ?? [];

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "system-ui, Arial" }}>
      <style>{ESTILOS_PROGRESO}</style>

      {/* Barra de pestañas */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "0 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", gap: 4 }}>
          {[
            { id: "predictor", label: "Predictor de impacto" },
            { id: "dashboard", label: "Dashboard histórico" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                padding: "14px 20px",
                border: "none",
                borderBottom: tab === id ? "3px solid #111827" : "3px solid transparent",
                background: "transparent",
                fontWeight: tab === id ? 700 : 500,
                color: tab === id ? "#111827" : "#6b7280",
                cursor: "pointer",
                fontSize: 14,
                transition: "color 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido de la pestaña Dashboard */}
      {tab === "dashboard" && <DashboardHistorico />}

      {/* Contenido de la pestaña Predictor */}
      {tab === "predictor" && (
      <div style={{ padding: "40px 20px" }}>
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          background: "#ffffff",
          padding: 32,
          borderRadius: 22,
          boxShadow: "0 12px 35px rgba(0,0,0,0.08)",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            marginBottom: 10,
            fontSize: 34,
          }}
        >
           Sistema de Predicción de Impacto Económico por Desastres Naturales
        </h1>

        <p
          style={{
            textAlign: "center",
            opacity: 0.72,
            marginBottom: 30,
            fontSize: 16,
          }}
        >
          Modelo de Machine Learning que estima el daño económico de un desastre
          natural en México a partir del tipo de fenómeno, su intensidad y el
          estado. Al indicar la intensidad se responde a un escenario concreto:
          cuánto costaría un evento de esa fuerza en ese lugar.
        </p>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
          <SectionTitle title="Datos del evento" />

          <div style={gridStyle}>
            <label>
              Año
              <input
                name="Año"
                type="number"
                value={form.Año}
                onChange={onChange}
                required
                style={inputStyle}
              />
            </label>

            <label>
              Mes
              <select
                name="Mes"
                value={form.Mes}
                onChange={onChange}
                required
                style={inputStyle}
              >
                <option value="">Selecciona mes</option>
                <option value="1">Enero</option>
                <option value="2">Febrero</option>
                <option value="3">Marzo</option>
                <option value="4">Abril</option>
                <option value="5">Mayo</option>
                <option value="6">Junio</option>
                <option value="7">Julio</option>
                <option value="8">Agosto</option>
                <option value="9">Septiembre</option>
                <option value="10">Octubre</option>
                <option value="11">Noviembre</option>
                <option value="12">Diciembre</option>
              </select>
            </label>
          </div>

          <div style={gridStyle}>
            <label>
              Tipo de fenómeno
              <select
                name="Tipo_de_fenómeno"
                value={form.Tipo_de_fenómeno}
                onChange={onChange}
                required
                style={inputStyle}
              >
                <option value="">Selecciona tipo de fenómeno</option>
                {TIPOS.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Intensidad del evento
              <select
                name="intensidad"
                value={form.intensidad}
                onChange={onChange}
                disabled={!form.Tipo_de_fenómeno}
                style={{
                  ...inputStyle,
                  background: !form.Tipo_de_fenómeno ? "#f3f4f6" : "white",
                  cursor: !form.Tipo_de_fenómeno ? "not-allowed" : "pointer",
                }}
              >
                <option value="">
                  {form.Tipo_de_fenómeno ? "Selecciona intensidad" : ""}
                </option>

                {opcionesIntensidad.map((opcion) => (
                  <option key={opcion.etiqueta} value={opcion.etiqueta}>
                    {opcion.etiqueta} ({opcion.rango})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Estado
            <select
              name="Estado"
              value={form.Estado}
              onChange={onChange}
              required
              style={inputStyle}
            >
              <option value="">Selecciona estado</option>
              <option value="Aguascalientes">Aguascalientes</option>
              <option value="Baja California">Baja California</option>
              <option value="Baja California Sur">Baja California Sur</option>
              <option value="Campeche">Campeche</option>
              <option value="Chiapas">Chiapas</option>
              <option value="Chihuahua">Chihuahua</option>
              <option value="Ciudad de México">Ciudad de México</option>
              <option value="Coahuila">Coahuila</option>
              <option value="Colima">Colima</option>
              <option value="Durango">Durango</option>
              <option value="Estado de México">Estado de México</option>
              <option value="Guanajuato">Guanajuato</option>
              <option value="Guerrero">Guerrero</option>
              <option value="Hidalgo">Hidalgo</option>
              <option value="Jalisco">Jalisco</option>
              <option value="Michoacán">Michoacán</option>
              <option value="Morelos">Morelos</option>
              <option value="Nayarit">Nayarit</option>
              <option value="Nuevo León">Nuevo León</option>
              <option value="Oaxaca">Oaxaca</option>
              <option value="Puebla">Puebla</option>
              <option value="Querétaro">Querétaro</option>
              <option value="Quintana Roo">Quintana Roo</option>
              <option value="San Luis Potosí">San Luis Potosí</option>
              <option value="Sinaloa">Sinaloa</option>
              <option value="Sonora">Sonora</option>
              <option value="Tabasco">Tabasco</option>
              <option value="Tamaulipas">Tamaulipas</option>
              <option value="Tlaxcala">Tlaxcala</option>
              <option value="Veracruz">Veracruz</option>
              <option value="Yucatán">Yucatán</option>
              <option value="Zacatecas">Zacatecas</option>
            </select>
          </label>

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button type="submit" style={buttonStyle} disabled={loading}>
              {loading ? "Calculando..." : "Predecir impacto"}
            </button>

            <button type="button" onClick={limpiar} style={buttonSecondaryStyle}>
              Limpiar
            </button>
          </div>
        </form>

        {err && (
          <p style={{ color: "#dc2626", marginTop: 18, fontWeight: 600 }}>
            ❌ {err}
          </p>
        )}

        {(loading || pred) && (
          <div style={{ marginTop: 34 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 14,
              }}
            >
              <h2 style={{ margin: 0 }}>Resultado estimado</h2>

              <span
                style={{ fontSize: 13, color: "#6b7280" }}
                aria-live="polite"
              >
                {loading
                  ? `${textoEspera} ${segundos.toFixed(1)} s`
                  : duracion !== null
                    ? `Calculado en ${duracion.toFixed(1)} s`
                    : ""}
              </span>
            </div>

            <div style={gridStyle}>
              {claves.map((clave) => (
                <TarjetaMetrica
                  key={clave}
                  clave={clave}
                  valor={pred?.[clave]}
                  cargando={loading}
                />
              ))}
            </div>

            <p style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
              * Estimación basada en modelos estadísticos. Puede variar según
              condiciones reales y calidad de los datos reportados.
            </p>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

function SectionTitle({ title }) {
  return (
    <h3
      style={{
        margin: "10px 0 0",
        paddingBottom: 8,
        borderBottom: "1px solid #e5e7eb",
        color: "#111827",
      }}
    >
      {title}
    </h3>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: 14,
};

const inputStyle = {
  width: "100%",
  padding: 11,
  marginTop: 6,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  fontSize: 15,
  boxSizing: "border-box",
};

const buttonStyle = {
  padding: "12px 18px",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  background: "#111827",
  color: "white",
  fontWeight: 700,
};

const buttonSecondaryStyle = {
  padding: "12px 18px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  cursor: "pointer",
  background: "white",
  fontWeight: 700,
};

/**
 * El riel de la predicción.
 *
 * Es UNA sola barra que vive en el mismo sitio durante todo el ciclo: mientras
 * se calcula muestra un barrido indeterminado, y cuando llega el resultado se
 * llena hasta la posición del valor. Deliberadamente NO finge un porcentaje
 * durante la carga: /predict es un único viaje de red, no hay etapas reales que
 * medir, y una barra que avanzara al 90% para luego retroceder al 12% al
 * aterrizar un impacto Bajo se leería como un error. Las marcas de banda ya
 * están dibujadas mientras carga, así que el resultado llega a una escala que
 * el usuario ya tenía delante: la barra se rellena, no se reinventa.
 */
function BarraEscala({ cargando, posicion, color, marcas }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        className={cargando ? "pred-riel-indeterminado" : undefined}
        style={{
          position: "relative",
          width: "100%",
          height: 18,
          background: "#e5e7eb",
          borderRadius: 20,
          overflow: "hidden",
        }}
      >
        {!cargando && (
          <div
            style={{
              width: `${(posicion * 100).toFixed(2)}%`,
              height: "100%",
              background: color,
              borderRadius: 20,
              transition:
                "width 0.55s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.35s ease",
            }}
          />
        )}

        {marcas.map((m) => (
          <div
            key={m.etiqueta}
            style={{
              position: "absolute",
              left: `${m.posicion * 100}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: "rgba(17,24,39,0.25)",
              pointerEvents: "none",
            }}
          />
        ))}
      </div>

      <div style={{ position: "relative", height: 15, marginTop: 5 }}>
        <span style={etiquetaMarcaStyle(0)}>0</span>

        {marcas.map((m) => (
          <span key={m.etiqueta} style={etiquetaMarcaStyle(m.posicion)}>
            {m.etiqueta}
          </span>
        ))}
      </div>
    </div>
  );
}

BarraEscala.propTypes = {
  cargando: PropTypes.bool,
  posicion: PropTypes.number,
  color: PropTypes.string,
  marcas: PropTypes.arrayOf(
    PropTypes.shape({
      posicion: PropTypes.number.isRequired,
      etiqueta: PropTypes.string.isRequired,
    }),
  ).isRequired,
};

function etiquetaMarcaStyle(posicion) {
  return {
    position: "absolute",
    left: `${posicion * 100}%`,
    transform: posicion === 0 ? "none" : "translateX(-50%)",
    fontSize: 11,
    color: "#6b7280",
    whiteSpace: "nowrap",
  };
}

/**
 * Una métrica de la respuesta de /predict.
 * `clave` es el nombre exacto del campo devuelto por la API. Si no hay escala
 * registrada para esa clave, cae a una tarjeta sin barra en lugar de romperse.
 */
function TarjetaMetrica({ clave, valor, cargando }) {
  const escala = ESCALAS[clave];

  if (!escala) {
    return (
      <div style={tarjetaStyle}>
        <p style={{ margin: 0, opacity: 0.7 }}>{clave}</p>
        <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6 }}>
          {cargando ? "—" : Number(valor ?? 0).toLocaleString("es-MX")}
        </div>
      </div>
    );
  }

  const v = Math.max(0, Number(valor) || 0);
  const banda = bandaDe(v, escala.bandas);
  const posicion = posicionEnEscala(v, escala.bandas);
  const percentil = percentilHistorico(v, escala.ecdf);
  const esCero = !cargando && v === 0;

  return (
    <div
      style={{
        ...tarjetaStyle,
        borderColor: cargando ? "#e5e7eb" : banda.nivel.borde,
        background: cargando ? "#fafafa" : banda.nivel.fondo,
      }}
    >
      <p style={{ margin: 0, opacity: 0.7 }}>{escala.etiqueta}</p>

      <div style={{ marginTop: 6, minHeight: 42 }}>
        {cargando ? (
          <span
            className="pred-esqueleto"
            style={{
              display: "inline-block",
              width: "65%",
              height: 30,
              borderRadius: 7,
              background: "#e5e7eb",
            }}
          />
        ) : esCero ? (
          <span style={{ fontSize: 21, fontWeight: 700, color: "#374151" }}>
            {escala.textoCero}
          </span>
        ) : (
          <span style={{ fontSize: 32, fontWeight: 800 }}>
            {escala.prefijo}
            {fmtValor(v, escala)}{" "}
            <span style={{ fontSize: 16, fontWeight: 600 }}>{escala.unidad}</span>
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          fontWeight: "bold",
          fontSize: 20,
          minHeight: 26,
          color: cargando ? "#9ca3af" : banda.nivel.color,
        }}
      >
        {cargando ? "Calculando…" : `Impacto ${banda.nivel.texto}`}
      </div>

      <BarraEscala
        cargando={cargando}
        posicion={posicion}
        color={banda.nivel.color}
        marcas={escala.marcas}
      />

      <p
        style={{
          marginTop: 12,
          fontSize: 12.5,
          lineHeight: 1.45,
          color: "#4b5563",
          minHeight: 36,
        }}
      >
        {cargando
          ? " "
          : esCero
            ? escala.notaCero
            : `Por encima del ${percentil.toFixed(percentil >= 99.5 ? 2 : 1)}% de los ${escala.nEventos} eventos registrados (${PERIODO}). ${escala.nota}`}
      </p>
    </div>
  );
}

TarjetaMetrica.propTypes = {
  clave: PropTypes.string.isRequired,
  valor: PropTypes.number,
  cargando: PropTypes.bool,
};

const tarjetaStyle = {
  padding: 24,
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  background: "#fafafa",
  transition: "background-color 0.35s ease, border-color 0.35s ease",
};
