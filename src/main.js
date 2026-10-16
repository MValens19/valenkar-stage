import { initMIDI, noteName } from "./midi.js";

const $ = (id) => document.getElementById(id);

function log(text, cls = "") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = text;
  $("log").prepend(line);
}

$("start").addEventListener("click", async () => {
  const access = await initMIDI({
    onNoteOn: ({ note, velocity }) =>
      log(`ON   ${noteName(note)} (${note})  velocity ${velocity}`, "on"),
    onNoteOff: ({ note }) =>
      log(`OFF  ${noteName(note)} (${note})`, "off"),
    onSustain: ({ down }) =>
      log(`PEDAL sustain ${down ? "abajo" : "arriba"}`, "cc"),
    onDevices: (names) => {
      $("devices").textContent = names.length
        ? "Dispositivos: " + names.join(", ")
        : "No se detecta ningún dispositivo MIDI";
    },
    onError: (msg) => ($("status").textContent = msg),
  });

  if (access) $("status").textContent = "MIDI listo. Toca una tecla.";
});

import { createVirtualKeyboard } from "./virtual-keyboard.js";

const handlers = {
  onNoteOn: ({ note, velocity }) => log(`ON   ${noteName(note)} (${note})  velocity ${velocity}`, "on"),
  onNoteOff: ({ note }) => log(`OFF  ${noteName(note)} (${note})`, "off"),
};

createVirtualKeyboard($("keyboard"), handlers);