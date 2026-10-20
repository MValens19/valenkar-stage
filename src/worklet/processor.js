class PianoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const bytes = options.processorOptions.wasmBytes;
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, {
      env: { abort: () => {}, seed: () => 0 },
    });

    this.wasm = instance.exports;
    this.wasm.init(sampleRate);
    this.outPtr = this.wasm.getOutPtr();
    this.view = null;

this.port.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case "noteOn": this.wasm.noteOn(msg.note, msg.velocity); break;
    case "noteOff": this.wasm.noteOff(msg.note); break;
    case "sustain": this.wasm.setSustain(msg.down ? 1 : 0); break;
    case "layerMax": this.wasm.setLayerMax(msg.layer, msg.max); break;
    case "sample": {
      const ptr = this.wasm.allocSample(msg.layer, msg.midi, msg.data.length);
      new Float32Array(this.wasm.memory.buffer, ptr, msg.data.length).set(msg.data);
      this.wasm.setSampleZone(
        msg.layer,
        msg.midi,
        msg.lokey,
        msg.hikey,
        msg.lovel,
        msg.hivel,
        msg.loopStart,
        msg.loopEnd,
        msg.loopMode
      );
      break;
    }
    case "sfzSample": {
      const ptr = this.wasm.allocSfzSample(msg.region, msg.data.length);
      new Float32Array(this.wasm.memory.buffer, ptr, msg.data.length).set(msg.data);
      this.wasm.setSfzRegion(
        msg.region,
        msg.midi,
        msg.lokey,
        msg.hikey,
        msg.lovel,
        msg.hivel,
        msg.seqLength,
        msg.seqPosition,
        msg.loopStart,
        msg.loopEnd,
        msg.loopMode
      );
      break;
    }
    case "buildMap": this.wasm.buildMap(msg.layer, msg.strictMap ? 1 : 0); break;
    case "reset": this.wasm.init(sampleRate); break;
  }
};
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const n = left.length;

    this.wasm.process(n);

    // Vista sobre la memoria de Wasm (se recrea si la memoria cambió)
    const mem = this.wasm.memory.buffer;
    if (!this.view || this.view.buffer !== mem) {
      this.view = new Float32Array(mem, this.outPtr, 1024);
    }
    left.set(this.view.subarray(0, n));
    for (let c = 1; c < out.length; c++) out[c].set(left);

    // Reportar métricas cada ~15 bloques (aprox cada 40ms)
    this.metricCounter = (this.metricCounter || 0) + 1;
    if (this.metricCounter >= 15) {
      this.metricCounter = 0;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const val = Math.abs(left[i]);
        if (val > peak) peak = val;
      }
      const voices = this.wasm.getActiveVoices ? this.wasm.getActiveVoices() : 0;
      this.port.postMessage({ type: "metrics", voices, peak });
    }

    return true;
  }
}

registerProcessor("piano-processor", PianoProcessor);