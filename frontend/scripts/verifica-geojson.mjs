// Verifica que el GeoJSON de estados tenga la orientacion de anillos que d3-geo requiere.
//
// Contexto: mapshaper escribe los anillos en convencion Shapefile (exterior horario) y d3-geo
// exige la contraria. Con la orientacion invertida d3 interpreta cada estado como su
// complemento -"todo el globo menos el estado"- y el mapa se pinta como una mancha uniforme,
// sin lanzar ningun error. d3.geoArea() lo delata: devuelve ~4pi (12.566 sr, la esfera
// completa) en vez del area real del estado.
//
// Uso: node scripts/verifica-geojson.mjs [ruta-al-geojson]
// Sale con codigo 1 si encuentra algun poligono invertido.

import { readFileSync } from "node:fs";
import { geoArea } from "d3-geo";

const RUTA_POR_DEFECTO = "public/mexico.geojson";
const MEDIA_ESFERA = 2 * Math.PI; // umbral: ningun estado real se acerca a esto

const ruta = process.argv[2] ?? RUTA_POR_DEFECTO;

let geojson;
try {
  geojson = JSON.parse(readFileSync(ruta, "utf8"));
} catch (err) {
  console.error(`No se pudo leer el GeoJSON en "${ruta}": ${err.message}`);
  console.error(`Uso: node scripts/verifica-geojson.mjs [ruta-al-geojson]`);
  process.exit(2); // 2 = problema con la invocacion, no con la geometria
}

const invertidos = geojson.features.filter((f) => geoArea(f) > MEDIA_ESFERA);

console.log(`archivo: ${ruta}`);
console.log(`estados: ${geojson.features.length}`);
console.log(`invertidos: ${invertidos.length}`);

if (invertidos.length > 0) {
  const nombres = invertidos.map((f) => f.properties.name);
  console.error(
    `\nFALLA: ${invertidos.length} poligono(s) con la orientacion invertida.\n` +
      `Estados afectados: ${nombres.slice(0, 5).join(", ")}${nombres.length > 5 ? ", ..." : ""}\n` +
      `El mapa se pintara como una mancha uniforme. Invierte el orden de los vertices\n` +
      `de cada anillo, o re-exporta con la orientacion RFC 7946.`
  );
  process.exit(1);
}

console.log("OK: la orientacion de los anillos es la correcta para d3-geo.");
