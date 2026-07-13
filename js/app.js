// ============================================================
// TreydView v0.3.1 — App
// Sub-Indikatoren (RSI, VOL) laufen als synchronisierte Panes
// IM Hauptchart (nicht als separate Chart-Instanzen).
// ============================================================
(function () {
"use strict";

const T = CONFIG.THEME;

// ---------- Workspace-Persistenz ----------
// Speichert Symbol, Timeframe, aktive Indikatoren, Chart-Typ in localStorage,
// damit beim nächsten Öffnen die letzte Konfiguration wiederhergestellt wird.
function loadWorkspace() {
  try {
    const raw = localStorage.getItem("tv_workspace");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

const _ws = loadWorkspace();

const state = {
  symbol:      _ws?.symbol || CONFIG.DEFAULT_SYMBOLS[0],
  timeframe:   CONFIG.TIMEFRAMES.find(t => t.id === (_ws?.timeframeId || "1d")) || CONFIG.TIMEFRAMES.find(t => t.id === "1d"),
  active:      new Set(_ws?.active || CONFIG.DEFAULT_ACTIVE),
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
  chartType:   _ws?.chartType || "candle_solid", // candle_solid | area
  legendCollapsed: _ws?.legendCollapsed || false,
  drawStyle:   _ws?.drawStyle || { color: "#e8b64c", lineStyle: "solid", opacity: 100, width: 1 },
  compareAssets: [],   // [{ id, label, color, data: [{timestamp, close}] }]
};

// Farbpalette für Vergleichs-Assets
const COMPARE_COLORS = ["#5aa9e6", "#e8b64c", "#c792ea", "#3fb68b", "#ff6d00", "#ff5c8a"];

// ---------- Chart-Init ----------
const chartEl = document.getElementById("mainChart");
const chart = klinecharts.init("mainChart");

// Bridge: FRVP-Overlay (overlays.js) braucht Zugriff auf die Candle-Daten
window.__tvGetDataList = () => chart.getDataList();

function tooltipStyle(show) {
  return show ? "standard" : "none";
}

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

  // Clip auf die ECHTEN Grenzen des Preis-Panes (candle_pane).
  // getSize liefert das Bounding inkl. top+height — so ragt VRVP nie in
  // die Sub-Panes (RSI/VOL/Stoch), egal wie stark gezoomt/gescrollt wird.
  let clipTop = 0, clipHeight = h;
  try {
    const b = chart.getSize("candle_pane");
    if (b && b.height) {
      clipTop = b.top != null ? b.top : 0;
      clipHeight = b.height;
    }
  } catch (e) { /* Fallback: ganzes Canvas */ }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, clipTop, w, clipHeight);
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
chart.subscribeAction("onVisibleRangeChange", (range) => {
  if (state.active.has("vrvp")) requestAnimationFrame(() => {
    try { drawVrvp(); } catch (e) { /* Render-Fehler nie den Loop killen lassen */ }
  });
  // Vergleichsmodus: linken sichtbaren Rand als neuen 0%-Referenzpunkt setzen
  // und Compare-Indikator reaktiv neu berechnen.
  if (state.compareAssets.length > 0 && range) {
    const from = Number.isInteger(range.from) ? range.from : 0;
    if (window.__tvVisibleFrom !== from) {
      window.__tvVisibleFrom = from;
      try { chart.overrideIndicator({ name: "COMPARE" }, "candle_pane"); } catch (e) {}
    }
  }
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
  ["assetDropdown", "compareDropdown", "tfDropdown", "typeDropdown", "indDropdown"].forEach(id => {
    const dd = document.getElementById(id);
    if (!dd) return;
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
      if (id === "compareDropdown" && !wasOpen) {
        renderCompareActive();
        setTimeout(() => document.getElementById("compareSearch").focus(), 30);
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
      saveWorkspace();
      document.getElementById("assetLabel").textContent = sym.label;
      document.getElementById("assetPanel").classList.remove("open");
      if (sym.type === "worker") state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
      renderTfList();
      renderCompareList();
      loadData();
      reloadAllCompareData();
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
    renderCompareList();
  } catch (_) { renderAssetList(); }
}

// ---------- Multi-Asset-Vergleich ----------
function renderCompareList(filter = "") {
  const list = document.getElementById("compareList");
  if (!list) return;
  list.innerHTML = "";
  const f = filter.toUpperCase().trim();
  // Nur Binance-Assets vergleichbar (brauchen Kline-Endpoint)
  const items = state.allSymbols.filter(s => s.type === "binance" &&
    (f ? (s.id.includes(f) || s.label.toUpperCase().includes(f)) : true) &&
    s.id !== state.symbol.id &&
    !state.compareAssets.some(c => c.id === s.id));
  items.slice(0, 60).forEach(sym => {
    const item = document.createElement("div");
    item.className = "dd-item";
    item.textContent = sym.label;
    item.addEventListener("click", () => addCompareAsset(sym));
    list.appendChild(item);
  });
  if (items.length === 0) list.innerHTML = '<div class="dd-empty">Kein Symbol</div>';
}

function renderCompareActive() {
  const box = document.getElementById("compareActive");
  if (!box) return;
  box.innerHTML = "";
  if (state.compareAssets.length === 0) {
    box.innerHTML = '<div class="dd-empty">Noch keine Vergleiche</div>';
    return;
  }
  state.compareAssets.forEach(a => {
    const chip = document.createElement("div");
    chip.className = "compare-chip";
    chip.innerHTML = `<span class="cc-dot" style="background:${a.color}"></span>`
      + `<span class="cc-label">${a.label}</span>`
      + `<button class="cc-remove" title="Entfernen">✕</button>`;
    chip.querySelector(".cc-remove").addEventListener("click", () => removeCompareAsset(a.id));
    box.appendChild(chip);
  });
}

async function addCompareAsset(sym) {
  if (state.compareAssets.length >= COMPARE_COLORS.length) {
    setStatus(`Maximal ${COMPARE_COLORS.length} Vergleichs-Assets`);
    return;
  }
  const color = COMPARE_COLORS[state.compareAssets.length];
  const entry = { id: sym.id, label: sym.label, color, data: [] };
  state.compareAssets.push(entry);
  renderCompareActive();
  renderCompareList(document.getElementById("compareSearch")?.value || "");
  await refreshCompareData(entry);
  applyCompareIndicator();
}

function removeCompareAsset(id) {
  state.compareAssets = state.compareAssets.filter(c => c.id !== id);
  // Farben neu zuordnen, damit sie konsistent bleiben
  state.compareAssets.forEach((a, i) => { a.color = COMPARE_COLORS[i]; });
  window.__tvCompareAssets = state.compareAssets;
  renderCompareActive();
  renderCompareList(document.getElementById("compareSearch")?.value || "");
  applyCompareIndicator();
}

// Kline-Daten eines Vergleichs-Assets im aktuellen Timeframe holen
async function refreshCompareData(entry) {
  try {
    const candles = await DataLayer.fetchBinanceKlines(entry.id, state.timeframe.binanceInterval, CONFIG.CANDLE_LIMIT);
    entry.data = candles.map(c => ({ timestamp: c.timestamp, close: c.close }));
    window.__tvCompareAssets = state.compareAssets;
  } catch (e) {
    setStatus(`Vergleichsdaten ${entry.label} fehlgeschlagen`);
  }
}

// Compare-Indikator (COMPARE) auf dem Hauptchart an/aus/aktualisieren
function applyCompareIndicator() {
  window.__tvCompareAssets = state.compareAssets;
  if (state.compareAssets.length > 0) {
    // Referenzpunkt initial auf den aktuell linken sichtbaren Rand setzen
    try {
      const range = chart.getVisibleRange ? chart.getVisibleRange() : null;
      window.__tvVisibleFrom = range && Number.isInteger(range.from) ? range.from : 0;
    } catch (e) { window.__tvVisibleFrom = 0; }

    chart.createIndicator({ name: "COMPARE" }, true, { id: "candle_pane" });

    // Kerzen ausblenden — im Vergleichsmodus zählt nur relative Performance.
    // Das Hauptasset läuft als weisse Linie (cMain im COMPARE-Indikator).
    chart.setStyles({
      candle: { bar: {
        upColor: "rgba(0,0,0,0)", downColor: "rgba(0,0,0,0)", noChangeColor: "rgba(0,0,0,0)",
        upBorderColor: "rgba(0,0,0,0)", downBorderColor: "rgba(0,0,0,0)",
        upWickColor: "rgba(0,0,0,0)", downWickColor: "rgba(0,0,0,0)",
      }, priceMark: { last: { show: false } } },
    });
  } else {
    chart.removeIndicator("candle_pane", "COMPARE");
    window.__tvVisibleFrom = undefined;
    // Kerzen wieder einblenden (Original-Theme wiederherstellen)
    chart.setStyles(baseStyles());
  }
  updateLegend();
}

// Bei Symbol-/TF-Wechsel: alle Vergleichsdaten neu laden
async function reloadAllCompareData() {
  for (const entry of state.compareAssets) await refreshCompareData(entry);
  applyCompareIndicator();
}

const _compareSearchEl = document.getElementById("compareSearch");
if (_compareSearchEl) _compareSearchEl.addEventListener("input", e => renderCompareList(e.target.value));

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
      saveWorkspace();
      document.getElementById("tfLabel").textContent = tf.label;
      document.getElementById("tfPanel").classList.remove("open");
      renderTfList();
      loadData();
      reloadAllCompareData();
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
      saveWorkspace();
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
  saveWorkspace();
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
      saveWorkspace();
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
  chart.setPaneOptions({ id: "candle_pane", axisOptions: { name: "normal", scrollZoomEnabled: true } });
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
  const overlayConfig = {
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
  };
  // FRVP: Default-Parameter + Rechtsklick-Menü
  if (overlayName === "frvp") {
    overlayConfig.extendData = { rows: 150, valueArea: 70, width: 30 };
    overlayConfig.onRightClick = (e) => { openFrvpMenu(e.overlay, e); return true; };
  }
  const id = chart.createOverlay(overlayConfig);
  state.drawingId = Array.isArray(id) ? id[0] : id;
  renderDrawbar();
}

// ---------- FRVP-Kontextmenü ----------
function openFrvpMenu(overlay, event) {
  const menu = document.getElementById("frvpMenu");
  if (!menu) return;
  const ext = overlay.extendData || {};
  // Felder befüllen
  document.getElementById("frvpRows").value  = ext.rows      || 150;
  document.getElementById("frvpVA").value    = ext.valueArea || 70;
  document.getElementById("frvpWidth").value = ext.width     || 30;
  document.getElementById("frvpShowVAH").checked = ext.showVAH !== false;
  document.getElementById("frvpShowVAL").checked = ext.showVAL !== false;
  document.getElementById("frvpShowPOC").checked = ext.showPOC !== false;
  document.getElementById("frvpColorUp").value   = ext.colorUp   ? rgbToHex(ext.colorUp)   : "#3fb68b";
  document.getElementById("frvpColorDown").value = ext.colorDown ? rgbToHex(ext.colorDown)  : "#d05e5e";
  document.getElementById("frvpColorVAH").value  = ext.colorVAH  ? rgbToHex(ext.colorVAH)  : "#e8b64c";
  document.getElementById("frvpColorVAL").value  = ext.colorVAL  ? rgbToHex(ext.colorVAL)  : "#e8b64c";
  document.getElementById("frvpColorPOC").value  = ext.colorPOC  ? rgbToHex(ext.colorPOC)  : "#ffffff";

  const x = (event?.pointerCoordinate?.x) || (event?.x) || 200;
  const y = (event?.pointerCoordinate?.y) || (event?.y) || 200;
  menu.style.left = Math.min(x, window.innerWidth  - 260) + "px";
  menu.style.top  = Math.min(y, window.innerHeight - 380) + "px";
  menu.classList.remove("hidden");

  document.getElementById("frvpApply").onclick = () => {
    const newExt = {
      rows:      parseInt(document.getElementById("frvpRows").value, 10)  || 150,
      valueArea: parseInt(document.getElementById("frvpVA").value, 10)    || 70,
      width:     parseInt(document.getElementById("frvpWidth").value, 10) || 30,
      showVAH:   document.getElementById("frvpShowVAH").checked,
      showVAL:   document.getElementById("frvpShowVAL").checked,
      showPOC:   document.getElementById("frvpShowPOC").checked,
      colorUp:   hexToRgba(document.getElementById("frvpColorUp").value,   55),
      colorDown: hexToRgba(document.getElementById("frvpColorDown").value, 55),
      colorVAH:  document.getElementById("frvpColorVAH").value,
      colorVAL:  document.getElementById("frvpColorVAL").value,
      colorPOC:  document.getElementById("frvpColorPOC").value,
    };
    chart.overrideOverlay({ id: overlay.id, extendData: newExt });
    menu.classList.add("hidden");
  };
  document.getElementById("frvpDelete").onclick = () => {
    chart.removeOverlay(overlay.id);
    menu.classList.add("hidden");
  };
}

function rgbToHex(color) {
  if (!color) return "#888888";
  if (color.startsWith("#")) return color.slice(0, 7);
  const m = color.match(/[\d.]+/g);
  if (!m || m.length < 3) return "#888888";
  return "#" + [0, 1, 2].map(i => Math.round(parseFloat(m[i])).toString(16).padStart(2, "0")).join("");
}
// Menü schliessen bei Klick ausserhalb
document.addEventListener("click", (e) => {
  const menu = document.getElementById("frvpMenu");
  if (menu && !menu.contains(e.target) && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
  }
});

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

// ---------- Workspace speichern ----------
function saveWorkspace() {
  try {
    localStorage.setItem("tv_workspace", JSON.stringify({
      symbol: state.symbol,
      timeframeId: state.timeframe.id,
      active: [...state.active],
      chartType: state.chartType,
      legendCollapsed: state.legendCollapsed,
    }));
  } catch (e) { /* localStorage voll oder blockiert — ignorieren */ }
}

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

})();