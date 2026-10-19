export function createVirtualKeyboard(container, { onNoteOn, onNoteOff, startNote = 60, octaves = 2 }) {
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const BLACK = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 }; // semitono blanco -> negra a su derecha
  container.style.cssText =
    "position:relative;display:flex;height:160px;user-select:none;touch-action:none;margin-top:16px;";

  const keys = new Map();

  function press(note, el, e) {
    e.preventDefault();
    if (el.dataset.down) return;
    el.dataset.down = "1";
    el.style.filter = "brightness(0.7)";
    onNoteOn({ note, velocity: 127, channel: 0 });
  }
  function release(note, el) {
    if (!el.dataset.down) return;
    delete el.dataset.down;
    el.style.filter = "";
    onNoteOff({ note, velocity: 0, channel: 0 });
  }

  for (let o = 0; o < octaves; o++) {
    WHITE.forEach((semi, i) => {
      const note = startNote + o * 12 + semi;
      const w = document.createElement("div");
      w.style.cssText =
        "flex:1;background:#fff;border:1px solid #333;border-radius:0 0 6px 6px;position:relative;";
      container.appendChild(w);
      keys.set(note, w);

      if (BLACK[semi] !== undefined) {
        const bNote = startNote + o * 12 + BLACK[semi];
        const b = document.createElement("div");
        b.style.cssText =
          "position:absolute;top:0;right:-14%;width:28%;height:60%;background:#111;border-radius:0 0 4px 4px;z-index:2;";
        w.appendChild(b);
        keys.set(bNote, b);
      }
    });
  }

  keys.forEach((el, note) => {
    el.addEventListener("pointerdown", (e) => { el.setPointerCapture(e.pointerId); press(note, el, e); });
    el.addEventListener("pointerup", () => release(note, el));
    el.addEventListener("pointercancel", () => release(note, el));
    el.addEventListener("pointerleave", () => release(note, el));
  });
}