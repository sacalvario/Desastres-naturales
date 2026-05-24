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

      // El backend devuelve:
      // { prediction: { "Total de daños (millones de pesos)": valor } }
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

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>🌪️ Predicción de impacto económico por desastres</h1>
      <p style={{ opacity: 0.7 }}>
        Estimación del total de daños en millones de pesos con base en datos históricos de México.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
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
          <input
            name="Tipo_de_fenómeno"
            value={form.Tipo_de_fenómeno}
            onChange={onChange}
            placeholder="Ej. Huracán, Lluvia, Sismo..."
            required
            style={inputStyle}
          />
        </label>

        <label>
          Estado
          <input
            name="Estado"
            value={form.Estado}
            onChange={onChange}
            placeholder="Ej. Jalisco"
            required
            style={inputStyle}
          />
        </label>

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

        <div style={{ display: "flex", gap: 10 }}>
          <button type="submit" style={buttonStyle}>
            {loading ? "Calculando..." : "Predecir"}
          </button>
          <button type="button" onClick={limpiar} style={buttonSecondaryStyle}>
            Limpiar
          </button>
        </div>
      </form>

      {err && <p style={{ color: "red", marginTop: 14 }}>❌ {err}</p>}

      {pred && (
        <div style={{ marginTop: 24 }}>
          <h2>Resultado estimado</h2>

          <Card
            title="Total de daños estimado"
            value={`${fmt(pred["Total de daños (millones de pesos)"])} millones de pesos`}
          />

          <p style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>
            * Estimación basada en modelos estadísticos. Puede variar según condiciones reales.
          </p>
        </div>
      )}
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div
      style={{
        padding: 18,
        border: "1px solid #ddd",
        borderRadius: 12,
        background: "#fafafa",
        marginTop: 10,
      }}
    >
      <b>{title}</b>
      <div style={{ fontSize: 24, marginTop: 8 }}>{value}</div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 10,
  marginTop: 4,
  border: "1px solid #ccc",
  borderRadius: 8,
};

const buttonStyle = {
  padding: "10px 16px",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  background: "#111827",
  color: "white",
};

const buttonSecondaryStyle = {
  padding: "10px 16px",
  border: "1px solid #ccc",
  borderRadius: 8,
  cursor: "pointer",
  background: "white",
};