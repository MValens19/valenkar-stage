const MAX_VOICES: i32 = 32;
const MAX_FRAMES: i32 = 1024;
const LAYERS: i32 = 3;

// Banco: índice = capa * 128 + nota MIDI
const smpPtr = new StaticArray<usize>(LAYERS * 128);
const smpLen = new StaticArray<i32>(LAYERS * 128);
const mapRoot = new StaticArray<i32>(LAYERS * 128);   // tecla -> raíz más cercana (-1 si no hay)
const layerMax = new StaticArray<i32>(LAYERS);        // velocity máximo de cada capa

// Voces
const vStage = new StaticArray<i32>(MAX_VOICES);      // 0 libre, 1 ataque, 2 sostenida, 3 release
const vNote = new StaticArray<i32>(MAX_VOICES);
const vKeyDown = new StaticArray<bool>(MAX_VOICES);
const vAge = new StaticArray<i32>(MAX_VOICES);
const vPtr = new StaticArray<usize>(MAX_VOICES);
const vLen = new StaticArray<i32>(MAX_VOICES);
const vPos = new StaticArray<f64>(MAX_VOICES);
const vRate = new StaticArray<f64>(MAX_VOICES);
const vEnv = new StaticArray<f32>(MAX_VOICES);
const vAmp = new StaticArray<f32>(MAX_VOICES);

const outBuf = new StaticArray<f32>(MAX_FRAMES);

let attackStep: f32 = 0.02;
let releaseCoef: f32 = 0.999;
let sustainDown: bool = false;
let counter: i32 = 0;

export function init(sr: f64): void {
  attackStep = <f32>(1.0 / (0.001 * sr));
  releaseCoef = <f32>Math.exp(-1.0 / (0.12 * sr));
  sustainDown = false;
  for (let i = 0; i < MAX_VOICES; i++) vStage[i] = 0;
  for (let i = 0; i < LAYERS * 128; i++) { smpLen[i] = 0; mapRoot[i] = -1; }
  layerMax[0] = 42; layerMax[1] = 85; layerMax[2] = 127;
}

export function getOutPtr(): usize { return changetype<usize>(outBuf); }

export function setLayerMax(layer: i32, max: i32): void {
  if (layer >= 0 && layer < LAYERS) layerMax[layer] = max;
}

export function allocSample(layer: i32, midi: i32, len: i32): usize {
  const idx = layer * 128 + midi;
  const ptr = heap.alloc(<usize>len << 2);
  smpPtr[idx] = ptr;
  smpLen[idx] = len;
  return ptr;
}

// Para cada tecla de una capa, elige la raíz cargada más cercana
export function buildMap(layer: i32): void {
  const o = layer * 128;
  for (let n = 0; n < 128; n++) {
    let best: i32 = -1;
    for (let d = 0; d < 128; d++) {
      if (n - d >= 0 && smpLen[o + n - d] > 0) { best = n - d; break; }
      if (n + d <= 127 && smpLen[o + n + d] > 0) { best = n + d; break; }
    }
    mapRoot[o + n] = best;
  }
}

function pickLayer(velocity: i32): i32 {
  let l: i32 = 0;
  while (l < LAYERS - 1 && velocity > layerMax[l]) l++;
  return l;
}

export function noteOn(note: i32, velocity: i32): void {
  // Capa que corresponde al velocity; si aún no está cargada, usa la más cercana
  const want = pickLayer(velocity);
  let layer: i32 = -1;
  for (let d = 0; d < LAYERS && layer < 0; d++) {
    if (want + d < LAYERS && mapRoot[(want + d) * 128 + note] >= 0) layer = want + d;
    else if (want - d >= 0 && mapRoot[(want - d) * 128 + note] >= 0) layer = want - d;
  }
  if (layer < 0) return;

  const root = mapRoot[layer * 128 + note];
  const si = layer * 128 + root;

  let idx: i32 = -1;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] == 0) { idx = i; break; }
  }
  if (idx < 0) {   // voice stealing: la más antigua
    let oldest: i32 = i32.MAX_VALUE;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vAge[i] < oldest) { oldest = vAge[i]; idx = i; }
    }
  }

  const v: f32 = <f32>velocity / 127.0;
  vNote[idx] = note;
  vKeyDown[idx] = true;
  vAge[idx] = counter++;
  vPtr[idx] = smpPtr[si];
  vLen[idx] = smpLen[si];
  vPos[idx] = 0.0;
  vRate[idx] = Math.pow(2.0, <f64>(note - root) / 12.0);
  vEnv[idx] = 0.0;
  vAmp[idx] = 0.6 * (0.35 + 0.65 * v);   // curva suave: las capas ya traen la dinámica
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
    const base = vPtr[v];
    const len = vLen[v];
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
      if (i0 + 1 >= len) { stage = 0; break; }

      const frac = <f32>(pos - <f64>i0);
      const s0 = load<f32>(base + (<usize>i0 << 2));
      const s1 = load<f32>(base + (<usize>(i0 + 1) << 2));
      outBuf[i] += (s0 + (s1 - s0) * frac) * env * amp;

      pos += rate;
    }

    if (stage == 3 && env < 0.0005) stage = 0;
    vStage[v] = stage;
    vPos[v] = pos;
    vEnv[v] = env;
  }
}