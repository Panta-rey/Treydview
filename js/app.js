// ============================================================
// TreydView v0.3.1 — App
// Sub-Indikatoren (RSI, VOL) laufen als synchronisierte Panes
// IM Hauptchart (nicht als separate Chart-Instanzen).
// ============================================================
(function () {
"use strict";

const T = CONFIG.THEME;

const state = {
  symbol:      CONFIG.DEFAULT_SYMBOLS[0],
  timeframe:   CONFIG.TIMEFRAMES.find(t => t.id === "1d"),
  active:      new Set(CONFIG.DEFAULT_ACTIVE),
  closeStream: null,
  allSymbols:  [...CONFIG.DEFAULT_SYMBOLS],
  activeTool:  null,
  vrvpMeta:    null,
  vrvpCanvas:  null,
  tooltipsVisible: true,
  subPaneIds:  {},   // indKey -> paneId (von createIndicator zurückgegeben)
  magnetMode:  "normal",   // normal | weak_magnet | strong_magnet
  pinTool:     false,      // Werkzeug nach Zeichnung aktiv lassen
  drawingId:   null,       // Overlay-ID während des Zeichnens (für ESC)
  selectedOverlayId: null, // zuletzt selektiertes Overlay (für Entf)
  chartType:   "candle_solid", // candle_solid | area
  legendCollapsed: false,
  drawStyle:   { color: "#e8b64c", lineStyle: "solid", opacity: 100, width: 1 },
};

// ---------- Chart-Init ----------
const chartEl = document.getElementById("mainChart");
const chart = klinecharts.init("mainChart");

function tooltipStyle(show) {
  return show ? "standard" : "none";
}

JavaScript
function baseStyles() {
  return {
    grid: { 
      horizontal: { color: T.grid, style: "dashed", dashedValue: [2, 2] }, 
      vertical: { color: T.grid, style: "dashed", dashedValue: [2, 2] } 
    },
    candle: {
      type: state.chartType, 
      bar: { upColor: T.up, downColor: T.down, noChangeColor: T.text,
             upBorderColor: T.up, downBorderColor: T.down,
             upWickColor: T.up, downWickColor: T.down },
      area: {
        lineColor: T.accent, lineSize: 2,
        backgroundColor: [
          { offset: 0, color: "rgba(232,182,76,0.18)" },
          { offset: 1, color: "rgba(232,182,76,0.02)" },
        ],
      },
      priceMark: { last: { upColor: T.up, downColor: T.down } },
      tooltip: { showRule: "none" },
    },
    indicator: {
      lastValueMark: { show: true, text: { show: true, family: "'IBM Plex Mono',monospace" } },
      tooltip: { showRule: "none" },
    },
    xAxis: {
      axisLine: { color: "rgba(143,163,184,0.15)" },
      tickText: { color: T.text, family: "'IBM Plex Mono',monospace" },
    },
    yAxis: {
      axisLine: { color: "rgba(143,163,184,0.15)" },
      tickText: { color: T.text, family: "'IBM Plex Mono',monospace" },
    },
    crosshair: {
      horizontal: { 
        line: { color: "rgba(232,182,76,0.4)", style: "dashed", dashedValue: [4, 4] }, 
        text: { backgroundColor: "#2a2f3a" } 
      },
      vertical: { 
        line: { color: "rgba(232,182,76,0.4)", style: "dashed", dashedValue: [4, 4] }, 
        text: { backgroundColor: "#2a2f3a" } 
      },
    },
    overlay: {
      line:  { color: T.accent },
      point: { color: T.accent, borderColor: "rgba(232,182,76,0.35)" },
      text:  { color: T.text, family: "'IBM Plex Mono',monospace" },
    },
  };
}
chart.setStyles(baseStyles());

// ---------- Indikator-Params bauen ----------
function buildCreate(ind) {
  const sv = Settings.get(ind.key);
  const inp = sv.inputs;
  const create = { name: ind.name, extendData: { plots: sv.plots } };
  switch (ind.key) {
    case "ema":     create.calcParams = [inp.p1||21, inp.p2||100, inp.p3||200]; break;
    case "boll":    create.calcParams = [inp.period||20, inp.stddev||2]; break;
    case "gc":      create.calcParams = [inp.period||144, inp.mult||1.414, inp.poles||4]; break;
    case "hull":    create.calcParams = [inp.period||55]; break;
    case "rvwap":   create.calcParams = [inp.days||365]; break;
    case "mnoodle": create.calcParams = [inp.fastPeriod||12, inp.medPeriod||21, inp.slowPeriod||35, inp.atrLength||20, inp.bandMult||0.0125]; break;
    case "bmsb":    create.calcParams = [20, 21]; break;
    case "rsi":     create.calcParams = [inp.period||14]; break;
    case "stochrsi": create.calcParams = [inp.smoothK||3, inp.smoothD||3, inp.lengthRSI||14, inp.lengthStoch||14]; break;
    default:        if (ind.calcParams) create.calcParams = ind.calcParams;
  }
  // Built-in-Indikatoren (EMA, BOLL, RSI): Linien-Styles direkt übergeben
  const lineStyle = (p) => p
    ? { 
        style: "solid", 
        dashedValue: [2, 2], // Dummy-Wert für internen Merge
        color: p.visible === false ? "rgba(0,0,0,0)" : p.color, 
        size: p.width || 1 
      }
    : undefined;
  if (ind.key === "ema") {
    create.styles = { lines: [lineStyle(sv.plots.e1), lineStyle(sv.plots.e2), lineStyle(sv.plots.e3)].filter(Boolean) };
  } else if (ind.key === "boll") {
    create.styles = { lines: [lineStyle(sv.plots.up), lineStyle(sv.plots.mid), lineStyle(sv.plots.dn)].filter(Boolean) };
  } else if (ind.key === "rsi") {
    create.styles = { lines: [lineStyle(sv.plots.line)].filter(Boolean) };
  }
  return create;
}

// ---------- Indikatoren anwenden ----------
function applyIndicator(ind) {
  if (ind.key === "vrvp") { setTimeout(drawVrvp, 80); return; } // VRVP = Canvas, kein KLC-Indikator
  const create = buildCreate(ind);
  if (ind.pane === "sub") {
    // Eigenes Pane im Hauptchart — KLineCharts synchronisiert Zeitachse automatisch
    const paneId = chart.createIndicator(create, false, { id: "pane_" + ind.key });
    state.subPaneIds[ind.key] = paneId || ("pane_" + ind.key);
  } else {
    chart.createIndicator(create, true, { id: "candle_pane" });
  }
}

function removeIndicator(ind) {
  if (ind.key === "vrvp") { state.vrvpMeta = null; drawVrvp(); return; }
  if (ind.pane === "sub") {
    const paneId = state.subPaneIds[ind.key];
    if (paneId) { chart.removeIndicator(paneId, ind.name); delete state.subPaneIds[ind.key]; }
  } else {
    chart.removeIndicator("candle_pane", ind.name);
  }
}

function applyAllActive() {
  // Erst Overlays, dann Sub-Panes (Reihenfolge = stabilere Pane-Höhen)
  CONFIG.INDICATORS.filter(i => i.pane === "main").forEach(i => { if (state.active.has(i.key)) applyIndicator(i); });
  CONFIG.INDICATORS.filter(i => i.pane === "sub").forEach(i => { if (state.active.has(i.key)) applyIndicator(i); });
}

// ---------- VRVP-Canvas ----------
function ensureVrvpCanvas() {
  if (state.vrvpCanvas) return state.vrvpCanvas;
  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:10;";
  chartEl.style.position = "relative";
  chartEl.appendChild(c);
  state.vrvpCanvas = c;
  return c;
}

// VRVP-Meta aus dem Indikator-Ergebnis holen (via direktem calc-Aufruf)
function computeVrvpMeta() {
  if (!state.active.has("vrvp")) { state.vrvpMeta = null; return; }
  const data = chart.getDataList();
  if (!data || data.length < 2) { state.vrvpMeta = null; return; }
  const sv = Settings.get("vrvp");
  // VRVP-Berechnung direkt (gleiche Logik wie im Indikator)
  const rows = sv.inputs.rows || 500, vaPct = sv.inputs.valueArea || 70;
  const prices = data.flatMap(d => [d.high, d.low]);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const rowH = (pMax - pMin) / rows;
  if (rowH === 0) { state.vrvpMeta = null; return; }
  const upVol = new Float64Array(rows), downVol = new Float64Array(rows);
  for (const d of data) {
    const vol = d.volume || 0, isUp = d.close >= d.open;
    const rLow = Math.max(0, Math.floor((d.low - pMin) / rowH));
    const rHigh = Math.min(rows - 1, Math.floor((d.high - pMin) / rowH));
    const n = rHigh - rLow + 1;
    for (let r = rLow; r <= rHigh; r++) {
      if (isUp) upVol[r] += vol / n; else downVol[r] += vol / n;
    }
  }
  const totalVol = upVol.map((u, i) => u + downVol[i]);
  const pocRow = totalVol.indexOf(Math.max(...totalVol));
  const pocPrice = pMin + (pocRow + 0.5) * rowH;
  const totalAll = totalVol.reduce((s, v) => s + v, 0);
  const vaTarget = totalAll * (vaPct / 100);
  let vaVol = totalVol[pocRow], vaLow = pocRow, vaHigh = pocRow;
  while (vaVol < vaTarget && (vaLow > 0 || vaHigh < rows - 1)) {
    const aH = vaHigh < rows-1 ? totalVol[vaHigh+1] : 0;
    const aL = vaLow > 0 ? totalVol[vaLow-1] : 0;
    if (aH >= aL) { vaHigh++; vaVol += aH; } else { vaLow--; vaVol += aL; }
  }
  state.vrvpMeta = {
    rows, pMin, pMax, rowH, upVol, downVol, totalVol,
    maxVol: Math.max(...totalVol.filter(v => v > 0)),
    pocPrice, vahPrice: pMin + (vaHigh + 1) * rowH, valPrice: pMin + vaLow * rowH,
  };
}

function drawVrvp() {
  computeVrvpMeta();
  if (!state.active.has("vrvp") || !state.vrvpMeta) {
    if (state.vrvpCanvas) {
      const ctx = state.vrvpCanvas.getContext("2d");
      ctx.clearRect(0, 0, state.vrvpCanvas.width, state.vrvpCanvas.height);
    }
    return;
  }
  const canvas = ensureVrvpCanvas();
  const sv = Settings.get("vrvp");
  const widthPct = ((sv.inputs.width || 15)) / 100;
  const { rowH, pMin, upVol, downVol, totalVol, maxVol, pocPrice, vahPrice, valPrice } = state.vrvpMeta;
  const rows = totalVol.length;
  const w = chartEl.clientWidth, h = chartEl.clientHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // Untere Grenze des Preis-Panes bestimmen: VRVP darf NICHT über die
  // Sub-Panes (RSI/VOL/Stoch) ragen. Wir ermitteln die Pixel-Y von pMin
  // und pMax im candle_pane; alles ausserhalb wird geclippt.
  const yOfMin = chart.convertToPixel({ value: pMin }, { paneId: "candle_pane", absolute: true });
  const yOfMax = chart.convertToPixel({ value: state.vrvpMeta.pMax }, { paneId: "candle_pane", absolute: true });
  const paneTop = (yOfMax && yOfMax.y != null) ? Math.max(0, yOfMax.y) : 0;
  const paneBottom = (yOfMin && yOfMin.y != null) ? yOfMin.y : h;
  // Clip-Region auf den Preis-Pane beschränken
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Math.min(paneTop, paneBottom) - 4, w, Math.abs(paneBottom - paneTop) + 8);
  ctx.clip();

  // Abstand zur Preisachse: Balken enden mit grösserem Gap, damit die
  // Preisskala frei bleibt und nichts überlappt.
  const rightGap = 96;             // px Abstand zur Preisskala (Punkt 4)
  const rightEdge = w - rightGap;
  const maxBarW = w * widthPct;

  for (let r = 0; r < rows; r++) {
    const pb = pMin + r * rowH, pt = pb + rowH, pm = (pb + pt) / 2;
    const cb = chart.convertToPixel({ value: pb }, { paneId: "candle_pane", absolute: true });
    const ct = chart.convertToPixel({ value: pt }, { paneId: "candle_pane", absolute: true });
    if (!cb || !ct || cb.y == null || ct.y == null) continue;
    const yTop = Math.min(cb.y, ct.y), yH = Math.max(1, Math.abs(ct.y - cb.y));
    const tot = totalVol[r];
    if (tot === 0) continue;
    const barW = (tot / maxVol) * maxBarW;
    const upW = (upVol[r] / maxVol) * maxBarW;
    const downW = (downVol[r] / maxVol) * maxBarW;
    const inVA = pm >= valPrice && pm <= vahPrice;
    const isPoc = Math.abs(pm - pocPrice) < rowH;
    // Balken wachsen vom rightEdge nach links
    ctx.fillStyle = (sv.plots.down && sv.plots.down.visible !== false) ? sv.plots.down.color : "rgba(0,0,0,0)";
    ctx.fillRect(rightEdge - downW, yTop, downW, yH);
    ctx.fillStyle = (sv.plots.up && sv.plots.up.visible !== false) ? sv.plots.up.color : "rgba(0,0,0,0)";
    ctx.fillRect(rightEdge - barW, yTop, upW, yH);
    if (inVA && sv.plots.va && sv.plots.va.visible !== false) { ctx.fillStyle = sv.plots.va.color; ctx.fillRect(rightEdge - barW, yTop, barW, yH); }
    if (isPoc) {
      ctx.strokeStyle = "rgba(232,182,76,0.8)"; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(0, yTop + yH/2); ctx.lineTo(rightEdge - barW, yTop + yH/2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore(); // Clip-Region aufheben
}

// VRVP bei Zoom/Scroll neu zeichnen
chart.subscribeAction("onVisibleRangeChange", () => {
  if (state.active.has("vrvp")) requestAnimationFrame(() => {
    try { drawVrvp(); } catch (e) { /* Render-Fehler nie den Loop killen lassen */ }
  });
});

// ---------- Daten laden ----------
async function loadData() {
  if (state.closeStream) { state.closeStream(); state.closeStream = null; }
  setLive("offline", "lädt …");
  setStatus(`Lade ${state.symbol.label} (${state.timeframe.label}) …`);
  let candles;
  try {
    candles = state.symbol.type === "binance"
      ? await DataLayer.fetchBinanceKlines(state.symbol.id, state.timeframe.binanceInterval, CONFIG.CANDLE_LIMIT)
      : await DataLayer.fetchGoldHistory();
  } catch (err) {
    setStatus(`Fehler: ${err.message}` + (state.symbol.type === "worker" ? " — WORKER_BASE_URL prüfen." : ""));
    setLive("offline", "Fehler");
    return;
  }
  chart.applyNewData(candles);
  updatePriceHeader(candles.at(-1), candles.at(-2));
  updateLegend();
  setStatus(`${candles.length} Candles · ${state.symbol.label} · ${state.timeframe.label}`);
  if (state.active.has("vrvp")) setTimeout(drawVrvp, 120);

  if (state.symbol.type === "binance") {
    state.closeStream = DataLayer.openBinanceStream(
      state.symbol.id, state.timeframe.binanceInterval,
      (candle) => {
        chart.updateData(candle);
        updatePriceHeader(candle, chart.getDataList().at(-2));
        updateLegend();
        if (state.active.has("vrvp")) requestAnimationFrame(drawVrvp);
      },
      s => setLive(s, s === "live" ? "Live" : "Reconnect …")
    );
  } else {
    setLive("offline", "Daily");
  }
}

// ---------- Dropdowns ----------
function initDropdowns() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
    }
  });
  ["assetDropdown", "tfDropdown", "indDropdown"].forEach(id => {
    const dd = document.getElementById(id);
    const trigger = dd.querySelector(".dd-trigger");
    const panel = dd.querySelector(".dd-panel");
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = panel.classList.contains("open");
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
      if (!wasOpen) panel.classList.add("open");
      if (id === "assetDropdown" && !wasOpen) {
        setTimeout(() => document.getElementById("assetSearch").focus(), 30);
      }
    });
  });
}

function renderAssetList(filter = "") {
  const list = document.getElementById("assetList");
  list.innerHTML = "";
  const f = filter.toUpperCase().trim();
  const items = f
    ? state.allSymbols.filter(s => s.id.includes(f) || s.label.toUpperCase().includes(f))
    : state.allSymbols;
  items.slice(0, 80).forEach(sym => {
    const item = document.createElement("div");
    item.className = "dd-item" + (sym.id === state.symbol.id ? " active" : "");
    item.textContent = sym.label;
    item.addEventListener("click", () => {
      state.symbol = sym;
      document.getElementById("assetLabel").textContent = sym.label;
      document.getElementById("assetPanel").classList.remove("open");
      if (sym.type === "worker") state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
      renderTfList();
      loadData();
    });
    list.appendChild(item);
  });
  if (items.length === 0) list.innerHTML = '<div class="dd-empty">Kein Symbol gefunden</div>';
}
document.getElementById("assetSearch").addEventListener("input", e => renderAssetList(e.target.value));

async function loadBinanceSymbols() {
  try {
    const res = await fetch(`${CONFIG.BINANCE_REST}/exchangeInfo`);
    const data = await res.json();
    const usdt = data.symbols
      .filter(s => s.quoteAsset === "USDT" && s.status === "TRADING")
      .map(s => ({ id: s.symbol, label: s.baseAsset + "/USDT", type: "binance" }));
    const existing = new Set(CONFIG.DEFAULT_SYMBOLS.map(s => s.id));
    state.allSymbols = [...CONFIG.DEFAULT_SYMBOLS, ...usdt.filter(s => !existing.has(s.id))];
    renderAssetList();
  } catch (_) { renderAssetList(); }
}

function renderTfList() {
  const list = document.getElementById("tfList");
  list.innerHTML = "";
  const goldMode = state.symbol.type === "worker";
  CONFIG.TIMEFRAMES.forEach(tf => {
    const item = document.createElement("div");
    const disabled = goldMode && tf.id !== "1d";
    item.className = "dd-item" + (tf.id === state.timeframe.id ? " active" : "") + (disabled ? " disabled" : "");
    item.textContent = tf.label;
    if (!disabled) item.addEventListener("click", () => {
      state.timeframe = tf;
      document.getElementById("tfLabel").textContent = tf.label;
      document.getElementById("tfPanel").classList.remove("open");
      renderTfList();
      loadData();
    });
    list.appendChild(item);
  });
}

function renderIndPanel() {
  const list = document.getElementById("indList");
  list.innerHTML = "";

  CONFIG.INDICATORS.forEach(ind => {
    const row = document.createElement("div");
    row.className = "dd-ind-row";
    const check = document.createElement("input");
    check.type = "checkbox"; check.id = "ind_" + ind.key; check.checked = state.active.has(ind.key);
    check.addEventListener("change", () => {
      if (check.checked) { state.active.add(ind.key); applyIndicator(ind); }
      else { state.active.delete(ind.key); removeIndicator(ind); }
      updateLegend();
      resize();
    });
    const label = document.createElement("label");
    label.htmlFor = "ind_" + ind.key; label.textContent = ind.label;
    row.appendChild(check); row.appendChild(label);
    if ((ind.inputs && ind.inputs.length) || (ind.plots && ind.plots.length)) {
      const gear = document.createElement("button");
      gear.className = "ind-gear"; gear.title = "Einstellungen"; gear.textContent = "⚙";
      gear.addEventListener("click", (e) => {
        e.stopPropagation();
        document.getElementById("indPanel").classList.remove("open");
        Settings.open(ind.key, (key) => {
          const i = CONFIG.INDICATORS.find(x => x.key === key);
          if (state.active.has(key)) { removeIndicator(i); applyIndicator(i); }
          updateLegend();
        });
      });
      row.appendChild(gear);
    }
    list.appendChild(row);
  });
}

// ---------- Eigene Legende (einklappbar) ----------
function updateLegend(hoverData) {
  const body = document.getElementById("legendBody");
  const data = chart.getDataList();
  const d = hoverData || (data && data.at(-1));
  if (!d) { body.innerHTML = ""; return; }
  const fmt = (v) => v == null ? "–" : v.toLocaleString("de-CH", { maximumFractionDigits: d.close >= 100 ? 2 : 4 });

  let html = `<div class="legend-line legend-ohlc">`
    + `<span class="lg-sym">${state.symbol.label}</span> `
    + `<span class="lg-tf">${state.timeframe.label}</span>  `
    + `O <b>${fmt(d.open)}</b>  H <b>${fmt(d.high)}</b>  L <b>${fmt(d.low)}</b>  C <b>${fmt(d.close)}</b>`
    + `  Vol ${(d.volume||0).toLocaleString("de-CH",{maximumFractionDigits:0})}`
    + `</div>`;

  // Aktive Indikatoren auflisten (Name + Farbpunkte der sichtbaren Plots)
  CONFIG.INDICATORS.filter(i => state.active.has(i.key)).forEach(ind => {
    const sv = Settings.get(ind.key);
    const dots = (ind.plots || [])
      .filter(p => sv.plots[p.key] && sv.plots[p.key].visible !== false)
      .map(p => `<span class="lg-dot" style="background:${sv.plots[p.key].color}"></span>`)
      .join("");
    html += `<div class="legend-line"><span class="lg-name">${ind.label}</span>${dots}</div>`;
  });
  body.innerHTML = html;
}

function toggleLegend() {
  state.legendCollapsed = !state.legendCollapsed;
  const legend = document.getElementById("chartLegend");
  const btn = document.getElementById("legendToggle");
  legend.classList.toggle("collapsed", state.legendCollapsed);
  btn.textContent = state.legendCollapsed ? "▸" : "▾";
}

// ---------- Chart-Typ (Kerzen / Linie) ----------
function renderTypeList() {
  const list = document.getElementById("typeList");
  list.innerHTML = "";
  const types = [
    { id: "candle_solid", label: "Kerzen" },
    { id: "area",         label: "Linie" },
  ];
  types.forEach(t => {
    const item = document.createElement("div");
    item.className = "dd-item" + (t.id === state.chartType ? " active" : "");
    item.textContent = t.label;
    item.addEventListener("click", () => {
      state.chartType = t.id;
      document.getElementById("typeLabel").textContent = t.label;
      document.getElementById("typePanel").classList.remove("open");
      chart.setStyles(baseStyles());
      renderTypeList();
    });
    list.appendChild(item);
  });
}

// ---------- Screenshot & Auto-Zoom ----------
function takeScreenshot() {
  try {
    const url = chart.getConvertPictureUrl(true, "jpeg", "#0d1117");
    const a = document.createElement("a");
    a.href = url;
    a.download = `treydview_${state.symbol.id}_${state.timeframe.id}_${Date.now()}.jpeg`;
    a.click();
  } catch (e) {
    setStatus("Screenshot fehlgeschlagen: " + e.message);
  }
}

function autoZoom() {
  // Y-Achse automatisch an sichtbaren Bereich anpassen
  chart.setPaneOptions({ id: "candle_pane", axis: { name: "normal", scrollZoomEnabled: true } });
  chart.resize();
  // Re-Fit: ganze Datenbreite zeigen
  chart.scrollToRealTime();
}

// ---------- Drawing-Toolbar ----------
function currentOverlayStyles() {
  const ds = state.drawStyle;
  const col = hexToRgba(ds.color, ds.opacity);
  return {
    line: { 
      color: col, 
      size: ds.width, 
      style: ds.lineStyle,
      dashedValue: [4, 4] // <-- Hier fehlte der Wert
    },
    polygon: { 
      fillColor: hexToRgba(ds.color, Math.min(ds.opacity, 15)), 
      stroke: { 
        color: col, 
        size: ds.width, 
        style: ds.lineStyle,
        dashedValue: [4, 4] // <-- Hier fehlte der Wert
      } 
    },
    rect: { 
      fillColor: hexToRgba(ds.color, Math.min(ds.opacity, 15)), 
      stroke: { 
        color: col, 
        size: ds.width, 
        style: ds.lineStyle,
        dashedValue: [4, 4] // <-- Hier fehlte der Wert
      } 
    },
    text: { color: col },
  };
}

function startTool(overlayName) {
  state.activeTool = overlayName;
  const id = chart.createOverlay({
    name: overlayName,
    mode: state.magnetMode,
    styles: currentOverlayStyles(),
    onDrawEnd: () => {
      state.drawingId = null;
      if (state.pinTool) {
        setTimeout(() => startTool(overlayName), 0);
      } else {
        state.activeTool = null;
        renderDrawbar();
      }
      return false;
    },
    onSelected:   (e) => { state.selectedOverlayId = e.overlay.id; return false; },
    onDeselected: () => { state.selectedOverlayId = null; return false; },
  });
  state.drawingId = Array.isArray(id) ? id[0] : id;
  renderDrawbar();
}

function toggleDrawStylePopover() {
  let pop = document.getElementById("drawStylePopover");
  if (pop) { pop.remove(); return; }
  pop = document.createElement("div");
  pop.id = "drawStylePopover";
  pop.className = "draw-style-popover";
  const ds = state.drawStyle;
  pop.innerHTML = `
    <div class="dsp-row"><label>Farbe</label><input type="color" id="dspColor" value="${ds.color}"></div>
    <div class="dsp-row"><label>Deckkraft</label><input type="range" min="0" max="100" id="dspOpacity" value="${ds.opacity}"><span id="dspOpVal">${ds.opacity}%</span></div>
    <div class="dsp-row"><label>Stärke</label><input type="number" min="1" max="5" id="dspWidth" value="${ds.width}"></div>
    <div class="dsp-row"><label>Linienart</label>
      <select id="dspLineStyle">
        <option value="solid"${ds.lineStyle==="solid"?" selected":""}>durchgezogen</option>
        <option value="dashed"${ds.lineStyle==="dashed"?" selected":""}>gestrichelt</option>
      </select>
    </div>`;
  document.body.appendChild(pop);
  const bar = document.getElementById("drawbar").getBoundingClientRect();
  pop.style.left = (bar.right + 6) + "px";
  pop.style.top = "120px";

  const opEl = pop.querySelector("#dspOpacity");
  opEl.addEventListener("input", () => { pop.querySelector("#dspOpVal").textContent = opEl.value + "%"; });
  const apply = () => {
    state.drawStyle = {
      color: pop.querySelector("#dspColor").value,
      opacity: parseInt(opEl.value, 10),
      width: parseInt(pop.querySelector("#dspWidth").value, 10),
      lineStyle: pop.querySelector("#dspLineStyle").value,
    };
  };
  pop.querySelectorAll("input,select").forEach(el => el.addEventListener("change", apply));
  // Klick ausserhalb schliesst
  setTimeout(() => {
    document.addEventListener("click", function close(e) {
      if (!pop.contains(e.target) && e.target.id !== "drawStyleBtn") {
        pop.remove(); document.removeEventListener("click", close);
      }
    });
  }, 10);
}

function renderDrawbar() {
  const bar = document.getElementById("drawbar");
  bar.innerHTML = "";

  // Stil-Wähler ganz oben
  const styleBtn = document.createElement("button");
  styleBtn.id = "drawStyleBtn";
  styleBtn.className = "draw-btn";
  styleBtn.title = "Zeichenstil (Farbe, Linienart, Deckkraft)";
  styleBtn.textContent = "🎨";
  styleBtn.style.setProperty("border-bottom", `3px solid ${hexToRgba(state.drawStyle.color, state.drawStyle.opacity)}`);
  styleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleDrawStylePopover(); });
  bar.appendChild(styleBtn);

  const sep0 = document.createElement("div"); sep0.className = "draw-sep"; bar.appendChild(sep0);

  CONFIG.DRAW_TOOLS.forEach(tool => {
    const btn = document.createElement("button");
    btn.textContent = tool.icon; btn.title = tool.title;
    btn.className = "draw-btn" + (state.activeTool === tool.overlay ? " active" : "");
    btn.addEventListener("click", () => startTool(tool.overlay));
    bar.appendChild(btn);
  });

  const sep1 = document.createElement("div"); sep1.className = "draw-sep"; bar.appendChild(sep1);

  const magnet = document.createElement("button");
  const magnetLabels = { normal: "Magnet: aus", weak_magnet: "Magnet: schwach", strong_magnet: "Magnet: stark" };
  magnet.textContent = "⌖";
  magnet.title = magnetLabels[state.magnetMode] + " (klicken zum Wechseln)";
  magnet.className = "draw-btn" + (state.magnetMode !== "normal" ? " active" : "");
  magnet.addEventListener("click", () => {
    state.magnetMode = state.magnetMode === "normal" ? "weak_magnet"
                     : state.magnetMode === "weak_magnet" ? "strong_magnet" : "normal";
    renderDrawbar();
  });
  bar.appendChild(magnet);

  const pin = document.createElement("button");
  pin.textContent = "📌";
  pin.title = state.pinTool ? "Werkzeug bleibt aktiv (an)" : "Werkzeug bleibt aktiv (aus)";
  pin.className = "draw-btn" + (state.pinTool ? " active" : "");
  pin.addEventListener("click", () => { state.pinTool = !state.pinTool; renderDrawbar(); });
  bar.appendChild(pin);

  const sep2 = document.createElement("div"); sep2.className = "draw-sep"; bar.appendChild(sep2);

  const clear = document.createElement("button");
  clear.textContent = "✕"; clear.title = "Alle Zeichnungen löschen"; clear.className = "draw-btn danger";
  clear.addEventListener("click", () => chart.removeOverlay());
  bar.appendChild(clear);
}

// Tastatur: ESC bricht Zeichnen ab, Entf löscht selektiertes Overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.drawingId != null) {
      chart.removeOverlay(state.drawingId);
      state.drawingId = null;
    }
    state.activeTool = null;
    renderDrawbar();
  } else if ((e.key === "Delete" || e.key === "Backspace") && state.selectedOverlayId != null) {
    // Nicht löschen wenn der Fokus in einem Eingabefeld liegt
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    chart.removeOverlay(state.selectedOverlayId);
    state.selectedOverlayId = null;
  }
});

// ---------- Price-Header ----------
function updatePriceHeader(last, prev) {
  if (!last) return;
  const ref = prev || last;
  const change = ref.close ? ((last.close - ref.close) / ref.close) * 100 : 0;
  const d = last.close >= 100 ? 2 : 4;
  document.getElementById("phSymbol").textContent = state.symbol.label;
  document.getElementById("phPrice").textContent = last.close.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
  const chEl = document.getElementById("phChange");
  chEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  chEl.className = "ph-change " + (change >= 0 ? "up" : "down");
}

function setLive(mode, text) {
  document.getElementById("liveBadge").className = "live-badge " + mode;
  document.getElementById("liveText").textContent = text;
}
function setStatus(t) { document.getElementById("statusline").textContent = t; }

// ---------- Resize ----------
function resize() {
  chart.resize();
  if (state.vrvpCanvas) {
    state.vrvpCanvas.width = chartEl.clientWidth;
    state.vrvpCanvas.height = chartEl.clientHeight;
    if (state.active.has("vrvp")) drawVrvp();
  }
}
new ResizeObserver(resize).observe(document.querySelector(".workspace"));

// ---------- Start ----------
initDropdowns();
renderAssetList();
renderTfList();
renderTypeList();
renderIndPanel();
renderDrawbar();
applyAllActive();
updateLegend();
loadBinanceSymbols();
loadData();

// Legende folgt dem Crosshair
chart.subscribeAction("onCrosshairChange", (data) => {
  try {
    if (data && data.kLineData) updateLegend(data.kLineData);
    else updateLegend();
  } catch (e) { /* Legend-Fehler nie den Chart blockieren lassen */ }
});

// Button-Handler
document.getElementById("legendToggle").addEventListener("click", toggleLegend);
document.getElementById("screenshotBtn").addEventListener("click", takeScreenshot);
document.getElementById("autoZoomBtn").addEventListener("click", autoZoom);

// Type-Dropdown öffnen/schliessen (zur bestehenden Dropdown-Logik hinzufügen)
(function initTypeDropdown() {
  const dd = document.getElementById("typeDropdown");
  const trigger = dd.querySelector(".dd-trigger");
  const panel = dd.querySelector(".dd-panel");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = panel.classList.contains("open");
    document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
    if (!wasOpen) panel.classList.add("open");
  });
})();

})();
