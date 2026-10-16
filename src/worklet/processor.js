// Corre en el AudioWorkletGlobalScope: sin DOM, sin acceso a la pantalla.
const MAX_VOICES = 32;

class PianoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.sustain = false;
    this.attackStep = 1 / (0.005 * sampleRate);          // 5 ms de ataque
    this.decayCoef = Math.exp(-1 / (2.0 * sampleRate));  // caída lenta (~2 s)
    this.releaseCoef = Math.exp(-1 / (0.12 * sampleRate)); // apagado suave (~120 ms)
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    switch (msg.type) {
      case "noteOn":
        this.noteOn(msg.note, msg.velocity);
        break;
      case "noteOff":
        this.noteOff(msg.note);
        break;
      case "sustain":
        this.setSustain(msg.down);
        break;
    }
  }

  noteOn(note, velocity) {
    // Voice stealing: si hay demasiadas voces, apaga la más antigua
    if (this.voices.length >= MAX_VOICES) this.voices.shift();
    const v = velocity / 127;
    this.voices.push({
      note,
      freq: 440 * Math.pow(2, (note - 69) / 12),
      phase: 0,
      amp: 0.25 * v * v,        // velocity -> volumen (curva cuadrática)
      env: 0,
      stage: "attack",
      keyDown: true,
    });
  }

  noteOff(note) {
    for (const voice of this.voices) {
      if (voice.note === note && voice.keyDown) {
        voice.keyDown = false;
        if (!this.sustain) voice.stage = "release";
      }
    }
  }

  setSustain(down) {
    this.sustain = down;
    if (!down) {
      for (const voice of this.voices) {
        if (!voice.keyDown) voice.stage = "release";
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const twoPi = 2 * Math.PI;

    for (let i = 0; i < left.length; i++) {
      let sample = 0;
      for (const voice of this.voices) {
        if (voice.stage === "attack") {
          voice.env += this.attackStep;
          if (voice.env >= 1) { voice.env = 1; voice.stage = "decay"; }
        } else if (voice.stage === "decay") {
          voice.env *= this.decayCoef;
        } else {
          voice.env *= this.releaseCoef;
        }

        // Seno + armónico para que suene menos "de tono puro"
        const s = Math.sin(voice.phase) + 0.3 * Math.sin(2 * voice.phase);
        sample += s * voice.env * voice.amp;

        voice.phase += (twoPi * voice.freq) / sampleRate;
        if (voice.phase > twoPi) voice.phase -= twoPi;
      }
      left[i] = sample;
    }

    // Copia a los demás canales (estéreo)
    for (let c = 1; c < out.length; c++) out[c].set(left);

    // Elimina voces apagadas
    this.voices = this.voices.filter((v) => !(v.stage === "release" && v.env < 0.0005));

    return true;
  }
}

registerProcessor("piano-processor", PianoProcessor);