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

// Control rotatorio / slider de volumen
let currentGain = 0.7;
function updateVolume(val) {
  currentGain = Math.max(0, Math.min(1, val));
  engine.setVolume(currentGain);
  
  // Decibeles aproximados: 20 * log10(gain)
  const db = currentGain > 0 ? (20 * Math.log10(currentGain)).toFixed(1) : "-inf";
  const pct = Math.round(currentGain * 100);
  
  $("gain-readout").textContent = `${db} dB`;
  const sublabel = document.querySelector(".gain-sublabel");
  if (sublabel) sublabel.textContent = `VOLUME (${pct}%)`;

  // Rotar visualmente el knob (-135deg a +135deg)
  const deg = -135 + currentGain * 270;
  $("master-knob").style.transform = `rotate(${deg}deg)`;
}

$("volume-range").addEventListener("input", (e) => updateVolume(Number(e.target.value)));

// Interacción por arrastre en el knob dorado
let isDraggingKnob = false;
let startY = 0;
let startGain = 0.7;

$("master-knob").addEventListener("pointerdown", (e) => {
  isDraggingKnob = true;
  startY = e.clientY;
  startGain = currentGain;
  $("master-knob").setPointerCapture(e.pointerId);
});

$("master-knob").addEventListener("pointermove", (e) => {
  if (!isDraggingKnob) return;
  const delta = (startY - e.clientY) / 150; // arrastrar hacia arriba sube volumen
  updateVolume(startGain + delta);
});

$("master-knob").addEventListener("pointerup", (e) => {
  isDraggingKnob = false;
});

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
  $("lat-total").textContent = `${l.total.toFixed(1)} ms`;
  $("lat-breakdown").textContent = `(base ${l.base.toFixed(1)} / salida ${l.output.toFixed(1)})`;
  $("tele-sr").textContent = `${l.sampleRate} Hz`;
}

// Catálogo de instrumentos SFZ
let currentInstrumentPath = "library/piano/piano.sfz";
let catalogList = [];

async function populateLibraryMenu() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}library/index.json`);
    if (!res.ok) return;
    catalogList = await res.json();
    if (!Array.isArray(catalogList) || catalogList.length === 0) return;

    $("instrument-select").innerHTML = "";
    catalogList.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.path;
      opt.textContent = item.name;
      opt.dataset.category = item.category || "VINTAGE KEYS";
      $("instrument-select").appendChild(opt);
    });
    currentInstrumentPath = $("instrument-select").value;
    updateOledPresetDetails();
  } catch (err) {
    console.warn("No se pudo cargar el catálogo de librerías:", err);
  }
}

function updateOledPresetDetails() {
  const sel = $("instrument-select");
  const selectedOpt = sel.options[sel.selectedIndex];
  if (!selectedOpt) return;

  $("current-preset-name").textContent = selectedOpt.textContent;
  $("preset-category").textContent = (selectedOpt.dataset.category || "CONCERT GRAND").toUpperCase();
}

populateLibraryMenu();

$("instrument-select").addEventListener("change", (e) => {
  currentInstrumentPath = e.target.value;
  updateOledPresetDetails();
  if (engine.ready) {
    loadCurrentInstrument();
  }
});

$("reload-preset-btn").addEventListener("click", () => {
  if (engine.ready) loadCurrentInstrument();
});

async function loadCurrentInstrument() {
  const sel = $("instrument-select");
  const name = sel.options[sel.selectedIndex]?.textContent || "Instrumento";
  $("preset-load-info").textContent = `Cargando ${name}...`;
  const pBar = $("oled-progress-bar");
  if (pBar) pBar.style.width = "5%";

  try {
    const info = await engine.loadSFZ(`${import.meta.env.BASE_URL}${currentInstrumentPath}`, {
      onProgress: (n, total, layer, fromCache) => {
        const pct = Math.round((n / total) * 100);
        if (pBar) pBar.style.width = `${pct}%`;
        const sourceLabel = fromCache ? "Memoria local" : "Descargando";
        $("preset-load-info").textContent = `${sourceLabel}: ${layer} (${n}/${total})`;
      },
    });

    if (pBar) pBar.style.width = "100%";
    setTimeout(() => {
      if (pBar) pBar.style.width = "0%";
    }, 1200);

    $("preset-load-info").textContent = `Listo · ${info.count} samples (${info.seconds.toFixed(0)}s audio)`;
    $("cache-status").textContent = `${info.count} muestras activas`;
  } catch (err) {
    $("preset-load-info").textContent = `Error: ${err.message}`;
    if (pBar) pBar.style.width = "0%";
  }
}

// Iniciar Motor de Audio y MIDI
$("start-engine-btn").addEventListener("click", async () => {
  if (engine.ready) return;

  const btn = $("start-engine-btn");
  const led = $("engine-led");
  const statusText = $("engine-status-text");

  btn.disabled = true;
  statusText.textContent = "INICIALIZANDO...";

  try {
    await engine.start();
    led.classList.add("active");
    btn.classList.add("engine-running");
    $("power-btn-text").textContent = "MOTOR EN LÍNEA";
    statusText.textContent = "MOTOR ACTIVO";

    refreshTelemetry();
    setInterval(refreshTelemetry, 2000);
  } catch (err) {
    statusText.textContent = "ERROR MOTOR";
    alert("Error al iniciar Web Audio: " + err.message);
    btn.disabled = false;
    return;
  }

  // Cargar el instrumento
  await loadCurrentInstrument();

  // Conectar MIDI
  await initMIDI({
    ...handlers,
    onDevices: (names) => {
      $("midi-device-label").textContent = names.length
        ? names.join(", ")
        : "Sin teclado físico (Teclado virtual activo)";
    },
    onError: (msg) => {
      $("midi-device-label").textContent = msg;
    },
  });
});