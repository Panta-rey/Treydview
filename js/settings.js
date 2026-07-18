// ============================================================
// TreydView v0.4 — Settings-Panel mit Tabs (Inputs / Style)
// Pro Plot: Sichtbarkeit, Farbe, Deckkraft (0–100%), Stärke.
// Persistenz: localStorage, Key "tv4_ind_<key>".
// ============================================================
const Settings = {

  _storageKey(indKey) { return "tv4_ind_" + indKey; },

  _loadRaw(indKey) {
    try { return JSON.parse(localStorage.getItem(this._storageKey(indKey))) || {}; }
    catch { return {}; }
  },

  _saveRaw(indKey, obj) {
    localStorage.setItem(this._storageKey(indKey), JSON.stringify(obj));
  },

  // Aufgelöste Werte: { inputs: {key: val}, plots: {key: {color(rgba), hex, opacity, width, visible}} }
  get(indKey) {
    const ind = CONFIG.INDICATORS.find(i => i.key === indKey);
    if (!ind) return { inputs: {}, plots: {} };
    const saved = this._loadRaw(indKey);
    const out = { inputs: {}, plots: {} };
    (ind.inputs || []).forEach(inp => {
      out.inputs[inp.key] = saved.inputs?.[inp.key] ?? inp.default;
    });
    (ind.plots || []).forEach(p => {
      const s = saved.plots?.[p.key] || {};
      const hex     = s.hex     ?? p.color;
      const opacity = s.opacity ?? p.opacity;
      out.plots[p.key] = {
        hex, opacity,
        color:   hexToRgba(hex, opacity),
        width:   s.width   ?? p.width,
        visible: s.visible ?? p.visible,
        dashed:  s.dashed  ?? p.dashed  ?? false,   // 1.2 gestrichelt
        showLast: s.showLast ?? p.showLast ?? true, // 1.3 Preistag an/aus
      };
    });
    return out;
  },

  open(indKey, onApply) {
    const ind = CONFIG.INDICATORS.find(i => i.key === indKey);
    if (!ind) return;
    const hasInputs = (ind.inputs || []).length > 0;
    const hasPlots  = (ind.plots  || []).length > 0;
    if (!hasInputs && !hasPlots) return;

    const current = this.get(indKey);
    document.getElementById("settingsTitle").textContent = ind.label;
    const body = document.getElementById("settingsBody");
    body.innerHTML = "";

    // ---- Tab-Leiste ----
    const tabbar = document.createElement("div");
    tabbar.className = "settings-tabs";
    const tabInputs = document.createElement("button");
    tabInputs.textContent = "Inputs";
    const tabStyle = document.createElement("button");
    tabStyle.textContent = "Style";
    tabbar.appendChild(tabInputs);
    tabbar.appendChild(tabStyle);
    body.appendChild(tabbar);

    const pageInputs = document.createElement("div");
    pageInputs.className = "settings-page";
    const pageStyle = document.createElement("div");
    pageStyle.className = "settings-page";
    body.appendChild(pageInputs);
    body.appendChild(pageStyle);

    function activate(which) {
      tabInputs.className = which === "inputs" ? "tab active" : "tab";
      tabStyle.className  = which === "style"  ? "tab active" : "tab";
      pageInputs.style.display = which === "inputs" ? "flex" : "none";
      pageStyle.style.display  = which === "style"  ? "flex" : "none";
    }
    tabInputs.addEventListener("click", () => activate("inputs"));
    tabStyle.addEventListener("click", () => activate("style"));

    // ---- Inputs-Seite ----
    (ind.inputs || []).forEach(inp => {
      const row = document.createElement("div");
      row.className = "settings-row";
      const label = document.createElement("label");
      label.textContent = inp.label;
      let input;
      if (inp.type === "select") {
        input = document.createElement("select");
        input.className = "settings-input";
        (inp.options || []).forEach(opt => {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          if (opt === current.inputs[inp.key]) o.selected = true;
          input.appendChild(o);
        });
      } else {
        input = document.createElement("input");
        input.type = "number";
        input.className = "settings-input";
        input.value = current.inputs[inp.key];
        if (inp.step) input.step = inp.step;
      }
      input.id = "sin_" + inp.key;
      row.appendChild(label);
      row.appendChild(input);
      pageInputs.appendChild(row);
    });
    if (!hasInputs) {
      pageInputs.innerHTML = '<div class="settings-empty">Keine Berechnungs-Parameter</div>';
    }

    // ---- Style-Seite (pro Plot) ----
    (ind.plots || []).forEach(p => {
      const cur = current.plots[p.key];
      const block = document.createElement("div");
      block.className = "plot-block";

      // Zeile 1: Sichtbarkeit + Name
      const head = document.createElement("div");
      head.className = "plot-head";
      if (!p.noVisible) {
        const vis = document.createElement("input");
        vis.type = "checkbox";
        vis.id = "spv_" + p.key;
        vis.checked = cur.visible;
        head.appendChild(vis);
      }
      const name = document.createElement("label");
      name.textContent = p.label;
      if (!p.noVisible) name.htmlFor = "spv_" + p.key;
      head.appendChild(name);
      block.appendChild(head);

      // Zeile 2: Farbe + Deckkraft + Stärke
      const controls = document.createElement("div");
      controls.className = "plot-controls";

      const color = document.createElement("input");
      color.type = "color";
      color.id = "spc_" + p.key;
      color.value = cur.hex;
      color.className = "plot-color";
      controls.appendChild(color);

      const opWrap = document.createElement("div");
      opWrap.className = "plot-opacity";
      const op = document.createElement("input");
      op.type = "range";
      op.min = 0; op.max = 100; op.step = 5;   // 1.1: 5%-Schritte statt 1%
      op.id = "spo_" + p.key;
      op.value = cur.opacity;
      const opVal = document.createElement("span");
      opVal.textContent = cur.opacity + "%";
      op.addEventListener("input", () => { opVal.textContent = op.value + "%"; });
      opWrap.appendChild(op);
      opWrap.appendChild(opVal);
      controls.appendChild(opWrap);

      if (!p.noWidth) {
        const width = document.createElement("input");
        width.type = "number";
        width.min = 1; width.max = 5;
        width.id = "spw_" + p.key;
        width.value = cur.width;
        width.className = "plot-width";
        width.title = "Linienstärke";
        controls.appendChild(width);
      }

      block.appendChild(controls);

      // Zeile 3: Linienart + Preis-Tag (nur für Linien-Plots, nicht Balken)
      if (!p.noWidth) {
        const opts = document.createElement("div");
        opts.className = "plot-opts";

        const dashLbl = document.createElement("label");
        dashLbl.className = "plot-opt";
        const dash = document.createElement("input");
        dash.type = "checkbox";
        dash.id = "spd_" + p.key;
        dash.checked = !!cur.dashed;
        dashLbl.appendChild(dash);
        dashLbl.appendChild(document.createTextNode(" gestrichelt"));
        opts.appendChild(dashLbl);

        const tagLbl = document.createElement("label");
        tagLbl.className = "plot-opt";
        const tag = document.createElement("input");
        tag.type = "checkbox";
        tag.id = "spt_" + p.key;
        tag.checked = cur.showLast !== false;
        tagLbl.appendChild(tag);
        tagLbl.appendChild(document.createTextNode(" Preis-Tag"));
        opts.appendChild(tagLbl);

        block.appendChild(opts);
      }

      pageStyle.appendChild(block);
    });
    if (!hasPlots) {
      pageStyle.innerHTML = '<div class="settings-empty">Keine Style-Optionen</div>';
    }

    activate(hasInputs ? "inputs" : "style");

    const overlay = document.getElementById("settingsOverlay");
    overlay.classList.remove("hidden");

    document.getElementById("settingsApply").onclick = () => {
      const saved = { inputs: {}, plots: {} };
      (ind.inputs || []).forEach(inp => {
        const el = document.getElementById("sin_" + inp.key);
        saved.inputs[inp.key] = (inp.type === "select") ? el.value : parseFloat(el.value);
      });
      (ind.plots || []).forEach(p => {
        const visEl = document.getElementById("spv_" + p.key);
        const colEl = document.getElementById("spc_" + p.key);
        const opEl  = document.getElementById("spo_" + p.key);
        const wEl   = document.getElementById("spw_" + p.key);
        const dashEl = document.getElementById("spd_" + p.key);
        const tagEl  = document.getElementById("spt_" + p.key);
        saved.plots[p.key] = {
          hex:     colEl ? colEl.value : p.color,
          opacity: opEl ? parseInt(opEl.value, 10) : p.opacity,
          width:   wEl ? parseInt(wEl.value, 10) : p.width,
          visible: visEl ? visEl.checked : true,
          dashed:  dashEl ? dashEl.checked : false,
          showLast: tagEl ? tagEl.checked : true,
        };
      });
      this._saveRaw(indKey, saved);
      overlay.classList.add("hidden");
      if (onApply) onApply(indKey);
    };

    document.getElementById("settingsClose").onclick = () => overlay.classList.add("hidden");
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add("hidden"); };
  },
};
