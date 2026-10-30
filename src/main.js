import { initMIDI, noteName } from "./midi.js";
import { createVirtualKeyboard } from "./virtual-keyboard.js";
import { AudioEngine } from "./audio-engine.js";

const $ = (id) => document.getElementById(id);
const engine = new AudioEngine();

// Estado del teclado virtual
let currentStartNote = 48; // C3
let currentOctaves = 3;   // 3 octavas (C3 a B5)

let keyboard = null;

// Gestores unificados de entrada (Teclado virtual y Teclado MIDI externo)
const handlers = {
  onNoteOn: ({ note, velocity }) => {
    if (engine.ctx && engine.ctx.state === "suspended") {
      engine.ctx.resume();
    }
    engine.noteOn(note, velocity);
    keyboard?.setNoteActive(note, true, velocity);
  },
  onNoteOff: ({ note }) => {
    engine.noteOff(note);
    keyboard?.setNoteActive(note, false);
  },
  onSustain: ({ down }) => {
    engine.sustain(down);
    const badge = $("sustain-badge");
    if (badge) {
      if (down) {
        badge.classList.add("active");
        badge.textContent = "ON";
      } else {
        badge.classList.remove("active");
        badge.textContent = "OFF";
      }
    }
  },
};

// Inicializar teclado virtual de lujo
keyboard = createVirtualKeyboard($("keyboard-container"), {
  ...handlers,
  startNote: currentStartNote,
  octaves: currentOctaves,
});

function updateRangeLabel() {
  const startName = noteName(currentStartNote);
  const endName = noteName(currentStartNote + currentOctaves * 12 - 1);
  const tag = $("current-range-tag");
  if (tag) tag.textContent = `${startName} - ${endName}`;
}

updateRangeLabel();

// Controles de octavas y transposición
document.querySelectorAll(".oct-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".oct-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentOctaves = Number(btn.dataset.oct);
    keyboard.setOctaves(currentStartNote, currentOctaves);
    updateRangeLabel();
  });
});

$("oct-down").addEventListener("click", () => {
  if (currentStartNote - 12 >= 21) { // A0 es 21
    currentStartNote -= 12;
    keyboard.setOctaves(currentStartNote, currentOctaves);
    updateRangeLabel();
  }
});

$("oct-up").addEventListener("click", () => {
  if (currentStartNote + 12 + currentOctaves * 12 <= 109) { // C8 es 108
    currentStartNote += 12;
    keyboard.setOctaves(currentStartNote, currentOctaves);
    updateRangeLabel();
  }
});

// Control slider / fader de volumen
let currentGain = 0.7;
function updateVolume(val) {
  currentGain = Math.max(0, Math.min(1, val));
  engine.setVolume(currentGain);
  
  // Decibeles aproximados: 20 * log10(gain)
  const db = currentGain > 0 ? (20 * Math.log10(currentGain)).toFixed(1) : "-inf";
  const pct = Math.round(currentGain * 100);
  
  const gainReadout = $("gain-readout");
  if (gainReadout) gainReadout.textContent = `${db} dB`;
  const sublabel = document.querySelector(".gain-sublabel");
  if (sublabel) sublabel.textContent = `VOLUME (${pct}%)`;

  const slider = $("volume-range");
  if (slider) {
    if (Number(slider.value) !== currentGain) {
      slider.value = currentGain;
    }
    slider.style.setProperty("--fader-pct", `${pct}%`);
  }
}

const volumeSlider = $("volume-range");
if (volumeSlider) {
  volumeSlider.addEventListener("input", (e) => updateVolume(Number(e.target.value)));
}

updateVolume(0.7);

// Métricas de audio en tiempo real (Polifonía y Vúmetro dinámico)
let smoothPeakL = 0;
let smoothPeakR = 0;

engine.onMetrics = ({ voices, peak }) => {
  // Contador de voces
  const vEl = $("voice-counter");
  if (vEl) {
    vEl.textContent = voices < 10 ? `0${voices}` : String(voices);
  }

  // Suavizado de peak para animación musical
  const target = Math.min(1, peak * 1.4);
  smoothPeakL = Math.max(target, smoothPeakL * 0.82);
  smoothPeakR = Math.max(target * 0.96, smoothPeakR * 0.82);

  const pctL = Math.min(100, Math.round(smoothPeakL * 100));
  const pctR = Math.min(100, Math.round(smoothPeakR * 100));

  const vuLeft = $("vu-left");
  const vuRight = $("vu-right");
  const vuPeakL = $("vu-peak-l");
  const vuPeakR = $("vu-peak-r");

  if (vuLeft) vuLeft.style.width = `${pctL}%`;
  if (vuRight) vuRight.style.width = `${pctR}%`;
  if (vuPeakL) vuPeakL.style.left = `${Math.max(0, pctL - 2)}%`;
  if (vuPeakR) vuPeakR.style.left = `${Math.max(0, pctR - 2)}%`;
};

// Latencia y telemetría
function refreshTelemetry() {
  const l = engine.getLatency();
  if (!l) return;
  const latTotal = $("lat-total");
  const latBreakdown = $("lat-breakdown");
  const teleSr = $("tele-sr");

  if (latTotal) latTotal.textContent = `${l.total.toFixed(1)} ms`;
  if (latBreakdown) latBreakdown.textContent = `(base ${l.base.toFixed(1)} / salida ${l.output.toFixed(1)})`;
  if (teleSr) teleSr.textContent = `${l.sampleRate} Hz`;
}

// Iniciar automáticamente el motor de audio y MIDI
let engineStartPromise = null;

async function startAudioSystem() {
  if (engineStartPromise) return engineStartPromise;

  engineStartPromise = (async () => {
    const led = $("engine-led");
    const statusText = $("engine-status-text");

    if (statusText) statusText.textContent = "INICIALIZANDO...";

    try {
      await engine.start();
      if (led) led.classList.add("active");
      if (statusText) statusText.textContent = "MOTOR ACTIVO";

      refreshTelemetry();
      setInterval(refreshTelemetry, 2000);
    } catch (err) {
      console.error("Error al iniciar motor de audio:", err);
      if (statusText) statusText.textContent = "ERROR MOTOR";
      return false;
    }

    // Conectar MIDI automáticamente
    try {
      await initMIDI({
        ...handlers,
        onDevices: (names) => {
          const devLabel = $("midi-device-label");
          if (devLabel) {
            devLabel.textContent = names.length
              ? names.join(", ")
              : "Sin teclado físico (Teclado virtual activo)";
          }
        },
        onError: (msg) => {
          const devLabel = $("midi-device-label");
          if (devLabel) devLabel.textContent = msg;
        },
      });
    } catch (err) {
      console.warn("Error inicializando MIDI:", err);
    }

    return true;
  })();

  return engineStartPromise;
}

// Desbloqueo de AudioContext ante cualquier gesto del usuario
function setupAudioUnlock() {
  const unlock = async () => {
    if (engine.ctx && engine.ctx.state === "suspended") {
      try {
        await engine.ctx.resume();
      } catch (e) {
        console.warn("No se pudo reanudar AudioContext:", e);
      }
    }
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

// Catálogo de instrumentos SFZ
let currentInstrumentPath = "library/piano/piano.sfz";
let catalogList = [];
let currentLoadId = 0;

async function populateLibraryMenu() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}library/index.json`);
    if (!res.ok) return;
    catalogList = await res.json();
    if (!Array.isArray(catalogList) || catalogList.length === 0) return;

    const select = $("instrument-select");
    if (!select) return;
    select.innerHTML = "";
    catalogList.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.path;
      opt.textContent = item.name;
      opt.dataset.category = item.category || "VINTAGE KEYS";
      select.appendChild(opt);
    });
    currentInstrumentPath = select.value;
    updateOledPresetDetails();

    // Cargar automáticamente el primer instrumento seleccionado
    loadCurrentInstrument();
  } catch (err) {
    console.warn("No se pudo cargar el catálogo de librerías:", err);
  }
}

function updateOledPresetDetails() {
  const sel = $("instrument-select");
  if (!sel) return;
  const selectedOpt = sel.options[sel.selectedIndex];
  if (!selectedOpt) return;

  const presetName = $("current-preset-name");
  if (presetName) presetName.textContent = selectedOpt.textContent;
  const presetCat = $("preset-category");
  if (presetCat) presetCat.textContent = (selectedOpt.dataset.category || "CONCERT GRAND").toUpperCase();
}

$("instrument-select")?.addEventListener("change", (e) => {
  currentInstrumentPath = e.target.value;
  updateOledPresetDetails();
  // Carga automática al seleccionar instrumento en la biblioteca
  loadCurrentInstrument();
});

$("reload-preset-btn")?.addEventListener("click", () => {
  loadCurrentInstrument();
});

async function loadCurrentInstrument() {
  const loadId = ++currentLoadId;
  const ok = await startAudioSystem();
  if (!ok || loadId !== currentLoadId) return;

  const sel = $("instrument-select");
  const name = sel ? (sel.options[sel.selectedIndex]?.textContent || "Instrumento") : "Instrumento";
  const infoEl = $("preset-load-info");
  if (infoEl) infoEl.textContent = `Cargando ${name}...`;
  const pBar = $("oled-progress-bar");
  if (pBar) pBar.style.width = "5%";

  try {
    const info = await engine.loadSFZ(`${import.meta.env.BASE_URL}${currentInstrumentPath}`, {
      onProgress: (n, total, layer, fromCache) => {
        if (loadId !== currentLoadId) return;
        const pct = Math.round((n / total) * 100);
        if (pBar) pBar.style.width = `${pct}%`;
        const sourceLabel = fromCache ? "Memoria local" : "Descargando";
        if (infoEl) infoEl.textContent = `${sourceLabel}: ${layer} (${n}/${total})`;
      },
    });

    if (loadId !== currentLoadId) return;

    if (pBar) pBar.style.width = "100%";
    setTimeout(() => {
      if (pBar && loadId === currentLoadId) pBar.style.width = "0%";
    }, 1200);

    if (infoEl) infoEl.textContent = `Listo · ${info.count} samples (${info.seconds.toFixed(0)}s audio)`;
    const cacheEl = $("cache-status");
    if (cacheEl) cacheEl.textContent = `${info.count} muestras activas`;
  } catch (err) {
    if (loadId !== currentLoadId) return;
    if (infoEl) infoEl.textContent = `Error: ${err.message}`;
    if (pBar) pBar.style.width = "0%";
  }
}

// Inicialización automática
setupAudioUnlock();
startAudioSystem();
populateLibraryMenu();
