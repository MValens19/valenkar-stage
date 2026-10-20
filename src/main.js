import { initMIDI, noteName } from "./midi.js";
import { createVirtualKeyboard } from "./virtual-keyboard.js";
import { AudioEngine } from "./audio-engine.js";

const $ = (id) => document.getElementById(id);
const engine = new AudioEngine();

function log(text, cls = "") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = text;
  $("log").prepend(line);
  while ($("log").childElementCount > 100) $("log").lastChild.remove();
}

// Un solo punto de entrada para TODAS las fuentes (teclado virtual y MIDI real)
const handlers = {
  onNoteOn: ({ note, velocity }) => {
    engine.noteOn(note, velocity);
    log(`ON   ${noteName(note)} (${note})  velocity ${velocity}`, "on");
  },
  onNoteOff: ({ note }) => {
    engine.noteOff(note);
    log(`OFF  ${noteName(note)} (${note})`, "off");
  },
  onSustain: ({ down }) => {
    engine.sustain(down);
    log(`PEDAL sustain ${down ? "abajo" : "arriba"}`, "cc");
  },
};

createVirtualKeyboard($("keyboard"), { ...handlers, startNote: 60, octaves: 3 });

function showLatency() {
  const l = engine.getLatency();
  if (!l) return;
  $("latency").textContent =
    `Latencia: base ${l.base.toFixed(1)} ms + salida ${l.output.toFixed(1)} ms ` +
    `= ${l.total.toFixed(1)} ms  (${l.sampleRate} Hz)`;
}

$("volume").addEventListener("input", (e) => engine.setVolume(Number(e.target.value)));

let currentInstrumentPath = "library/piano/piano.sfz";

async function populateLibraryMenu() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}library/index.json`);
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return;

    $("instrument-select").innerHTML = "";
    list.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.path;
      opt.textContent = item.name;
      $("instrument-select").appendChild(opt);
    });
    currentInstrumentPath = $("instrument-select").value;
  } catch (err) {
    console.warn("No se pudo cargar el catálogo de librerías:", err);
  }
}

populateLibraryMenu();

$("instrument-select").addEventListener("change", (e) => {
  currentInstrumentPath = e.target.value;
  if (engine.ready) {
    loadCurrentInstrument();
  }
});

async function loadCurrentInstrument() {
  const name = $("instrument-select").options[$("instrument-select").selectedIndex]?.textContent || "Instrumento";
  $("status").textContent = `Cargando ${name}...`;
  try {
    const info = await engine.loadSFZ(`${import.meta.env.BASE_URL}${currentInstrumentPath}`, {
      onProgress: (n, total, layer, fromCache) =>
        ($("status").textContent = `${fromCache ? "Cargando desde almacenamiento local" : "Descargando"} ${name} (${layer})... ${n}/${total}`),
    });
    $("status").textContent =
      `${name} listo: capas ${info.layers.join(", ")}, ${info.count} samples (${info.seconds.toFixed(0)} s de audio).`;
  } catch (err) {
    $("status").textContent = "Error: " + err.message;
  }
}

$("start").addEventListener("click", async () => {
  try {
    await engine.start();
    showLatency();
    setInterval(showLatency, 2000);
  } catch (err) {
    $("status").textContent = "Error de audio: " + err.message;
    return;
  }

  // Cargar el instrumento seleccionado actualmente
  loadCurrentInstrument();

  await initMIDI({
    ...handlers,
    onDevices: (names) => {
      $("devices").textContent = names.length
        ? "Dispositivos: " + names.join(", ")
        : "No se detecta ningún dispositivo MIDI (puedes usar el teclado virtual)";
    },
    onError: (msg) => ($("devices").textContent = msg),
  });
});