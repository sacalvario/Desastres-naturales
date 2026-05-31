import { useState } from "react";
import { predict } from "./api";

export default function App() {
  const [form, setForm] = useState({
    Año: new Date().getFullYear(),
    Mes: "",
    Clasificación_del_fenómeno: "",
    Tipo_de_fenómeno: "",
    Estado: "",
    Impacto_humano: "",
    Daños_a_infraestructura: "",
  });

  const [pred, setPred] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const limpiar = () => {
    setForm({
      Año: new Date().getFullYear(),
      Mes: "",
      Clasificación_del_fenómeno: "",
      Tipo_de_fenómeno: "",
      Estado: "",
      Impacto_humano: "",
      Daños_a_infraestructura: "",
    });
    setPred(null);
    setErr("");
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setPred(null);
    setLoading(true);

    try {
      const payload = {
        Año: Number(form.Año),
        Mes: Number(form.Mes),
        Clasificación_del_fenómeno: form.Clasificación_del_fenómeno,
        Tipo_de_fenómeno: form.Tipo_de_fenómeno,
        Estado: form.Estado,
        Impacto_humano: Number(form.Impacto_humano),
        Daños_a_infraestructura: Number(form.Daños_a_infraestructura),
      };

      const data = await predict(payload);
      setPred(data.prediction);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v) => {
    if (v === null || v === undefined) return "-";
    return Number(v).toLocaleString("es-MX", {
      maximumFractionDigits: 2,
    });
  };

  const getNivelImpacto = (valor) => {
    if (valor < 100) {
      return { texto: "Bajo", color: "#22c55e" };
    }

    if (valor < 500) {
      return { texto: "Medio", color: "#f59e0b" };
    }

    return { texto: "Alto", color: "#ef4444" };
  };

  const monto = pred?.["Total de daños (millones de pesos)"] || 0;
  const nivel = getNivelImpacto(monto);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "40px 20px",
        fontFamily: "system-ui, Arial",
      }}
    >
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
          🌪️ Sistema de Predicción de Impacto Económico
        </h1>

        <p
          style={{
            textAlign: "center",
            opacity: 0.72,
            marginBottom: 30,
            fontSize: 16,
          }}
        >
          Modelo de Machine Learning para estimar daños económicos ocasionados
          por desastres naturales en México.
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
              Clasificación del fenómeno
              <select
                name="Clasificación_del_fenómeno"
                value={form.Clasificación_del_fenómeno}
                onChange={onChange}
                required
                style={inputStyle}
              >
                <option value="">Selecciona clasificación</option>
                <option value="Geológico">Geológico</option>
                <option value="Hidrometeorológico">Hidrometeorológico</option>
              </select>
            </label>

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
                <option value="Sequía">Sequía</option>
                <option value="Actividad Volcánica">Actividad Volcánica</option>
                <option value="Ciclones">Ciclones</option>
                <option value="Frío Extremo">Frío Extremo</option>
                <option value="Lluvias e Inundaciones">Lluvias e Inundaciones</option>
                <option value="Sismos">Sismos</option>
                <option value="Viento Extremo">Viento Extremo</option>
                <option value="Calor Extremo">Calor Extremo</option>
                <option value="Movimientos de Masa">Movimientos de Masa</option>
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

          <SectionTitle title="Nivel de afectación reportado" />

          <div style={gridStyle}>
            <label>
              Impacto humano
              <select
                name="Impacto_humano"
                value={form.Impacto_humano}
                onChange={onChange}
                required
                style={inputStyle}
              >
                <option value="">Selecciona categoría</option>
                <option value="1">1 - Muy bajo</option>
                <option value="2">2 - Bajo</option>
                <option value="3">3 - Medio</option>
                <option value="4">4 - Alto</option>
                <option value="5">5 - Muy alto</option>
              </select>
            </label>

            <label>
              Daños a infraestructura
              <select
                name="Daños_a_infraestructura"
                value={form.Daños_a_infraestructura}
                onChange={onChange}
                required
                style={inputStyle}
              >
                <option value="">Selecciona categoría</option>
                <option value="1">1 - Muy bajo</option>
                <option value="2">2 - Bajo</option>
                <option value="3">3 - Medio</option>
                <option value="4">4 - Alto</option>
                <option value="5">5 - Muy alto</option>
              </select>
            </label>
          </div>

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

        {pred && (
          <div style={{ marginTop: 34 }}>
            <h2 style={{ marginBottom: 14 }}>Resultado estimado</h2>

            <div
              style={{
                padding: 24,
                borderRadius: 18,
                border: "1px solid #e5e7eb",
                background: "#fafafa",
              }}
            >
              <p style={{ margin: 0, opacity: 0.7 }}>
                Total de daños estimado
              </p>

              <div
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  marginTop: 6,
                }}
              >
                ${fmt(monto)} millones de pesos
              </div>

              <div
                style={{
                  marginTop: 12,
                  color: nivel.color,
                  fontWeight: "bold",
                  fontSize: 20,
                }}
              >
                Impacto {nivel.texto}
              </div>

              <div
                style={{
                  width: "100%",
                  height: 18,
                  background: "#e5e7eb",
                  borderRadius: 20,
                  overflow: "hidden",
                  marginTop: 16,
                }}
              >
                <div
                  style={{
                    width: `${Math.min((monto / 2000) * 100, 100)}%`,
                    height: "100%",
                    background: nivel.color,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>

            <p style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
              * Estimación basada en modelos estadísticos. Puede variar según
              condiciones reales y calidad de los datos reportados.
            </p>
          </div>
        )}
      </div>
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