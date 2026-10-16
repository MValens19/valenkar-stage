// Motor de audio en WebAssembly. Sin asignaciones de memoria durante process().
const MAX_VOICES: i32 = 32;
const MAX_FRAMES: i32 = 1024;
const TWO_PI: f64 = 2.0 * Math.PI;

// Estado de las voces (arreglos estáticos, reservados una sola vez)
const vStage = new StaticArray<i32>(MAX_VOICES);   // 0 libre, 1 ataque, 2 caída, 3 release
const vNote = new StaticArray<i32>(MAX_VOICES);
const vKeyDown = new StaticArray<bool>(MAX_VOICES);
const vAge = new StaticArray<i32>(MAX_VOICES);
const vPhase = new StaticArray<f64>(MAX_VOICES);
const vInc = new StaticArray<f64>(MAX_VOICES);
const vEnv = new StaticArray<f32>(MAX_VOICES);
const vAmp = new StaticArray<f32>(MAX_VOICES);

// Buffer de salida que JS lee directamente de la memoria de Wasm
const outBuf = new StaticArray<f32>(MAX_FRAMES);

let sampleRate: f64 = 48000.0;
let attackStep: f32 = 0.01;
let decayCoef: f32 = 0.9999;
let releaseCoef: f32 = 0.999;
let sustainDown: bool = false;
let counter: i32 = 0;

export function init(sr: f64): void {
  sampleRate = sr;
  attackStep = <f32>(1.0 / (0.005 * sr));            // ataque de 5 ms
  decayCoef = <f32>Math.exp(-1.0 / (2.0 * sr));      // caída ~2 s
  releaseCoef = <f32>Math.exp(-1.0 / (0.12 * sr));   // apagado ~120 ms
  sustainDown = false;
  for (let i = 0; i < MAX_VOICES; i++) vStage[i] = 0;
}

export function getOutPtr(): usize {
  return changetype<usize>(outBuf);
}

export function noteOn(note: i32, velocity: i32): void {
  // Busca una voz libre
  let idx: i32 = -1;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] == 0) { idx = i; break; }
  }
  // Voice stealing: si no hay libres, roba la más antigua
  if (idx < 0) {
    let oldest: i32 = i32.MAX_VALUE;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vAge[i] < oldest) { oldest = vAge[i]; idx = i; }
    }
  }

  const v: f32 = <f32>velocity / 127.0;
  vNote[idx] = note;
  vKeyDown[idx] = true;
  vAge[idx] = counter++;
  vPhase[idx] = 0.0;
  vInc[idx] = (TWO_PI * 440.0 * Math.pow(2.0, <f64>(note - 69) / 12.0)) / sampleRate;
  vEnv[idx] = 0.0;
  vAmp[idx] = 0.25 * v * v;   // velocity -> volumen (curva cuadrática)
  vStage[idx] = 1;
}

export function noteOff(note: i32): void {
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] != 0 && vNote[i] == note && vKeyDown[i]) {
      vKeyDown[i] = false;
      if (!sustainDown) vStage[i] = 3;
    }
  }
}

export function setSustain(down: i32): void {
  sustainDown = down != 0;
  if (!sustainDown) {
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vStage[i] != 0 && !vKeyDown[i]) vStage[i] = 3;
    }
  }
}

export function process(frames: i32): void {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  for (let i = 0; i < frames; i++) outBuf[i] = 0.0;

  for (let v = 0; v < MAX_VOICES; v++) {
    let stage = vStage[v];
    if (stage == 0) continue;

    let phase = vPhase[v];
    const inc = vInc[v];
    let env = vEnv[v];
    const amp = vAmp[v];

    for (let i = 0; i < frames; i++) {
      if (stage == 1) {
        env += attackStep;
        if (env >= 1.0) { env = 1.0; stage = 2; }
      } else if (stage == 2) {
        env *= decayCoef;
      } else {
        env *= releaseCoef;
      }

      const s = <f32>(Math.sin(phase) + 0.3 * Math.sin(2.0 * phase));
      outBuf[i] += s * env * amp;

      phase += inc;
      if (phase > TWO_PI) phase -= TWO_PI;
    }

    if (stage == 3 && env < 0.0005) stage = 0;   // voz terminada
    vStage[v] = stage;
    vPhase[v] = phase;
    vEnv[v] = env;
  }
}