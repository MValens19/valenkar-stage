const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(n) {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

export async function initMIDI({ onNoteOn, onNoteOff, onSustain, onDevices, onError }) {
  if (!navigator.requestMIDIAccess) {
    onError?.("Este navegador no soporta Web MIDI. Usa Chrome o Edge.");
    return null;
  }

  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    onError?.("Permiso MIDI denegado o no disponible: " + err.message);
    return null;
  }

  function handleMessage(event) {
    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (command === 0x90 && data2 > 0) {
      onNoteOn?.({ note: data1, velocity: data2, channel, time: event.timeStamp });
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      onNoteOff?.({ note: data1, velocity: data2, channel, time: event.timeStamp });
    } else if (command === 0xb0 && data1 === 64) {
      onSustain?.({ down: data2 >= 64, value: data2, channel });
    }
  }

  function bindInputs() {
    const inputs = [...access.inputs.values()];
    inputs.forEach((input) => (input.onmidimessage = handleMessage));
    onDevices?.(inputs.map((i) => i.name));
  }

  access.onstatechange = bindInputs; // detecta conectar/desconectar
  bindInputs();
  return access;
}