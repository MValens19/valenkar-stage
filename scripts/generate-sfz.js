import fs from "fs";
import path from "path";
import { generateSFZ, generateManifest } from "../src/sfz-generator.js";

const targetDir = process.argv[2] || "public/library/piano";
const instrumentName = process.argv[3] || path.basename(targetDir);

const resolvedDir = path.resolve(targetDir);
if (!fs.existsSync(resolvedDir)) {
  console.error("Directorio no encontrado:", resolvedDir);
  process.exit(1);
}

const files = fs.readdirSync(resolvedDir);
const audioFiles = files.filter((f) => /\.(flac|wav|mp3|ogg)$/i.test(f));

if (audioFiles.length === 0) {
  console.warn("No se encontraron archivos de audio en:", resolvedDir);
  process.exit(0);
}

console.log(`Analizando ${audioFiles.length} archivos de audio para "${instrumentName}"...`);

try {
  const sfzContent = generateSFZ(audioFiles, { instrumentName });
  const sfzPath = path.join(resolvedDir, `${instrumentName.toLowerCase()}.sfz`);
  fs.writeFileSync(sfzPath, sfzContent, "utf8");
  console.log(`✓ Archivo SFZ generado con éxito: ${sfzPath}`);

  const manifest = generateManifest(audioFiles);
  const manifestPath = path.join(resolvedDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✓ Archivo manifest.json generado con éxito: ${manifestPath}`);
} catch (err) {
  console.error("Error generando archivos:", err.message);
  process.exit(1);
}
