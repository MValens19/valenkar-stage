const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function createVirtualKeyboard(container, { onNoteOn, onNoteOff, startNote = 60, octaves = 2 }) {
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const BLACK = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 };

  container.className = "piano-keyboard";
  container.innerHTML = "";

  const keys = new Map();
  let currentStartNote = startNote;
  let currentOctaves = octaves;

  function render() {
    container.innerHTML = "";
    keys.clear();

    const bed = document.createElement("div");
    bed.className = "piano-keybed";

    for (let o = 0; o < currentOctaves; o++) {
      WHITE.forEach((semi) => {
        const note = currentStartNote + o * 12 + semi;
        const w = document.createElement("div");
        w.className = "piano-key white-key";
        w.dataset.note = note;

        const noteLabel = document.createElement("span");
        noteLabel.className = "key-label";
        const octaveNum = Math.floor(note / 12) - 1;
        if (semi === 0) {
          noteLabel.textContent = `C${octaveNum}`;
        }
        w.appendChild(noteLabel);

        bed.appendChild(w);
        keys.set(note, w);

        if (BLACK[semi] !== undefined) {
          const bNote = currentStartNote + o * 12 + BLACK[semi];
          const b = document.createElement("div");
          b.className = "piano-key black-key";
          b.dataset.note = bNote;
          w.appendChild(b);
          keys.set(bNote, b);
        }
      });
    }

    container.appendChild(bed);

    keys.forEach((el, note) => {
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        press(note, el, e);
      });
      el.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        release(note, el);
      });
      el.addEventListener("pointercancel", () => release(note, el));
      el.addEventListener("pointerleave", (e) => {
        if (!el.hasPointerCapture(e.pointerId)) {
          release(note, el);
        }
      });
    });
  }

  function press(note, el, e) {
    if (e) e.preventDefault();
    if (el.dataset.down) return;
    el.dataset.down = "1";
    el.classList.add("is-pressed");
    onNoteOn({ note, velocity: 110, channel: 0 });
  }

  function release(note, el) {
    if (!el.dataset.down) return;
    delete el.dataset.down;
    el.classList.remove("is-pressed");
    onNoteOff({ note, velocity: 0, channel: 0 });
  }

  render();

  return {
    setNoteActive(note, active, velocity = 100) {
      const el = keys.get(note);
      if (!el) return;
      if (active) {
        el.classList.add("is-pressed", "external-midi");
      } else {
        el.classList.remove("is-pressed", "external-midi");
      }
    },
    setOctaves(newStart, newOctaves) {
      currentStartNote = Math.max(21, Math.min(108, newStart));
      currentOctaves = Math.max(1, Math.min(7, newOctaves));
      render();
    },
    getConfig() {
      return { startNote: currentStartNote, octaves: currentOctaves };
    }
  };
}