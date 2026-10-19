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
      break;
    }
    case "buildMap": this.wasm.buildMap(msg.layer); break;
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