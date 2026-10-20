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
  const midi = (octave + 1) * 12 + NOTE_MAP[name];
  return midi >= 0 && midi <= 127 ? midi : null;
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

function parseSfzKey(value, fallback, label) {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    if (numeric < 0 || numeric > 127) throw new Error(`Opcode ${label} fuera del rango MIDI: ${value}.`);
    return numeric;
  }

  const match = String(value).match(/^([A-Ga-g][#sb]?)(-?\d+)$/);
  if (!match) throw new Error(`Opcode ${label} no es una nota SFZ válida: ${value}.`);
  const note = NOTE_MAP[match[1].toLowerCase()];
  if (note === undefined) throw new Error(`Opcode ${label} no es una nota SFZ válida: ${value}.`);
  const midi = (Number(match[2]) + 1) * 12 + note;
  return Math.max(0, Math.min(127, midi));
}

function parseSfzNumber(value, fallback, label, min = 0, max = 127) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Opcode ${label} fuera de rango o inválido: ${value}.`);
  }
  return number;
}

function parseSfzOpcodes(text) {
  return Object.fromEntries(
    [...text.matchAll(/([a-zA-Z][a-zA-Z0-9_]*)=([^\s]+)/g)].map((match) => [
      match[1].toLowerCase(),
      match[2],
    ])
  );
}

export function parseSFZSampleMappings(sfzText, filenames) {
  const defines = new Map(
    [...sfzText.matchAll(/^#define\s+(\$\w+)\s+([^\s]+)/gm)].map((match) => [match[1], match[2]])
  );
  const resolveValue = (value) =>
    value.replace(/\$\w+/g, (name) => defines.get(name) ?? name);
  const samplesByName = new Map(
    filenames.map((filename) => [filename.split(/[/\\]/).pop().toLowerCase(), parseSampleFilename(filename)])
  );
  const mappings = new Map();
  const layerRanges = new Map();
  let group = null;

  for (const rawLine of sfzText.split(/\r?\n/)) {
    const groupMatch = rawLine.match(/<group>(?:\s*\/\/\s*(.*))?/i);
    const line = rawLine.replace(/\/\/.*$/, "");
    if (groupMatch) {
      const label = groupMatch[1]?.trim() ?? "";
      group = {
        label,
        opcodes: parseSfzOpcodes(resolveValue(line.slice(groupMatch.index + "<group>".length))),
      };
      continue;
    }

    const regionIndex = line.toLowerCase().indexOf("<region>");
    if (regionIndex < 0) {
      if (group && !line.includes("<")) {
        Object.assign(group.opcodes, parseSfzOpcodes(resolveValue(line)));
      }
      continue;
    }
    if (!group) continue;

    const opcodes = {
      ...group.opcodes,
      ...parseSfzOpcodes(resolveValue(line.slice(regionIndex + "<region>".length))),
    };
    const samplePath = opcodes.sample;
    if (!samplePath) continue;
    const sampleName = samplePath.split(/[/\\]/).pop().toLowerCase();
    const sample = samplesByName.get(sampleName);
    if (!sample) {
      throw new Error(`El SFZ referencia el sample "${samplePath}", pero no está en la carpeta de audio.`);
    }
    const labeledLayer = group.opcodes.group_label?.match(/^v([1-3])$/i);
    const dynamicLabel = group.label.match(/(?:^|\s)(p|mf|f)$/i)?.[1]?.toLowerCase();
    const sourceLayer = labeledLayer
      ? Number(labeledLayer[1])
      : dynamicLabel === "mf"
        ? 2
        : dynamicLabel === "f"
          ? 3
          : dynamicLabel === "p"
            ? 1
            : null;
    if (sourceLayer !== null && sourceLayer !== sample.layer) {
      throw new Error(
        `El sample "${sample.filename}" pertenece a v${sample.layer}, pero está dentro del grupo ${group.label || group.opcodes.group_label}.`
      );
    }

    const layerRange = [
      parseSfzNumber(group.opcodes.lovel, 1, "lovel", 1),
      parseSfzNumber(group.opcodes.hivel, 127, "hivel", 1),
    ];
    if (layerRange[0] > layerRange[1]) {
      throw new Error(`Rango de velocity inválido para la capa v${sample.layer} en el SFZ.`);
    }
    const previousRange = layerRanges.get(sample.layer);
    if (previousRange && (previousRange[0] !== layerRange[0] || previousRange[1] !== layerRange[1])) {
      throw new Error(`El SFZ declara rangos de velocity incompatibles para la capa v${sample.layer}.`);
    }
    layerRanges.set(sample.layer, layerRange);

    const root = parseSfzKey(opcodes.pitch_keycenter ?? opcodes.key, sample.midi, "key/pitch_keycenter");
    if (root !== sample.midi) {
      throw new Error(
        `La nota del archivo "${sample.filename}" no coincide con key/pitch_keycenter=${opcodes.pitch_keycenter ?? opcodes.key} del SFZ.`
      );
    }

    const mapping = {
      root,
      lokey: parseSfzKey(opcodes.lokey, root, "lokey"),
      hikey: parseSfzKey(opcodes.hikey, root, "hikey"),
      lovel: parseSfzNumber(opcodes.lovel, layerRange[0], "lovel", 1),
      hivel: parseSfzNumber(opcodes.hivel, layerRange[1], "hivel", 1),
    };
    if (mapping.lokey > mapping.hikey || mapping.lovel > mapping.hivel) {
      throw new Error(`Rango de nota o velocity inválido para "${sample.filename}" en el SFZ.`);
    }
    if (mappings.has(sample.normalizedFilename)) {
      throw new Error(`El SFZ contiene más de una región para "${sample.filename}".`);
    }
    mappings.set(sample.normalizedFilename, mapping);
  }

  for (const sample of samplesByName.values()) {
    if (sample && !mappings.has(sample.normalizedFilename)) {
      throw new Error(`El SFZ no contiene una región para "${sample.filename}".`);
    }
  }

  return { mappings, layerRanges };
}

/**
 * Analiza un nombre de archivo para extraer nota, octava, midi y capa.
 * Soporta patrones como:
 * - A0_v1.flac, Cs2_v3.wav, Piano_C4_v2.mp3
 * - Pianobook: p_c4.wav, p_d#1.wav, p_lc_a3.wav, mf_c4.flac, f_lc_f#6.wav
 * - Dinámicas: pianissimo/pp/p, mezzo-forte/mf, forte/ff/f
 */
export function parseSampleFilename(filename) {
  const baseWithExt = filename.split(/[/\\]/).pop();
  const extMatch = baseWithExt.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";
  if (!["flac", "mp3", "wav", "ogg"].includes(ext)) return null;
  const base = baseWithExt.replace(/\.[a-zA-Z0-9]+$/, "");

  // 1. Extraer la nota musical y octava (ej: c4, d#1, f#7, Bb2, A0, Fs3)
  // Busca la nota delimitada por guion bajo, espacio, o al final
  const noteMatch = base.match(/(?:^|[_ -])([a-gA-G][#sb]?)(-?\d+)(?:[_ -]|$)/);
  if (!noteMatch) return null;

  const noteStr = noteMatch[1] + noteMatch[2];
  const midi = noteToMidi(noteStr);
  if (midi === null) return null;

  // 2. Extraer o deducir la capa de dinámica (Layer)
  const lower = base.toLowerCase();
  const vMatch = lower.match(/(?:^|[_ -])v(\d+)(?:[_ -]|$)/);
  let layerNum;
  if (vMatch) {
    layerNum = parseInt(vMatch[1], 10);
  } else {
    const prefix = lower.slice(0, noteMatch.index).replace(/[- ]+/g, "_");
    if (/(?:^|_)(?:p|pp|ppp|pianissimo|piano|soft|very_soft)(?:_|$)/.test(prefix)) {
      layerNum = 1;
    } else if (/(?:^|_)(?:mp|mf|mezzo_piano|mezzopiano|mezzo_forte|mezzoforte|medium|med)(?:_|$)/.test(prefix)) {
      layerNum = 2;
    } else if (/(?:^|_)(?:f|ff|fff|forte|fortissimo|loud|hard)(?:_|$)/.test(prefix)) {
      layerNum = 3;
    } else {
      if (prefix) return null;
      layerNum = 1;
    }
  }
  if (layerNum < 1 || layerNum > 3) return null;

  return {
    filename: baseWithExt,
    noteStr,
    midi,
    layer: layerNum,
    ext,
    normalizedFilename: `${midiToNote(midi)}_v${layerNum}.${ext}`,
  };
}

/**
 * Genera el contenido de un archivo .sfz a partir de una lista de nombres de archivo.
 * Calcula automáticamente lokey, hikey, pitch_keycenter y los rangos de velocidad lovel/hivel.
 */
export function generateSFZ(
  filenames,
  { instrumentName = "Instrument", attack = 0.001, release = 0.12, sourceSFZText } = {}
) {
  const parsed = [];
  for (const f of filenames) {
    const item = parseSampleFilename(f);
    if (!item) throw new Error(`No se pudo interpretar el nombre del sample "${f}".`);
    parsed.push(item);
  }

  if (parsed.length === 0) {
    throw new Error("No se encontraron archivos con nombres de notas válidos (ej: C4_v1.flac).");
  }

  const source = sourceSFZText ? parseSFZSampleMappings(sourceSFZText, filenames) : null;

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

    const [lovel, hivel] = source?.layerRanges.get(layerKey) ?? velRanges.get(layerKey);
    sfz += `<group>\n`;
    sfz += `group_label=v${layerKey}\n`;
    sfz += `lovel=${lovel}\n`;
    sfz += `hivel=${hivel}\n\n`;

    for (let i = 0; i < items.length; i++) {
      const cur = items[i];
      let lokey, hikey;

      if (source) {
        const mapping = source.mappings.get(cur.normalizedFilename);
        ({ lokey, hikey } = mapping);
      } else {
        // Calcular límites inferior y superior con respecto a notas adyacentes
        lokey = i === 0 ? 0 : Math.floor((items[i - 1].midi + cur.midi) / 2) + 1;
        hikey =
          i === items.length - 1
            ? 127
            : Math.floor((cur.midi + items[i + 1].midi) / 2);
      }

      sfz += `<region>\n`;
      sfz += `sample=${cur.normalizedFilename}\n`;
      sfz += `pitch_keycenter=${source?.mappings.get(cur.normalizedFilename).root ?? cur.midi}\n`;
      sfz += `lokey=${lokey}\n`;
      sfz += `hikey=${hikey}\n`;
      if (source) {
        const mapping = source.mappings.get(cur.normalizedFilename);
        sfz += `lovel=${mapping.lovel}\n`;
        sfz += `hivel=${mapping.hivel}\n`;
      }
      sfz += "\n";
    }
  }

  return sfz;
}

/**
 * También genera un objeto manifest.json por compatibilidad.
 */
export function generateManifest(filenames, { sourceSFZText } = {}) {
  const source = sourceSFZText ? parseSFZSampleMappings(sourceSFZText, filenames) : null;
  generateSFZ(filenames, { sourceSFZText });
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

  const defaultRanges = {
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
      muestras[it.midi.toString()] = it.normalizedFilename;
    }
    capas[layerName] = {
      velocity: source?.layerRanges.get(k) ?? defaultRanges[idx],
      muestras,
    };
  });

  return {
    formato: "<Nota><Octava>_v<capa>.<ext>",
    capas,
  };
}
