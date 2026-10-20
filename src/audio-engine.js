import { getCachedSample, saveCachedSample } from "./sample-storage.js";
import { parseSFZ } from "./sfz-parser.js";

const MAX_SFZ_REGIONS = 4096;
const MAX_SEQUENCE_LENGTH = 128;

function noteToMidi(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 127) return numeric;

  const match = String(value ?? "").trim().match(/^([a-g])([#b]?)(-?\d+)$/i);
  if (!match) return null;
  const semitones = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + semitones[match[1].toLowerCase()] + accidental;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null;
}

function sampleRootFromFilename(filename) {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const match = basename.match(/(?:^|[_\s-])([a-g])([#b]?)(-?\d+)(?=$|[_\s.-])/i);
  return match ? noteToMidi(`${match[1]}${match[2]}${match[3]}`) : null;
}

function parseSfzRange(value, fallback, name, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Valor inválido de ${name} en el SFZ: "${value}".`);
  }
  return number;
}

function resolveSamplePath(sample, sfzUrl) {
  if (/^[a-z][a-z\d+.-]*:/i.test(sample)) return sample;
  const encodedPath = sample.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  return new URL(encodedPath, sfzUrl).href;
}

function expandSfzMacros(value, defines) {
  let expanded = value;
  for (let pass = 0; pass < 10; pass++) {
    const next = expanded.replace(/\$\w+/g, (name) => defines.get(name) ?? name);
    if (next === expanded) break;
    expanded = next;
  }
  return expanded.replace(/^(['"])(.*)\1$/, "$2");
}

function rebaseIncludedSamples(line, sfzUrl, defines) {
  return line.replace(
    /\bsample\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
    (assignment, rawValue) => {
      const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : "";
      const sample = expandSfzMacros(quote ? rawValue.slice(1, -1) : rawValue, defines);
      if (!sample || sample.startsWith("$") || /^[a-z][a-z\d+.-]*:/i.test(sample)) {
        return assignment;
      }
      const resolved = resolveSamplePath(sample, sfzUrl);
      return `sample=${quote}${resolved}${quote}`;
    }
  );
}

async function fetchSFZText(sfzUrl, ancestors = new Set(), defines = new Map()) {
  const url = new URL(sfzUrl, document.baseURI).href;
  if (ancestors.has(url)) {
    throw new Error(`Se detectó una referencia circular de #include en "${url}".`);
  }
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || contentType.includes("text/html")) {
    throw new Error(`No se pudo cargar el archivo SFZ: ${url}`);
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(url);
  const expandedLines = [];
  for (const line of (await response.text()).split(/\r?\n/)) {
    const define = line.match(/^\s*#define\s+(\$\w+)\s+(.+)$/i);
    if (define) defines.set(define[1], expandSfzMacros(define[2].trim(), defines));
    const include = line.match(/^\s*#include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*(?:\/\/.*)?$/i);
    if (include) {
      const includePath = (include[1] ?? include[2] ?? include[3]).replace(/\\/g, "/")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      expandedLines.push(await fetchSFZText(new URL(includePath, url).href, nextAncestors, defines));
    } else {
      expandedLines.push(rebaseIncludedSamples(line, url, defines));
    }
  }
  return expandedLines.join("\n");
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.master = null;
  }

  get ready() {
    return this.node !== null;
  }

async start() {
  if (this.ready) return;

  // 1) Descarga el módulo Wasm
  const res = await fetch(`${import.meta.env.BASE_URL}engine.wasm`);
  const wasmBytes = await res.arrayBuffer();
  const magic = new Uint8Array(wasmBytes, 0, 4);
  if (!res.ok || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
    throw new Error("No se pudo cargar engine.wasm. ¿Corriste npm run asbuild?");
  }

  // 2) Audio
  this.ctx = new AudioContext({ latencyHint: "interactive" });

  if (!this.ctx.audioWorklet) {
    throw new Error(
      "AudioWorklet no disponible. Necesita HTTPS o localhost y un navegador moderno."
    );
  }

  await this.ctx.audioWorklet.addModule(
    new URL("./worklet/processor.js", import.meta.url)
  );

  this.node = new AudioWorkletNode(this.ctx, "piano-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { wasmBytes },
  });

  this.node.port.onmessage = ({ data: msg }) => {
    if (msg.type === "metrics" && this.onMetrics) {
      this.onMetrics(msg);
    }
  };

  this.master = this.ctx.createGain();
  this.master.gain.value = 0.7;
  this.node.connect(this.master).connect(this.ctx.destination);

  await this.ctx.resume();
}

  noteOn(note, velocity) {
    this.node?.port.postMessage({ type: "noteOn", note, velocity });
  }

  noteOff(note) {
    this.node?.port.postMessage({ type: "noteOff", note });
  }

  sustain(down) {
    this.node?.port.postMessage({ type: "sustain", down });
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  // Latencia reportada por el navegador, en milisegundos
  getLatency() {
    if (!this.ctx) return null;
    const base = (this.ctx.baseLatency ?? 0) * 1000;
    const output = (this.ctx.outputLatency ?? 0) * 1000;
    return { base, output, total: base + output, sampleRate: this.ctx.sampleRate };
  }

  async loadSFZ(sfzUrl, { onProgress } = {}) {
    const sfzText = await fetchSFZText(sfzUrl);
    const parsed = parseSFZ(sfzText);

    const param = Number(new URLSearchParams(location.search).get("capas"));
    const mem = navigator.deviceMemory ?? 4;
    const count = param >= 1 && param <= 3 ? param : mem >= 6 ? 3 : 1;
    const allRegions = parsed.groups.flatMap((group) =>
      group.regions.map((region) => ({
        group,
        opcodes: {
          ...parsed.master,
          ...parsed.global,
          ...group.opcodes,
          ...region.opcodes,
        },
      }))
    );
    const regions = allRegions.filter(({ opcodes }) => opcodes.sample);
    if (regions.length === 0) throw new Error("El SFZ no contiene regiones con opcode sample=.");

    const velocityZones = new Map();
    for (const region of regions) {
      const low = parseSfzRange(region.opcodes.lovel, 1, "lovel", 1, 127);
      const high = parseSfzRange(region.opcodes.hivel, 127, "hivel", 1, 127);
      if (low > high) throw new Error(`Rango de velocidad inválido para "${region.opcodes.sample}".`);
      region.lowVelocity = low;
      region.highVelocity = high;
      const key = `${low}:${high}`;
      if (!velocityZones.has(key)) velocityZones.set(key, { low, high, regions: [] });
      velocityZones.get(key).regions.push(region);
    }

    const sortedZones = [...velocityZones.values()].sort(
      (a, b) => a.low - b.low || a.high - b.high
    );
    const nonEmptyGroups = parsed.groups.filter((group) => group.regions.length > 0);
    const usesLegacyLayerLabels =
      nonEmptyGroups.length > 1 &&
      nonEmptyGroups.every((group) => /^v[1-3]$/i.test(String(group.opcodes.group_label ?? "")));
    const zonesToLoad = usesLegacyLayerLabels ? sortedZones.slice(0, count) : sortedZones;
    const jobs = [];
    zonesToLoad.forEach((zone) => {
      for (const region of zone.regions) {
        const { opcodes } = region;
        const file = String(opcodes.sample);
        const midi =
          noteToMidi(opcodes.pitch_keycenter ?? opcodes.key) ?? sampleRootFromFilename(file);
        if (midi === null) {
          throw new Error(`Nota raíz inválida o ausente para el sample "${file}" en el SFZ.`);
        }
        const lowKey = noteToMidi(opcodes.lokey ?? opcodes.key) ?? midi;
        const highKey = noteToMidi(opcodes.hikey ?? opcodes.key) ?? midi;
        if (lowKey > highKey) throw new Error(`Rango de notas inválido para "${file}".`);
        const sequenceLength = parseSfzRange(
          opcodes.seq_length,
          0,
          "seq_length",
          0,
          MAX_SEQUENCE_LENGTH
        );
        const sequencePosition = parseSfzRange(
          opcodes.seq_position,
          1,
          "seq_position",
          1,
          MAX_SEQUENCE_LENGTH
        );
        if (sequenceLength === 0 && opcodes.seq_position !== undefined) {
          throw new Error(`La región "${file}" define seq_position sin seq_length.`);
        }
        if (sequenceLength > 0 && sequencePosition > sequenceLength) {
          throw new Error(`seq_position supera seq_length en la región "${file}".`);
        }
        jobs.push({
          region: jobs.length,
          midi,
          file,
          loopStart: opcodes.loop_start ?? 0,
          loopEnd: opcodes.loop_end,
          loopMode: opcodes.loop_mode ?? "no_loop",
          seqLength: sequenceLength,
          seqPosition: sequencePosition,
          lokey: lowKey,
          hikey: highKey,
          lovel: region.lowVelocity,
          hivel: region.highVelocity,
          layerName:
            opcodes.group_label && usesLegacyLayerLabels
              ? String(opcodes.group_label)
              : `Vel ${zone.low}-${zone.high}`,
        });
      }
    });

    if (jobs.length === 0) throw new Error("No hay samples compatibles para cargar desde el SFZ.");
    if (jobs.length > MAX_SFZ_REGIONS) {
      throw new Error(
        `El SFZ contiene ${jobs.length} regiones; el motor admite hasta ${MAX_SFZ_REGIONS}.`
      );
    }

    this.node.port.postMessage({ type: "reset" });

    let done = 0;
    let seconds = 0;
    const total = jobs.length;

    for (const zone of zonesToLoad) {
      const queue = jobs.filter(
        (job) => job.lovel === zone.low && job.hivel === zone.high
      );
      const layerName = queue[0]?.layerName ?? `Vel ${zone.low}-${zone.high}`;

      const loadOne = async (j) => {
        const sampleUrl = resolveSamplePath(j.file, sfzUrl);
        const cacheKey = sampleUrl;
        let buf = await getCachedSample(cacheKey);
        let fromCache = true;

        if (!buf) {
          fromCache = false;
          const r = await fetch(sampleUrl);
          const rType = r.headers.get("content-type") || "";
          if (!r.ok || rType.includes("text/html")) throw new Error("No se pudo descargar " + j.file);
          buf = await r.arrayBuffer();
          saveCachedSample(cacheKey, buf).catch(() => {});
        }

        const audioBuf = await this.ctx.decodeAudioData(buf.slice(0));
        const loopMode = ["loop_continuous", "loop_sustain"].includes(
          String(j.loopMode).toLowerCase()
        )
          ? 1
          : 0;
        const loopStart = parseSfzRange(j.loopStart, 0, "loop_start", 0, audioBuf.length);
        const loopEnd = parseSfzRange(j.loopEnd, audioBuf.length, "loop_end", 0, audioBuf.length);
        if (loopMode && loopEnd <= loopStart) {
          throw new Error(`Bucle inválido para "${j.file}": loop_end debe ser mayor que loop_start.`);
        }
        const mono = new Float32Array(audioBuf.length);
        const nch = audioBuf.numberOfChannels;
        for (let c = 0; c < nch; c++) {
          const d = audioBuf.getChannelData(c);
          for (let i = 0; i < mono.length; i++) mono[i] += d[i] / nch;
        }
        seconds += audioBuf.duration;
        this.node.port.postMessage(
          {
            type: "sfzSample",
            region: j.region,
            midi: j.midi,
            lokey: j.lokey,
            hikey: j.hikey,
            lovel: j.lovel,
            hivel: j.hivel,
            seqLength: j.seqLength,
            seqPosition: j.seqPosition,
            loopStart,
            loopEnd,
            loopMode,
            data: mono,
          },
          [mono.buffer]
        );
        onProgress?.(++done, total, j.layerName, fromCache);
      };

      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (queue.length) await loadOne(queue.shift());
        })
      );
    }

    return {
      count: total,
      seconds,
      layers: [...new Set(jobs.map((job) => job.layerName))],
    };
  }

  async loadBank(baseUrl, { onProgress } = {}) {
    if (baseUrl.endsWith(".sfz")) {
      return this.loadSFZ(baseUrl, { onProgress });
    }

    let url = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

    // Intentar buscar automáticamente un archivo .sfz en la carpeta
    try {
      const sfzCheck = await fetch(`${url}piano.sfz`);
      const sfzType = sfzCheck.headers.get("content-type") || "";
      if (sfzCheck.ok && !sfzType.includes("text/html")) {
        return this.loadSFZ(`${url}piano.sfz`, { onProgress });
      }
    } catch (_) {}

    let res = await fetch(`${url}manifest.json`);
    let contentType = res.headers.get("content-type") || "";

    // Si no se encuentra en la ruta directa, probar subcarpetas
    if ((!res.ok || contentType.includes("text/html")) && !url.includes("piano/")) {
      const fallbackUrl = `${url}piano/`;
      const fallbackRes = await fetch(`${fallbackUrl}manifest.json`);
      const fallbackContentType = fallbackRes.headers.get("content-type") || "";
      if (fallbackRes.ok && !fallbackContentType.includes("text/html")) {
        url = fallbackUrl;
        res = fallbackRes;
        contentType = fallbackContentType;
      }
    }

    if (!res.ok || contentType.includes("text/html")) {
      throw new Error("No se encontró instrumento (sfz ni manifest.json) en " + url);
    }
    const manifest = await res.json();
    if (!manifest.capas) throw new Error("El manifest no tiene 'capas'.");

  // Rango de velocity de cada capa, tomado de tu manifest
  for (const [name, c] of Object.entries(manifest.capas)) {
    this.node.port.postMessage({
      type: "layerMax",
      layer: Number(name.slice(1)) - 1,
      max: c.velocity[1],
    });
  }

  // Cuántas capas cargar: ?capas=1|2|3 en la URL, o según la RAM del equipo
  const param = Number(new URLSearchParams(location.search).get("capas"));
  const mem = navigator.deviceMemory ?? 4;
  const count = param >= 1 && param <= 3 ? param : mem >= 6 ? 3 : 1;
  const order = ["v2", "v1", "v3"].slice(0, count).filter((n) => manifest.capas[n]);

  const jobs = [];
  for (const name of order) {
    for (const [midi, file] of Object.entries(manifest.capas[name].muestras)) {
      jobs.push({
        name,
        layer: Number(name.slice(1)) - 1,
        midi: Number(midi),
        file: file,
      });
    }
  }

  let done = 0;
  let seconds = 0;
  const total = jobs.length;

  for (const name of order) {   // una capa a la vez: v2 primero, ya se puede tocar
    const queue = jobs.filter((j) => j.name === name);

    const loadOne = async (j) => {
      let buf = await getCachedSample(j.file);
      let fromCache = true;

      if (!buf) {
        fromCache = false;
        const r = await fetch(`${url}${j.file}`);
        const rType = r.headers.get("content-type") || "";
        if (!r.ok || rType.includes("text/html")) throw new Error("No se pudo descargar " + j.file);
        buf = await r.arrayBuffer();
        // Guardar en el almacenamiento del dispositivo en segundo plano
        saveCachedSample(j.file, buf).catch(() => {});
      }

      const audioBuf = await this.ctx.decodeAudioData(buf.slice(0));

      const mono = new Float32Array(audioBuf.length);
      const nch = audioBuf.numberOfChannels;
      for (let c = 0; c < nch; c++) {
        const d = audioBuf.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += d[i] / nch;
      }
      seconds += audioBuf.duration;
      this.node.port.postMessage(
        { type: "sample", layer: j.layer, midi: j.midi, data: mono },
        [mono.buffer]
      );
      onProgress?.(++done, total, name, fromCache);
    };

    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) await loadOne(queue.shift());
      })
    );
    this.node.port.postMessage({ type: "buildMap", layer: Number(name.slice(1)) - 1 });
  }

  return { count: total, seconds, layers: order };
}
}