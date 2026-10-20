const MAX_VOICES: i32 = 32;
const MAX_FRAMES: i32 = 1024;
const LAYERS: i32 = 16;
const MAX_SFZ_REGIONS: i32 = 4096;
const MAX_SEQUENCE_LENGTH: i32 = 128;

// Banco: índice = capa * 128 + nota MIDI
const smpPtr = new StaticArray<usize>(LAYERS * 128);
const smpLen = new StaticArray<i32>(LAYERS * 128);
const smpLowKey = new StaticArray<i32>(LAYERS * 128);
const smpHighKey = new StaticArray<i32>(LAYERS * 128);
const smpLowVel = new StaticArray<i32>(LAYERS * 128);
const smpHighVel = new StaticArray<i32>(LAYERS * 128);
const smpLoopStart = new StaticArray<i32>(LAYERS * 128);
const smpLoopEnd = new StaticArray<i32>(LAYERS * 128);
const smpLoopMode = new StaticArray<i32>(LAYERS * 128);
const mapRoot = new StaticArray<i32>(LAYERS * 128);   // tecla -> raíz más cercana (-1 si no hay)
const mapLowVel = new StaticArray<i32>(LAYERS * 128);
const mapHighVel = new StaticArray<i32>(LAYERS * 128);
const layerMax = new StaticArray<i32>(LAYERS);        // velocity máximo de cada capa
const sfzPtr = new StaticArray<usize>(MAX_SFZ_REGIONS);
const sfzLen = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzRoot = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzLowKey = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzHighKey = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzLowVel = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzHighVel = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzSeqLength = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzSeqPosition = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzLoopStart = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzLoopEnd = new StaticArray<i32>(MAX_SFZ_REGIONS);
const sfzLoopMode = new StaticArray<i32>(MAX_SFZ_REGIONS);
const rrCounters = new StaticArray<i32>(128 * (MAX_SEQUENCE_LENGTH + 1));
const rrSelection = new StaticArray<i32>(MAX_SEQUENCE_LENGTH + 1);

// Voces
const vStage = new StaticArray<i32>(MAX_VOICES);      // 0 libre, 1 ataque, 2 sostenida, 3 release
const vNote = new StaticArray<i32>(MAX_VOICES);
const vKeyDown = new StaticArray<bool>(MAX_VOICES);
const vAge = new StaticArray<i32>(MAX_VOICES);
const vPtr = new StaticArray<usize>(MAX_VOICES);
const vLen = new StaticArray<i32>(MAX_VOICES);
const vPos = new StaticArray<f64>(MAX_VOICES);
const vRate = new StaticArray<f64>(MAX_VOICES);
const vLoopStart = new StaticArray<i32>(MAX_VOICES);
const vLoopEnd = new StaticArray<i32>(MAX_VOICES);
const vLoopMode = new StaticArray<i32>(MAX_VOICES);
const vEnv = new StaticArray<f32>(MAX_VOICES);
const vAmp = new StaticArray<f32>(MAX_VOICES);

const outBuf = new StaticArray<f32>(MAX_FRAMES);

let attackStep: f32 = 0.02;
let releaseCoef: f32 = 0.999;
let sustainDown: bool = false;
let counter: i32 = 0;
let sfzRegionCount: i32 = 0;

export function init(sr: f64): void {
  attackStep = <f32>(1.0 / (0.001 * sr));
  releaseCoef = <f32>Math.exp(-1.0 / (0.12 * sr));
  sustainDown = false;
  sfzRegionCount = 0;
  for (let i = 0; i < MAX_VOICES; i++) vStage[i] = 0;
  for (let i = 0; i < LAYERS * 128; i++) {
    smpLen[i] = 0;
    smpLowKey[i] = -1;
    smpHighKey[i] = -1;
    smpLowVel[i] = 1;
    smpHighVel[i] = 127;
    smpLoopStart[i] = 0;
    smpLoopEnd[i] = 0;
    smpLoopMode[i] = 0;
    mapRoot[i] = -1;
    mapLowVel[i] = 1;
    mapHighVel[i] = 127;
  }
  for (let i = 0; i < LAYERS; i++) layerMax[i] = 127;
  for (let i = 0; i < MAX_SFZ_REGIONS; i++) sfzLen[i] = 0;
  for (let i = 0; i < 128 * (MAX_SEQUENCE_LENGTH + 1); i++) rrCounters[i] = 0;
}

export function getOutPtr(): usize { return changetype<usize>(outBuf); }

export function getActiveVoices(): i32 {
  let count: i32 = 0;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] != 0) count++;
  }
  return count;
}

export function setLayerMax(layer: i32, max: i32): void {
  if (layer >= 0 && layer < LAYERS) layerMax[layer] = max;
}

export function allocSample(layer: i32, midi: i32, len: i32): usize {
  if (layer < 0 || layer >= LAYERS || midi < 0 || midi > 127 || len <= 0) return 0;
  const idx = layer * 128 + midi;
  const ptr = heap.alloc(<usize>len << 2);
  smpPtr[idx] = ptr;
  smpLen[idx] = len;
  return ptr;
}

export function setSampleZone(
  layer: i32,
  midi: i32,
  lokey: i32,
  hikey: i32,
  lovel: i32,
  hivel: i32,
  loopStart: i32,
  loopEnd: i32,
  loopMode: i32,
): void {
  if (layer < 0 || layer >= LAYERS || midi < 0 || midi > 127) return;
  const idx = layer * 128 + midi;
  smpLowKey[idx] = lokey >= 0 && lokey <= 127 ? lokey : -1;
  smpHighKey[idx] = hikey >= 0 && hikey <= 127 ? hikey : -1;
  smpLowVel[idx] = lovel >= 1 && lovel <= 127 ? lovel : 1;
  smpHighVel[idx] = hivel >= 1 && hivel <= 127 ? hivel : 127;
  smpLoopStart[idx] = loopStart >= 0 ? loopStart : 0;
  smpLoopEnd[idx] = loopEnd > loopStart ? loopEnd : 0;
  smpLoopMode[idx] = loopMode != 0 ? 1 : 0;
}

export function allocSfzSample(region: i32, len: i32): usize {
  if (region < 0 || region >= MAX_SFZ_REGIONS || len <= 0) return 0;
  const ptr = heap.alloc(<usize>len << 2);
  sfzPtr[region] = ptr;
  sfzLen[region] = len;
  return ptr;
}

export function setSfzRegion(
  region: i32,
  root: i32,
  lokey: i32,
  hikey: i32,
  lovel: i32,
  hivel: i32,
  seqLength: i32,
  seqPosition: i32,
  loopStart: i32,
  loopEnd: i32,
  loopMode: i32,
): void {
  if (
    region < 0 || region >= MAX_SFZ_REGIONS ||
    sfzLen[region] <= 0 ||
    root < 0 || root > 127 ||
    lokey < 0 || lokey > hikey || hikey > 127 ||
    lovel < 1 || lovel > hivel || hivel > 127 ||
    seqLength < 0 || seqLength > MAX_SEQUENCE_LENGTH ||
    seqPosition < 1 || (seqLength > 0 && seqPosition > seqLength)
  ) return;
  sfzRoot[region] = root;
  sfzLowKey[region] = lokey;
  sfzHighKey[region] = hikey;
  sfzLowVel[region] = lovel;
  sfzHighVel[region] = hivel;
  sfzSeqLength[region] = seqLength;
  sfzSeqPosition[region] = seqPosition;
  sfzLoopStart[region] = loopStart >= 0 ? loopStart : 0;
  sfzLoopEnd[region] = loopEnd > loopStart ? loopEnd : 0;
  sfzLoopMode[region] = loopMode != 0 ? 1 : 0;
  if (region >= sfzRegionCount) sfzRegionCount = region + 1;
}

// Para cada tecla de una capa, elige la raíz cargada más cercana
export function buildMap(layer: i32, strictMap: i32): void {
  if (layer < 0 || layer >= LAYERS) return;
  const o = layer * 128;
  for (let n = 0; n < 128; n++) {
    let best: i32 = -1;
    for (let root = 0; root < 128; root++) {
      if (
        smpLen[o + root] > 0 &&
        smpLowKey[o + root] >= 0 &&
        smpHighKey[o + root] >= smpLowKey[o + root] &&
        n >= smpLowKey[o + root] &&
        n <= smpHighKey[o + root]
      ) {
        best = root;
        break;
      }
    }
    if (best < 0 && strictMap == 0) {
      for (let d = 0; d < 128; d++) {
        if (n - d >= 0 && smpLen[o + n - d] > 0) { best = n - d; break; }
        if (n + d <= 127 && smpLen[o + n + d] > 0) { best = n + d; break; }
      }
    }
    mapRoot[o + n] = best;
    if (best >= 0) {
      mapLowVel[o + n] = smpLowVel[o + best];
      mapHighVel[o + n] = smpHighVel[o + best];
    }
  }
}

function pickLayer(velocity: i32): i32 {
  let l: i32 = 0;
  while (l < LAYERS - 1 && velocity > layerMax[l]) l++;
  return l;
}

function startVoice(
  note: i32,
  velocity: i32,
  root: i32,
  ptr: usize,
  len: i32,
  loopStart: i32,
  loopEnd: i32,
  loopMode: i32,
): void {
  let idx: i32 = -1;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] == 0) { idx = i; break; }
  }
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
  vPtr[idx] = ptr;
  vLen[idx] = len;
  vPos[idx] = 0.0;
  vRate[idx] = Math.pow(2.0, <f64>(note - root) / 12.0);
  vLoopStart[idx] = loopStart;
  vLoopEnd[idx] = loopEnd;
  vLoopMode[idx] = loopMode;
  vEnv[idx] = 0.0;
  vAmp[idx] = 0.6 * (0.35 + 0.65 * v);
  vStage[idx] = 1;
}

export function noteOn(note: i32, velocity: i32): void {
  if (note < 0 || note > 127 || velocity <= 0 || velocity > 127) return;

  if (sfzRegionCount > 0) {
    for (let seq = 0; seq <= MAX_SEQUENCE_LENGTH; seq++) rrSelection[seq] = 0;
    for (let region = 0; region < sfzRegionCount; region++) {
      if (
        sfzLen[region] <= 0 ||
        note < sfzLowKey[region] || note > sfzHighKey[region] ||
        velocity < sfzLowVel[region] || velocity > sfzHighVel[region]
      ) continue;

      const seqLength = sfzSeqLength[region];
      if (seqLength > 0) {
        if (rrSelection[seqLength] == 0) {
          const counterIdx = note * (MAX_SEQUENCE_LENGTH + 1) + seqLength;
          rrSelection[seqLength] = rrCounters[counterIdx] % seqLength + 1;
          rrCounters[counterIdx]++;
        }
        if (sfzSeqPosition[region] != rrSelection[seqLength]) continue;
      }

      startVoice(
        note,
        velocity,
        sfzRoot[region],
        sfzPtr[region],
        sfzLen[region],
        sfzLoopStart[region],
        sfzLoopEnd[region],
        sfzLoopMode[region],
      );
    }
    return;
  }

  let layer: i32 = -1;
  for (let candidate = 0; candidate < LAYERS; candidate++) {
    const mapIdx = candidate * 128 + note;
    if (
      mapRoot[mapIdx] >= 0 &&
      velocity >= mapLowVel[mapIdx] &&
      velocity <= mapHighVel[mapIdx]
    ) {
      layer = candidate;
      break;
    }
  }
  if (layer < 0) {
    // Si falta una capa, conservar una respuesta usable con la más cercana disponible.
    const want = pickLayer(velocity);
    for (let d = 0; d < LAYERS && layer < 0; d++) {
      if (want + d < LAYERS && mapRoot[(want + d) * 128 + note] >= 0) layer = want + d;
      else if (want - d >= 0 && mapRoot[(want - d) * 128 + note] >= 0) layer = want - d;
    }
  }
  if (layer < 0) return;

  const root = mapRoot[layer * 128 + note];
  const si = layer * 128 + root;

  startVoice(
    note,
    velocity,
    root,
    smpPtr[si],
    smpLen[si],
    smpLoopStart[si],
    smpLoopEnd[si],
    smpLoopMode[si],
  );
}

export function noteOff(note: i32): void {
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vStage[i] != 0 && vNote[i] == note && vKeyDown[i]) {
      vKeyDown[i] = false;
      if (!sustainDown) {
        vStage[i] = 3;
        if (vLoopMode[i] != 0) vPos[i] = <f64>vLoopEnd[i];
      }
    }
  }
}

export function setSustain(down: i32): void {
  sustainDown = down != 0;
  if (!sustainDown) {
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vStage[i] != 0 && !vKeyDown[i]) vStage[i] = 3;
      if (vStage[i] != 0 && !vKeyDown[i] && vLoopMode[i] != 0) {
        vPos[i] = <f64>vLoopEnd[i];
      }
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

      if (
        vLoopMode[v] != 0 &&
        (vKeyDown[v] || sustainDown) &&
        vLoopEnd[v] > vLoopStart[v] &&
        pos >= <f64>vLoopEnd[v]
      ) {
        const loopLength = <f64>(vLoopEnd[v] - vLoopStart[v]);
        pos = <f64>vLoopStart[v] + (pos - <f64>vLoopStart[v]) % loopLength;
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