const NOTE_MAP = {
  c: 0, "c#": 1, cs: 1, db: 1, df: 1,
  d: 2, "d#": 3, ds: 3, eb: 3, ef: 3,
  e: 4,
  f: 5, "f#": 6, fs: 6, gb: 6, gf: 6,
  g: 7, "g#": 8, gs: 8, ab: 8, af: 8,
  a: 9, "a#": 10, as: 10, bb: 10, bf: 10,
  b: 11,
};

/**
 * Convierte un nombre de nota (ej: "C4", "Cs1", "Fs3", "Bb2") a número MIDI (0-127).
 */
export function noteToMidi(noteStr) {
  const match = noteStr.trim().match(/^([A-Ga-g][#sb]?)(-?\d+)$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const octave = parseInt(match[2], 10);
  if (NOTE_MAP[name] === undefined) return null;
  return (octave + 1) * 12 + NOTE_MAP[name];
}

/**
 * Convierte un número MIDI a nombre legible (ej: 60 -> "C4", 21 -> "A0").
 */
export function midiToNote(midi) {
  const NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];
  const note = NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Analiza un nombre de archivo para extraer nota, octava, midi y capa.
 * Soporta patrones como:
 * - A0_v1.flac
 * - Cs2_v3.wav
 * - Piano_C4_v2.mp3
 */
export function parseSampleFilename(filename) {
  const base = filename.split(/[/\\]/).pop();
  // Patrón: NotaOctava_vCapa.extensión (ej: A0_v1.flac o Piano_C4_v2.wav)
  const match = base.match(/([A-Ga-g][#sb]?-?\d+)_v(\d+)\.([a-zA-Z0-9]+)$/i);
  if (!match) return null;

  const noteStr = match[1];
  const layerNum = parseInt(match[2], 10);
  const ext = match[3].toLowerCase();
  const midi = noteToMidi(noteStr);

  if (midi === null) return null;

  return {
    filename: base,
    noteStr,
    midi,
    layer: layerNum,
    ext,
  };
}

/**
 * Genera el contenido de un archivo .sfz a partir de una lista de nombres de archivo.
 * Calcula automáticamente lokey, hikey, pitch_keycenter y los rangos de velocidad lovel/hivel.
 */
export function generateSFZ(filenames, { instrumentName = "Instrument", attack = 0.001, release = 0.12 } = {}) {
  const parsed = [];
  for (const f of filenames) {
    const item = parseSampleFilename(f);
    if (item) parsed.push(item);
  }

  if (parsed.length === 0) {
    throw new Error("No se encontraron archivos con nombres de notas válidos (ej: C4_v1.flac).");
  }

  // Agrupar por capa
  const layersMap = new Map();
  for (const item of parsed) {
    if (!layersMap.has(item.layer)) layersMap.set(item.layer, []);
    layersMap.get(item.layer).push(item);
  }

  const layerKeys = Array.from(layersMap.keys()).sort((a, b) => a - b);
  const numLayers = layerKeys.length;

  // Asignar rangos de velocidad por defecto según el número de capas
  const velRanges = new Map();
  if (numLayers === 1) {
    velRanges.set(layerKeys[0], [1, 127]);
  } else if (numLayers === 2) {
    velRanges.set(layerKeys[0], [1, 64]);
    velRanges.set(layerKeys[1], [65, 127]);
  } else if (numLayers === 3) {
    velRanges.set(layerKeys[0], [1, 42]);
    velRanges.set(layerKeys[1], [43, 85]);
    velRanges.set(layerKeys[2], [86, 127]);
  } else {
    const step = Math.floor(127 / numLayers);
    layerKeys.forEach((k, idx) => {
      const lo = idx === 0 ? 1 : idx * step + 1;
      const hi = idx === numLayers - 1 ? 127 : (idx + 1) * step;
      velRanges.set(k, [lo, hi]);
    });
  }

  let sfz = `// ==========================================\n`;
  sfz += `// SFZ Instrument: ${instrumentName}\n`;
  sfz += `// Generado automáticamente por Valenkar Stage\n`;
  sfz += `// ==========================================\n\n`;
  sfz += `<global>\n`;
  sfz += `ampeg_attack=${attack.toFixed(4)}\n`;
  sfz += `ampeg_release=${release.toFixed(4)}\n\n`;

  for (const layerKey of layerKeys) {
    const items = layersMap.get(layerKey);
    // Ordenar muestras por nota MIDI ascendente
    items.sort((a, b) => a.midi - b.midi);

    const [lovel, hivel] = velRanges.get(layerKey);
    sfz += `<group>\n`;
    sfz += `group_label=v${layerKey}\n`;
    sfz += `lovel=${lovel}\n`;
    sfz += `hivel=${hivel}\n\n`;

    for (let i = 0; i < items.length; i++) {
      const cur = items[i];
      let lokey, hikey;

      // Calcular límites inferior y superior con respecto a notas adyacentes
      if (i === 0) {
        lokey = 0;
      } else {
        lokey = Math.floor((items[i - 1].midi + cur.midi) / 2) + 1;
      }

      if (i === items.length - 1) {
        hikey = 127;
      } else {
        hikey = Math.floor((cur.midi + items[i + 1].midi) / 2);
      }

      sfz += `<region>\n`;
      sfz += `sample=${cur.filename}\n`;
      sfz += `pitch_keycenter=${cur.midi}\n`;
      sfz += `lokey=${lokey}\n`;
      sfz += `hikey=${hikey}\n\n`;
    }
  }

  return sfz;
}

/**
 * También genera un objeto manifest.json por compatibilidad.
 */
export function generateManifest(filenames) {
  const sfz = generateSFZ(filenames);
  const parsed = [];
  for (const f of filenames) {
    const item = parseSampleFilename(f);
    if (item) parsed.push(item);
  }
  const layersMap = new Map();
  for (const item of parsed) {
    if (!layersMap.has(item.layer)) layersMap.set(item.layer, []);
    layersMap.get(item.layer).push(item);
  }
  const layerKeys = Array.from(layersMap.keys()).sort((a, b) => a - b);
  const numLayers = layerKeys.length;

  const velRanges = {
    1: [[1, 127]],
    2: [[1, 64], [65, 127]],
    3: [[1, 42], [43, 85], [86, 127]],
  }[numLayers] || layerKeys.map((_, i) => [Math.floor((i * 127) / numLayers) + 1, Math.floor(((i + 1) * 127) / numLayers)]);

  const capas = {};
  layerKeys.forEach((k, idx) => {
    const layerName = `v${k}`;
    const items = layersMap.get(k).sort((a, b) => a.midi - b.midi);
    const muestras = {};
    for (const it of items) {
      muestras[it.midi.toString()] = it.filename;
    }
    capas[layerName] = {
      velocity: velRanges[idx],
      muestras,
    };
  });

  return {
    formato: "<Nota><Octava>_v<capa>.<ext>",
    capas,
  };
}
