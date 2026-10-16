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

createVirtualKeyboard($("keyboard"), handlers);

function showLatency() {
  const l = engine.getLatency();
  if (!l) return;
  $("latency").textContent =
    `Latencia: base ${l.base.toFixed(1)} ms + salida ${l.output.toFixed(1)} ms ` +
    `= ${l.total.toFixed(1)} ms  (${l.sampleRate} Hz)`;
}

$("volume").addEventListener("input", (e) => engine.setVolume(Number(e.target.value)));

$("start").addEventListener("click", async () => {
  // 1) Audio (debe iniciarse con un gesto del usuario)
  try {
    await engine.start();
    const info = await engine.loadSample(`${import.meta.env.BASE_URL}samples/C4.mp3`);
$("status").textContent = `Audio listo. Sample C4 cargado (${info.seconds.toFixed(1)} s). `;
  
    showLatency();
    setInterval(showLatency, 2000); // outputLatency puede cambiar
  } catch (err) {
    $("status").textContent = "Error de audio: " + err.message;
    return;
  }

  // 2) MIDI (si falla, el teclado virtual sigue funcionando)
  const access = await initMIDI({
    ...handlers,
    onDevices: (names) => {
      $("devices").textContent = names.length
        ? "Dispositivos: " + names.join(", ")
        : "No se detecta ningún dispositivo MIDI (puedes usar el teclado virtual)";
    },
    onError: (msg) => ($("status").textContent += msg),
  });
  if (access) $("status").textContent += "MIDI listo.";
});