// Motor Wasm 3B: reproduce un sample (sin cambio de tono todavía).
const MAX_VOICES: i32 = 32;
const MAX_FRAMES: i32 = 1024;
const MAX_SAMPLE: i32 = 48000 * 12; // hasta 12 s a 48 kHz (~2.3 MB)

const vStage = new StaticArray<i32>(MAX_VOICES);   // 0 libre, 1 ataque, 2 sostenida, 3 release
const vNote = new StaticArray<i32>(MAX_VOICES);
const vKeyDown = new StaticArray<bool>(MAX_VOICES);
const vAge = new StaticArray<i32>(MAX_VOICES);
const vPos = new StaticArray<f64>(MAX_VOICES);     // posición fraccionaria en el sample
const vRate = new StaticArray<f64>(MAX_VOICES);    // velocidad de lectura (1.0 = C4 original)    // posición de lectura en el sample
const vEnv = new StaticArray<f32>(MAX_VOICES);
const vAmp = new StaticArray<f32>(MAX_VOICES);

const outBuf = new StaticArray<f32>(MAX_FRAMES);
const sampleBuf = new StaticArray<f32>(MAX_SAMPLE);

let sampleLen: i32 = 0;
let attackStep: f32 = 0.02;
let releaseCoef: f32 = 0.999;
let sustainDown: bool = false;
let counter: i32 = 0;

export function init(sr: f64): void {
  attackStep = <f32>(1.0 / (0.001 * sr));           // ataque de 1 ms (anti-clic)
  releaseCoef = <f32>Math.exp(-1.0 / (0.12 * sr));  // apagado ~120 ms
  sustainDown = false;
  for (let i = 0; i < MAX_VOICES; i++) vStage[i] = 0;
}

export function getOutPtr(): usize { return changetype<usize>(outBuf); }
export function getSamplePtr(): usize { return changetype<usize>(sampleBuf); }
export function getMaxSample(): i32 { return MAX_SAMPLE; }
export function setSampleLength(n: i32): void { sampleLen = n; }

export function noteOn(note: i32, velocity: i32): void {
  let idx: i32 = -1;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] == 0) { idx = i; break; }
  }
  if (idx < 0) { // voice stealing: la más antigua
    let oldest: i32 = i32.MAX_VALUE;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vAge[i] < oldest) { oldest = vAge[i]; idx = i; }
    }
  }
  const v: f32 = <f32>velocity / 127.0;
  vNote[idx] = note;
  vKeyDown[idx] = true;
  vAge[idx] = counter++;
  vPos[idx] = 0.0;
  vRate[idx] = Math.pow(2.0, <f64>(note - 60) / 12.0);  // 60 = C4, la nota grabada
  vEnv[idx] = 0.0;
  vAmp[idx] = 0.5 * v * v;
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

    let pos = vPos[v];
    const rate = vRate[v];
    let env = vEnv[v];
    const amp = vAmp[v];

    for (let i = 0; i < frames; i++) {
      if (stage == 1) {
        env += attackStep;
        if (env >= 1.0) { env = 1.0; stage = 2; }
      } else if (stage == 3) {
        env *= releaseCoef;
      }

      const i0 = <i32>pos;
      if (i0 + 1 >= sampleLen) { stage = 0; break; }   // el sample terminó

      // Interpolación lineal entre dos muestras vecinas
      const frac = <f32>(pos - <f64>i0);
      const s0 = unchecked(sampleBuf[i0]);
      const s1 = unchecked(sampleBuf[i0 + 1]);
      outBuf[i] += (s0 + (s1 - s0) * frac) * env * amp;

      pos += rate;
    }

    if (stage == 3 && env < 0.0005) stage = 0;
    vStage[v] = stage;
    vPos[v] = pos;
    vEnv[v] = env;
  }
}