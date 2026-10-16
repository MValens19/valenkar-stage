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
  if (msg.type === "noteOn") this.wasm.noteOn(msg.note, msg.velocity);
  else if (msg.type === "noteOff") this.wasm.noteOff(msg.note);
  else if (msg.type === "sustain") this.wasm.setSustain(msg.down ? 1 : 0);
  else if (msg.type === "sample") {
    const n = Math.min(msg.data.length, this.wasm.getMaxSample());
    const ptr = this.wasm.getSamplePtr();
    new Float32Array(this.wasm.memory.buffer, ptr, n).set(msg.data.subarray(0, n));
    this.wasm.setSampleLength(n);
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

    return true;
  }
}

registerProcessor("piano-processor", PianoProcessor);