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
}