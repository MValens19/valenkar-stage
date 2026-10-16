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
  async loadSample(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo descargar " + url);
  const arr = await res.arrayBuffer();

  // El navegador decodifica el MP3 y lo ajusta a la frecuencia del AudioContext
  const audioBuf = await this.ctx.decodeAudioData(arr);

  // Mezcla a mono
  const mono = new Float32Array(audioBuf.length);
  for (let c = 0; c < audioBuf.numberOfChannels; c++) {
    const data = audioBuf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / audioBuf.numberOfChannels;
  }

  // Se transfiere (no se copia) al worklet
  this.node.port.postMessage({ type: "sample", data: mono }, [mono.buffer]);
  return { seconds: audioBuf.duration, sampleRate: audioBuf.sampleRate };
}
}