// ============================================================
// TreydView v0.3 — Settings-Panel
// Öffnet ein Modal mit Formular-Feldern pro Indikator.
// Werte werden in localStorage persistiert.
// ============================================================
const Settings = {
  // Gespeicherte Werte laden (Fallback: defaults aus config)
  load(indKey) {
    const saved = localStorage.getItem("tv3_ind_" + indKey);
    if (!saved) return null;
    try { return JSON.parse(saved); } catch { return null; }
  },

  save(indKey, values) {
    localStorage.setItem("tv3_ind_" + indKey, JSON.stringify(values));
  },

  // Gibt die aktuellen Werte für einen Indikator zurück
  get(indKey) {
    const ind = CONFIG.INDICATORS.find(i => i.key === indKey);
    if (!ind) return {};
    const saved = this.load(indKey) || {};
    const out = {};
    (ind.settings || []).forEach(s => {
      out[s.key] = saved[s.key] !== undefined ? saved[s.key] : s.default;
    });
    return out;
  },

  // Öffnet das Settings-Panel für einen Indikator
  open(indKey, onApply) {
    const ind = CONFIG.INDICATORS.find(i => i.key === indKey);
    if (!ind || !ind.settings || ind.settings.length === 0) return;

    const current = this.get(indKey);
    document.getElementById("settingsTitle").textContent = ind.label + " – Einstellungen";

    const body = document.getElementById("settingsBody");
    body.innerHTML = "";

    ind.settings.forEach(s => {
      const row = document.createElement("div");
      row.className = "settings-row";

      const label = document.createElement("label");
      label.textContent = s.label;
      label.htmlFor = "si_" + s.key;

      let input;
      if (s.type === "color") {
        input = document.createElement("input");
        input.type = "color";
        // rgba → hex für color-Input
        const val = current[s.key] || s.default;
        input.value = val.startsWith("rgba") ? rgbaToHex(val) : val;
      } else {
        input = document.createElement("input");
        input.type = "number";
        input.value = current[s.key] ?? s.default;
        if (s.step) input.step = s.step;
      }
      input.id = "si_" + s.key;
      input.className = "settings-input";

      row.appendChild(label);
      row.appendChild(input);
      body.appendChild(row);
    });

    const overlay = document.getElementById("settingsOverlay");
    overlay.classList.remove("hidden");

    document.getElementById("settingsApply").onclick = () => {
      const values = {};
      ind.settings.forEach(s => {
        const el = document.getElementById("si_" + s.key);
        values[s.key] = s.type === "number" ? parseFloat(el.value) : el.value;
      });
      this.save(indKey, values);
      overlay.classList.add("hidden");
      if (onApply) onApply(indKey, values);
    };

    document.getElementById("settingsClose").onclick = () => {
      overlay.classList.add("hidden");
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    };
  },
};

function rgbaToHex(rgba) {
  const m = rgba.match(/[\d.]+/g);
  if (!m || m.length < 3) return "#888888";
  return "#" + [m[0], m[1], m[2]].map(v => {
    return Math.round(parseFloat(v)).toString(16).padStart(2, "0");
  }).join("");
}
