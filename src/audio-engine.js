import { getCachedSample, saveCachedSample } from "./sample-storage.js";
import { parseSFZ } from "./sfz-parser.js";

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
    const res = await fetch(sfzUrl);
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || contentType.includes("text/html")) {
      throw new Error("No se pudo cargar el archivo SFZ: " + sfzUrl);
    }
    const sfzText = await res.text();
    const parsed = parseSFZ(sfzText);
    const baseUrl = sfzUrl.substring(0, sfzUrl.lastIndexOf("/") + 1);

    parsed.groups.forEach((g, idx) => {
      const maxVel = g.opcodes.hivel ?? 127;
      this.node.port.postMessage({
        type: "layerMax",
        layer: idx,
        max: maxVel,
      });
    });

    const param = Number(new URLSearchParams(location.search).get("capas"));
    const mem = navigator.deviceMemory ?? 4;
    const count = param >= 1 && param <= 3 ? param : mem >= 6 ? 3 : 1;
    const groupsToLoad = parsed.groups.slice(0, count);

    const jobs = [];
    groupsToLoad.forEach((g, gIdx) => {
      for (const r of g.regions) {
        const file = r.opcodes.sample;
        const midi = r.opcodes.pitch_keycenter ?? r.opcodes.key;
        if (file && midi !== undefined) {
          jobs.push({
            layer: gIdx,
            midi,
            file,
            layerName: g.opcodes.group_label || `v${gIdx + 1}`,
          });
        }
      }
    });

    let done = 0;
    let seconds = 0;
    const total = jobs.length;

    for (let gIdx = 0; gIdx < groupsToLoad.length; gIdx++) {
      const queue = jobs.filter((j) => j.layer === gIdx);
      const layerName = groupsToLoad[gIdx].opcodes.group_label || `v${gIdx + 1}`;

      const loadOne = async (j) => {
        let buf = await getCachedSample(j.file);
        let fromCache = true;

        if (!buf) {
          fromCache = false;
          const r = await fetch(`${baseUrl}${j.file}`);
          const rType = r.headers.get("content-type") || "";
          if (!r.ok || rType.includes("text/html")) throw new Error("No se pudo descargar " + j.file);
          buf = await r.arrayBuffer();
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
        onProgress?.(++done, total, layerName, fromCache);
      };

      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (queue.length) await loadOne(queue.shift());
        })
      );
      this.node.port.postMessage({ type: "buildMap", layer: gIdx });
    }

    return {
      count: total,
      seconds,
      layers: groupsToLoad.map((g, i) => g.opcodes.group_label || `v${i + 1}`),
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