import fs from "fs";
import path from "path";
import { generateSFZ, generateManifest, parseSampleFilename } from "../src/sfz-generator.js";

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
  const samples = audioFiles.map((filename) => ({
    filename,
    parsed: parseSampleFilename(filename),
  }));
  const invalidFiles = samples.filter((sample) => !sample.parsed).map((sample) => sample.filename);
  if (invalidFiles.length) {
    throw new Error(
      `No se pudieron interpretar estos nombres de sample (se requiere dinámica y nota/octava válidas): ${invalidFiles.join(", ")}`
    );
  }

  const sfzFiles = files.filter((filename) => /\.sfz$/i.test(filename));
  const outputSFZName = `${instrumentName.toLowerCase()}.sfz`;
  const matchingOutput = sfzFiles.find((filename) => filename.toLowerCase() === outputSFZName.toLowerCase());
  const sourceCandidates = sfzFiles.filter(
    (filename) => !matchingOutput || filename.toLowerCase() !== matchingOutput.toLowerCase()
  );
  if (sourceCandidates.length === 0 && matchingOutput) sourceCandidates.push(matchingOutput);
  if (sourceCandidates.length === 0) sourceCandidates.push(...sfzFiles);
  if (sourceCandidates.length > 1) {
    throw new Error(
      `Hay varios SFZ fuente posibles (${sourceCandidates.join(", ")}). Deja un único SFZ fuente aparte del archivo de salida.`
    );
  }
  const sourceSFZText = sourceCandidates.length
    ? fs.readFileSync(path.join(resolvedDir, sourceCandidates[0]), "utf8")
    : undefined;

  const sfzContent = generateSFZ(audioFiles, { instrumentName, sourceSFZText });
  const manifest = generateManifest(audioFiles, { sourceSFZText });

  const destinations = new Map();
  for (const { filename, parsed } of samples) {
    const targetKey = parsed.normalizedFilename.toLowerCase();
    const previous = destinations.get(targetKey);
    if (previous) {
      throw new Error(
        `Colisión: "${previous}" y "${filename}" se convertirían en "${parsed.normalizedFilename}". Renombra o separa una de las muestras antes de generar el SFZ.`
      );
    }
    destinations.set(targetKey, filename);
  }

  const existingNames = new Set(files.map((filename) => filename.toLowerCase()));
  const renameJobs = samples
    .filter(({ filename, parsed }) => filename !== parsed.normalizedFilename)
    .map(({ filename, parsed }, index) => ({
      source: filename,
      target: parsed.normalizedFilename,
      temporary: `.valenkar-sfz-${process.pid}-${index}.tmp`,
    }));

  for (const job of renameJobs) {
    if (existingNames.has(job.target.toLowerCase()) && job.target.toLowerCase() !== job.source.toLowerCase()) {
      throw new Error(`No se puede renombrar "${job.source}": ya existe "${job.target}".`);
    }
    if (existingNames.has(job.temporary.toLowerCase())) {
      throw new Error(`No se puede renombrar "${job.source}": el nombre temporal "${job.temporary}" ya existe.`);
    }
  }

  const staged = [];
  const completed = [];
  try {
    for (const job of renameJobs) {
      fs.renameSync(path.join(resolvedDir, job.source), path.join(resolvedDir, job.temporary));
      staged.push(job);
    }
    for (const job of renameJobs) {
      fs.renameSync(path.join(resolvedDir, job.temporary), path.join(resolvedDir, job.target));
      completed.push(job);
    }
  } catch (err) {
    const rollbackErrors = [];
    for (const job of completed.reverse()) {
      try {
        fs.renameSync(path.join(resolvedDir, job.target), path.join(resolvedDir, job.temporary));
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    for (const job of staged.reverse()) {
      try {
        if (fs.existsSync(path.join(resolvedDir, job.temporary))) {
          fs.renameSync(path.join(resolvedDir, job.temporary), path.join(resolvedDir, job.source));
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`Falló el renombrado y también su reversión: ${err.message}. ${rollbackErrors.join("; ")}`);
    }
    throw err;
  }

  console.log(`✓ Samples normalizados: ${renameJobs.length} renombrados, ${samples.length - renameJobs.length} ya tenían el formato correcto.`);

  const sfzPath = path.join(resolvedDir, outputSFZName);
  fs.writeFileSync(sfzPath, sfzContent, "utf8");
  console.log(`✓ Archivo SFZ generado con éxito: ${sfzPath}`);

  const manifestPath = path.join(resolvedDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✓ Archivo manifest.json generado con éxito: ${manifestPath}`);

  // Actualizar automáticamente el catálogo público en public/library/index.json
  const libraryIndexFile = path.resolve("public/library/index.json");
  let catalog = [];
  if (fs.existsSync(libraryIndexFile)) {
    try {
      catalog = JSON.parse(fs.readFileSync(libraryIndexFile, "utf8"));
    } catch (_) {}
  }
  const relPath = path.relative(path.resolve("public"), sfzPath).replace(/\\/g, "/");
  const existingIdx = catalog.findIndex((item) => item.id === instrumentName.toLowerCase());
  const entry = {
    id: instrumentName.toLowerCase(),
    name: instrumentName.charAt(0).toUpperCase() + instrumentName.slice(1),
    path: relPath,
  };
  if (existingIdx >= 0) {
    catalog[existingIdx] = entry;
  } else {
    catalog.push(entry);
  }
  fs.writeFileSync(libraryIndexFile, JSON.stringify(catalog, null, 2), "utf8");
  console.log(`✓ Catálogo de librerías actualizado en: ${libraryIndexFile}`);
} catch (err) {
  console.error("Error generando archivos:", err.message);
  process.exit(1);
}
