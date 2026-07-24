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
  _mobileInit:     _ws?._mobileInit || false,   // Mobile-Voreinstellung schon angewandt?
  drawStyle:   _ws?.drawStyle || { color: "#e8b64c", lineStyle: "solid", opacity: 100, width: 1 },
  compareAssets: [],   // [{ id, label, color, data: [{timestamp, close}] }]

  // Watchlist
  // Mehrere Watchlisten. Migration: ein altes flaches Array wird zur
  // Liste "Standard", damit bestehende Workspaces nicht verlorengehen.
  watchlists: _ws?.watchlists
    || (Array.isArray(_ws?.watchlist) ? { Standard: [..._ws.watchlist] } : { Standard: [...CONFIG.WATCHLIST_DEFAULT] }),
  activeWatchlist: _ws?.activeWatchlist || "Standard",
  watchlistOpen:  _ws?.watchlistOpen !== false,
  wlPrices:       {},   // { SYMBOL: { price, changePct } }
  wlCloseStream:  null,

  // Theme: "dark" | "light"
  theme: _ws?.theme || "dark",

  // Grid Bot
  currentLayout: _ws?.currentLayout || null,   // Name des offenen Layouts
  candleStreamOk: false,
  wlStreamOk: false,
  gbOpen: _ws?.gbOpen || false,
  gbCollapsed: _ws?.gbCollapsed || false,
  gbProfile: _ws?.gbProfile || "Moderat",
  gbHeight: _ws?.gbHeight || 250,
  gbActiveTier: _ws?.gbActiveTier || null,
  gbBandIds: [],
  gbResult: null,
  drawings: _ws?.drawings || [],   // gezeichnete Overlays, für Layouts
  // Eigene Reihenfolge der Indikator-Liste (Punkt 6, Drag & Drop).
  // Leer = Config-Reihenfolge. Neue Indikatoren, die noch nicht in der
  // gespeicherten Reihenfolge stehen, werden hinten angehängt.
  indOrder: _ws?.indOrder || [],
  // Zuletzt verwendete FRVP-Einstellungen — Vorlage für neue Profile (Punkt 4)
  frvpDefaults: _ws?.frvpDefaults || null,
  gbCapital: _ws?.gbCapital ?? 8000,
  gbTiers: _ws?.gbTiers || JSON.parse(JSON.stringify(GridBot.DEFAULT_TIERS)),
  gbThresholds: _ws?.gbThresholds || { ...GridBot.DEFAULT_THRESHOLDS },

  // Pattern-Erkennung
  patternOverlayIds: [],
  patternOpts: _ws?.patternOpts || {},   // leer = Engine-Defaults (streng)

  // Smart Money Concepts (FVG / Order Blocks)
  smcOverlayIds: [],
  smcOpts: _ws?.smcOpts || {},

  // Chart-Darstellung (Kerzen-/Linienfarben)
  chartStyle: _ws?.chartStyle || {
    // Preis-Markierungen: aktueller Preis + lokale Hochs/Tiefs
    lastLine:    true,
    lastText:    true,
    lastSize:    12,
    hiLoShow:    true,
    hiLoSize:    12,
    upColor:     "#3fb68b",
    downColor:   "#d05e5e",
    hollow:      false,
    lineColor:   "#e8b64c",
    lineWidth:   2,
    areaFill:    true,
    fillOpacity: 15,
  },

  // Lazy Loading
  loadingOlder:   false,
  historyDone:    false,  // true wenn Binance keine älteren Daten mehr liefert

};

// Einmalige Mobile-Voreinstellung. Läuft auch bei bereits gespeichertem
// Workspace genau einmal — sonst greift sie bei bestehenden Nutzern nie.
// Danach entscheidet der Nutzer, die Wahl bleibt erhalten.
if (window.matchMedia("(pointer: coarse)").matches && !_ws?._mobileInit) {
  state.watchlistOpen  = false;   // spart die volle Chartbreite
  state.legendCollapsed = true;   // fünf Indikatorzeilen decken sonst den Chart zu
  state._mobileInit = true;
}

// state.watchlist zeigt immer auf die gerade aktive Liste. So funktioniert
// der gesamte bestehende Code weiter, ohne dass jeder Zugriff angefasst
// werden muss.
// Bestehende Workspaces kennen die Preis-Markierungs-Felder nicht
state.chartStyle = {
  lastLine: true, lastText: true, lastSize: 12, hiLoShow: true, hiLoSize: 12,
  ...state.chartStyle,
};

Object.defineProperty(state, "watchlist", {
  get() { return this.watchlists[this.activeWatchlist] || []; },
  set(v) { this.watchlists[this.activeWatchlist] = v; },
});

// Debug-Zugriff aus der Browser-Konsole: window.__tvState
window.__tvState = state;

// ---------- Build-Abgleich ----------
// Sagt beim Start klar, welche Dateien tatsächlich laufen. Liefert der
// Browser eine alte style.css aus dem Cache, fällt das hier sofort auf,
// statt dass wir über nicht wirkende Regeln rätseln.
const TV_BUILD = "m4";
window.__tvBuild = TV_BUILD;
(function checkBuild() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--tv-build").trim().replace(/["']/g, "");
  window.__tvCssBuild = raw || "(keine)";
  if (raw === TV_BUILD) {
    console.log(`%c[TreydView] Build ${TV_BUILD} — CSS und JS aktuell.`,
                "color:#3fb68b;font-weight:600");
  } else {
    console.warn(`[TreydView] VERSIONSKONFLIKT — JS ist "${TV_BUILD}", ` +
      `geladene CSS ist "${raw || "unbekannt"}". Der Browser liefert eine ` +
      `alte style.css aus dem Cache. Seite mit geleertem Cache neu laden.`);
  }
})();

// Debug-Modus: in der Konsole `__tvDebug = true` setzen, dann zeigen alle
// verschluckten Fehler ihre Ursache. Beispiel: AVWAP lädt nicht → Konsole
// zeigt warum statt still leer zu bleiben.
window.__tvDebug = false;
function quiet(fn, label) {
  try { return fn(); }
  catch (e) { if (window.__tvDebug) console.warn("[TV]", label || "?", e); }
}

// Bybit-Debug: __tvTestBybit("AEROUSDT","D") in Konsole eingeben
window.__tvTestBybit = async (symbol, interval) => {
  const url = `${CONFIG.BYBIT_REST}/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=5`;
  console.log("Bybit URL:", url);
  const res = await fetch(url);
  const json = await res.json();
  console.log("Bybit response:", JSON.stringify(json).slice(0,500));
  return json;
};

// Bybit vollständiger Fetch-Test: __tvTestBybitFull("AEROUSDT","D")
window.__tvTestBybitFull = async (symbol, interval) => {
  try {
    const candles = await DataLayer.fetchBybitKlines(symbol, interval, 500);
    console.log("Bybit candles count:", candles.length);
    console.log("First:", candles[0]);
    console.log("Last:", candles.at(-1));
    return candles;
  } catch(e) { console.error("Bybit error:", e); }
};

// Farbpalette für Vergleichs-Assets
// 15 gut unterscheidbare Farben. Reihenfolge so gewählt, dass benachbarte
// Einträge nie ähnliche Töne bekommen.
const COMPARE_COLORS = [
  "#5aa9e6", "#e8b64c", "#c792ea", "#3fb68b", "#ff6d00",
  "#ff5c8a", "#4dd0e1", "#aed581", "#ba68c8", "#ffb74d",
  "#7986cb", "#f06292", "#4db6ac", "#dce775", "#9575cd",
];

// ---------- Chart-Init ----------
const chartEl = document.getElementById("mainChart");
const chart = klinecharts.init("mainChart");

// Bridge: FRVP-Overlay (overlays.js) braucht Zugriff auf die Candle-Daten
window.__tvGetDataList = () => chart.getDataList();

// ---------- Anchored VWAP Bridge ----------
// Overlay setzt den Anker-Timestamp; hier aktivieren wir den AVWAP-Indikator
// mit diesem Timestamp als calcParam. Mehrere AVWAPs gleichzeitig möglich —
// jede Instanz bekommt einen eigenen Gruppen-Key über overrideIndicator.
const _avwapInstances = {};   // overlayId -> calcParams[0] (timestamp)

window.__tvAnchorVwap = (timestamp, overlayId) => {
  _avwapInstances[overlayId] = timestamp;
  // Alle aktiven AVWAP-Instanzen: ersten setzen, weitere via overrideIndicator.
  // KLC erlaubt pro Pane mehrere Instanzen desselben Indikators nicht direkt —
  // wir steuern deshalb EINE Instanz pro Anker via calcParams-Array mit allen Timestamps.
  // Einfachste robuste Variante: pro Anker einen separaten Indikator-Aufruf,
  // KLC erkennt verschiedene calcParams als verschiedene Instanzen.
  try {
    chart.createIndicator(
      { name: "AVWAP", calcParams: [timestamp],
        extendData: { plots: { avwap: { color: "#c792ea", width: 2 } } } },
      true,
      { id: "candle_pane" }
    );
  } catch (e) {
    // Fallback: Indikator existiert bereits, calcParams überschreiben
    try { chart.overrideIndicator({ name: "AVWAP", calcParams: [timestamp] }, "candle_pane"); } catch (_) {}
  }
  scheduleTagDraw();
};

window.__tvRemoveAnchorVwap = (overlayId) => {
  delete _avwapInstances[overlayId];
  // Wenn keine Instanzen mehr: Indikator entfernen
  if (Object.keys(_avwapInstances).length === 0) {
    try { chart.removeIndicator("candle_pane", "AVWAP"); } catch (e) {}
  }
  scheduleTagDraw();
};

function baseStyles() {
  const cs = state.chartStyle;
  return {
    grid: { 
      horizontal: { color: T.grid, style: "dashed", dashedValue: [2, 2] }, 
      vertical: { color: T.grid, style: "dashed", dashedValue: [2, 2] } 
    },
    candle: {
      type: state.chartType,
      bar: {
        // "hollow" = nur Umriss: Füllfarbe transparent, Rahmen in Trendfarbe
        upColor:       cs.hollow ? "rgba(0,0,0,0)" : cs.upColor,
        downColor:     cs.hollow ? "rgba(0,0,0,0)" : cs.downColor,
        noChangeColor: T.text,
        upBorderColor: cs.upColor,   downBorderColor: cs.downColor,
        upWickColor:   cs.upColor,   downWickColor:   cs.downColor,
      },
      area: {
        lineColor: cs.lineColor,
        lineSize:  cs.lineWidth,
        backgroundColor: cs.areaFill
          ? [
              { offset: 0, color: hexToRgba(cs.lineColor, cs.fillOpacity) },
              { offset: 1, color: hexToRgba(cs.lineColor, 1) },
            ]
          : [
              { offset: 0, color: "rgba(0,0,0,0)" },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ],
      },
      priceMark: {
        // Aktueller Preis. Die Linienfarbe folgt bei KLineCharts zwingend
        // up/downColor — separat setzbar ist sie nicht.
        last: {
          show: cs.lastLine !== false || cs.lastText !== false,
          upColor: cs.upColor, downColor: cs.downColor,
          line: { show: cs.lastLine !== false, style: "dashed", dashedValue: [4, 4], size: 1 },
          // Text zeichnet der eigene Tag-Renderer (immer zuoberst) — KLC nur Linie
          text: { show: false },
        },
        // Lokale Hochs/Tiefs im sichtbaren Bereich
        high: { show: cs.hiLoShow !== false, textSize: cs.hiLoSize || 12,
                color: T.text, textFamily: "'IBM Plex Mono',monospace" },
        low:  { show: cs.hiLoShow !== false, textSize: cs.hiLoSize || 12,
                color: T.text, textFamily: "'IBM Plex Mono',monospace" },
      },
      tooltip: { showRule: "none" },
    },
    indicator: {
      // Der Balken übernimmt je Linie deren Farbe, der Text ist global.
      // Dunkel gewinnt klar: gemessen an allen 54 Linienfarben scheitern
      // mit weissem Text 49, mit dunklem nur 8 — und die 8 wurden in
      // config.js aufgehellt. Money Noodles weisse Linie war der Auslöser.
      // KLC-eigene Indikator-Tags IMMER aus — TreydView zeichnet sie selbst
      // (eigenes Canvas, echt pro Linie schaltbar; KLC kann nur global).
      lastValueMark: { show: false },
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
  const sv  = Settings.get(ind.key);
  const inp = sv.inputs;
  const create = { name: ind.name, extendData: { plots: sv.plots } };
  switch (ind.key) {
    case "sma":      create.calcParams = [inp.p1||20, inp.p2||50, inp.p3||100, inp.p4||200]; break;
    case "ema":      create.calcParams = [inp.p1||21, inp.p2||50, inp.p3||100, inp.p4||200]; break;
    case "boll":     create.calcParams = [inp.period||20, inp.stddev||2.0, inp.maType||"SMA", inp.offset||0]; break;
    case "gc":       create.calcParams = [inp.period||144, inp.mult||1.414, inp.poles||4]; break;
    case "hull":     create.calcParams = [inp.mode||"HMA", inp.period||55, inp.lengthMult||1.0]; break;
    case "rvwap":    create.calcParams = [inp.days||365]; break;
    case "mnoodle":  create.calcParams = [inp.fastPeriod||12, inp.medPeriod||21, inp.slowPeriod||35, inp.atrLength||20, inp.bandMult||0.0125]; break;
    case "bmsb":     create.calcParams = [20, 21]; break;
    case "myrsi":    create.calcParams = [inp.period||14, inp.maType||"None", inp.maLength||14, inp.bbMult||2.0]; break;
    case "stochrsi": create.calcParams = [inp.smoothK||3, inp.smoothD||3, inp.lengthRSI||14, inp.lengthStoch||14]; break;
    case "myvol":    create.calcParams = [inp.ma1||5, inp.ma2||10, inp.ma3||20]; break;
    case "macd":     create.calcParams = [inp.fast||12, inp.slow||26, inp.signal||9, inp.oscType||"EMA", inp.sigType||"EMA"]; break;
    case "atr":      create.calcParams = [inp.period||14, inp.smoothing||"RMA"]; break;
    default:         if (ind.calcParams) create.calcParams = ind.calcParams;
  }

  // Preis-Tag an der Y-Achse (Punkt 1): KLineCharts liest lastValueMark
  // ausschliesslich aus den GLOBALEN Styles (im Bundle verifiziert:
  // chartStore.getStyles().indicator.lastValueMark). Ein styles.lastValueMark
  // am einzelnen Indikator ist wirkungslos. Steuerung deshalb global über
  // applyIndicatorTags(), das nach jedem Settings-Apply aufgerufen wird.
  return create;
}


// ---------- Indikatoren anwenden ----------
function applyIndicator(ind) {
  // Im Vergleichsmodus keine Indikatoren auf den Chart — state.active wird
  // vom Aufrufer (Checkbox) gesetzt, gezeichnet wird erst beim Verlassen.
  if (state.compareAssets && state.compareAssets.length > 0) return;
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
  scheduleTagDraw();
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
  const allData = chart.getDataList();
  if (!allData || allData.length < 2) { state.vrvpMeta = null; return; }
  const sv = Settings.get("vrvp");
  const rows = sv.inputs.rows || 500, vaPct = sv.inputs.valueArea || 70;

  // Nur sichtbare Kerzen aggregieren (reaktiv bei Scroll/Zoom)
  let fromIdx = 0, toIdx = allData.length - 1;
  try {
    const vr = chart.getVisibleRange();
    if (vr) {
      fromIdx = Math.max(0, vr.realFrom != null ? vr.realFrom : vr.from);
      toIdx   = Math.min(allData.length - 1, vr.realTo != null ? vr.realTo : vr.to);
    }
  } catch (e) {}
  const data = allData.slice(fromIdx, toIdx + 1);
  if (data.length < 2) { state.vrvpMeta = null; return; }

  const prices = data.flatMap(d => [d.high, d.low]);
  // Schleife statt Math.min/max(...prices): Spread sprengt den Stack
  // ab ~130'000 Argumenten (= ~65'000 Kerzen nach Lazy Loading).
  let pMin = Infinity, pMax = -Infinity;
  for (const d of data) {
    if (d.high > pMax) pMax = d.high;
    if (d.low  < pMin) pMin = d.low;
  }
  const rowH = (pMax - pMin) / rows;
  if (rowH === 0) { state.vrvpMeta = null; return; }
  const upVol = new Float64Array(rows), downVol = new Float64Array(rows);
  for (const d of data) {
    const vol = d.volume || 0, isUp = d.close >= d.open;
    const rLow  = Math.max(0, Math.floor((d.low  - pMin) / rowH));
    const rHigh = Math.min(rows - 1, Math.floor((d.high - pMin) / rowH));
    const n = rHigh - rLow + 1;
    for (let r = rLow; r <= rHigh; r++) {
      if (isUp) upVol[r] += vol / n; else downVol[r] += vol / n;
    }
  }
  const totalVol = upVol.map((u, i) => u + downVol[i]);
  // Schleife statt indexOf(Math.max(...)) und filter(...).map(...)
  let pocRow = 0, maxVol = 0;
  for (let r = 0; r < rows; r++) {
    if (totalVol[r] > totalVol[pocRow]) pocRow = r;
    if (totalVol[r] > maxVol) maxVol = totalVol[r];
  }
  state.vrvpMeta = {
    rows, pMin, pMax, rowH, upVol, downVol, totalVol,
    maxVol,
    pocPrice: pMin + (pocRow + 0.5) * rowH,
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
  const rightGap = 96;
  const rightEdge = w - rightGap;
  const maxBarW = w * widthPct;

  for (let r = 0; r < rows; r++) {
    const pb = pMin + r * rowH, pt = pb + rowH;
    const cb = chart.convertToPixel({ value: pb }, { paneId: "candle_pane", absolute: true });
    const ct = chart.convertToPixel({ value: pt }, { paneId: "candle_pane", absolute: true });
    if (!cb || !ct || cb.y == null || ct.y == null) continue;
    const yTop = Math.min(cb.y, ct.y), yH = Math.max(1, Math.abs(ct.y - cb.y));
    const tot = totalVol[r];
    if (tot === 0) continue;
    const barW = (tot / maxVol) * maxBarW;
    const upW  = (upVol[r]   / maxVol) * maxBarW;
    const downW = (downVol[r] / maxVol) * maxBarW;
    // Down-Balken (von rechts)
    ctx.fillStyle = (sv.plots.down && sv.plots.down.visible !== false) ? sv.plots.down.color : "rgba(0,0,0,0)";
    ctx.fillRect(rightEdge - downW, yTop, downW, yH);
    // Up-Balken (links daneben)
    ctx.fillStyle = (sv.plots.up && sv.plots.up.visible !== false) ? sv.plots.up.color : "rgba(0,0,0,0)";
    ctx.fillRect(rightEdge - barW, yTop, upW, yH);
  }
  ctx.restore();
}

// VRVP/Compare bei Zoom/Scroll neu zeichnen.
// Koalesziert: onVisibleRangeChange feuert beim Scrollen viele Male pro
// Frame. Ohne das Flag stapeln sich mehrere identische rAF-Callbacks und
// zeichnen dasselbe Bild mehrfach.
let _redrawQueued = false;
chart.subscribeAction("onVisibleRangeChange", () => {
  if (_redrawQueued) return;
  _redrawQueued = true;
  requestAnimationFrame(() => {
    _redrawQueued = false;
    // Im Vergleichsmodus kein VRVP — auch nicht wenn state.active es enthält
    if (state.active.has("vrvp") && state.compareAssets.length === 0) {
      try { drawVrvp(); } catch (e) {}
    }
    if (state.compareAssets.length > 0) { try { drawCompare(); } catch (e) {} }
    try { drawIndicatorTags(); } catch (e) {}
  });
});

// ---------- Daten laden ----------
// Sequenznummer gegen veraltete Antworten: Wechselt der User schnell
// BTC → ETH → SOL, laufen drei fetches parallel. Ohne die Prüfung gewinnt
// die LANGSAMSTE Antwort und der Chart zeigt ein anderes Asset als das Label.
let _loadSeq = 0;

async function loadData() {
  const seq = ++_loadSeq;
  if (state.closeStream) { state.closeStream(); state.closeStream = null; }
  setLive("offline", "lädt …");
  setStatus(`Lade ${state.symbol.label} (${state.timeframe.label}) …`);
  let candles;
  try {
    if (state.symbol.type === "binance") {
      candles = await DataLayer.fetchBinanceKlines(state.symbol.id, state.timeframe.binanceInterval, CONFIG.CANDLE_LIMIT);
    } else if (state.symbol.type === "kraken") {
      candles = await DataLayer.fetchKrakenKlines(state.symbol.krakenPair, state.timeframe.krakenInterval, CONFIG.CANDLE_LIMIT);
    } else if (state.symbol.type === "coinbase") {
      candles = await DataLayer.fetchCoinbaseKlines(state.symbol.coinbaseProduct, state.timeframe.coinbaseInterval, CONFIG.CANDLE_LIMIT);
    } else if (state.symbol.type === "bybit") {
      candles = await DataLayer.fetchBybitKlines(state.symbol.bybitSymbol, state.timeframe.bybitInterval, CONFIG.CANDLE_LIMIT);
      if (!candles || candles.length === 0) throw new Error(`Bybit: keine Kerzen für ${state.symbol.bybitSymbol} / ${state.timeframe.bybitInterval}`);
    } else {
      candles = await DataLayer.fetchGoldHistory();
    }
  } catch (err) {
    if (seq !== _loadSeq) return;   // inzwischen wurde neu geladen
    // HTTP 500 heisst: der Worker ist erreichbar und wirft einen Fehler.
    // Die URL zu prüfen führt dann in die Irre — sie stimmt ja.
    const isWorker = state.symbol.type === "worker";
    // Binance HTTP 400 = "Invalid symbol": das Paar existiert dort nicht.
    // Ohne diesen Hinweis sieht es wie ein Netzwerkfehler aus (AERO-Fall).
    if (!isWorker && /HTTP 4\d\d/.test(err.message)) {
      setStatus(`Fehler: Binance kennt ${state.symbol.id} nicht — Paar dort nicht (mehr) gelistet.`);
      setLive("offline", "Fehler");
      return;
    }
    const hint = !isWorker ? ""
      : /HTTP 5\d\d/.test(err.message) ? " — der Worker antwortet, wirft aber einen Fehler. Cloudflare-Logs prüfen (nicht die URL)."
      : /HTTP 4\d\d/.test(err.message) ? " — Worker-Route nicht gefunden. Pfad in WORKER_BASE_URL prüfen."
      : " — Worker nicht erreichbar. WORKER_BASE_URL und CORS prüfen.";
    setStatus(`Fehler: ${err.message}${hint}`);
    setLive("offline", "Fehler");
    return;
  }
  // Antwort gehört zu einem inzwischen überholten Wechsel → verwerfen.
  if (seq !== _loadSeq) return;
  chart.applyNewData(candles);
  scheduleTagDraw();
  // 2.9: Nach einem Asset-Wechsel liegen die Preisniveaus ganz woanders
  // (BTC ~60'000, ETH ~2'500). Ohne Auto-Skalierung müsste man die
  // Y-Achse erst suchen. autoScaleY() skaliert neu und entsperrt danach
  // die Achse fürs vertikale Draggen.
  setTimeout(autoScaleY, 80);
  updatePriceHeader(candles.at(-1), candles.at(-2));
  updateLegend();
  setStatus(`${candles.length} Candles · ${state.symbol.label} · ${state.timeframe.label}`);
  if (state.active.has("vrvp")) setTimeout(drawVrvp, 120);

  // Zyklus-Ampel im Hintergrund befüllen — ohne den Bot-Panel zu öffnen.
  // 800ms Verzögerung damit der Chart-Render und die Exchange-Streams
  // zuerst starten, bevor ein zusätzlicher Derivate-Fetch losgeht.
  // Bei Symbolwechsel wird nur aktualisiert wenn der Bot eh offen ist.
  if (!state.gbResult || state.gbOpen) {
    setTimeout(() => quiet(() => gbRefresh(false), "cycle bar init"), 800);
  }

  if (state.symbol.type === "kraken" || state.symbol.type === "coinbase" || state.symbol.type === "bybit") {
    // Kraken/Coinbase/Bybit: kein WebSocket-Kerzenstream integriert —
    // Anzeige ohne Live-Update.
    const lbl = state.symbol.type === "kraken" ? "Kraken" : state.symbol.type === "coinbase" ? "Coinbase" : "Bybit";
    setLive("offline", lbl);
  } else if (state.symbol.type === "binance") {
    state.closeStream = DataLayer.openBinanceStream(
      state.symbol.id, state.timeframe.binanceInterval,
      (candle) => {
        scheduleTagDraw();
        chart.updateData(candle);
        updatePriceHeader(candle, chart.getDataList().at(-2));
        updateLegend();
        if (state.active.has("vrvp") && state.compareAssets.length === 0) requestAnimationFrame(drawVrvp);
        if (state.compareAssets.length > 0) requestAnimationFrame(() => { try { drawCompare(); } catch (e) {} });
      },
      (s) => {
        state.candleStreamOk = s === "live";
        // Nur auf "Reconnect" gehen, wenn BEIDE Streams weg sind.
        // Der MiniTicker-Stream liefert weiterhin Preise, also ist der
        // Chart nicht wirklich offline — nur der Kerzen-Update fehlt kurz.
        if (state.candleStreamOk || state.wlStreamOk) {
          setLive("live", "Live");
        } else {
          setLive("offline", "Reconnect …");
        }
      }
    );
  } else {
    setLive("offline", "Daily");
  }
}

// ---------- Dropdowns ----------
// Auf Mobile werden alle .dd-panel per CSS zu Bottom-Sheets. Damit klar ist,
// dass ein Sheet offen ist, blenden wir denselben Abdunkler ein, den auch
// das Zeichen-Sheet nutzt.
function syncSheetBackdrop() {
  const bd = document.getElementById("drawSheetBackdrop");
  if (!bd) return;
  const isMobile = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  const anyOpen  = isMobile && (
       document.querySelector(".dd-panel.open")
    || !document.getElementById("drawSheet")?.classList.contains("hidden")
  );
  bd.classList.toggle("hidden", !anyOpen);
}

function initDropdowns() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
      syncSheetBackdrop();
    }
  });
  ["assetDropdown", "compareDropdown", "tfDropdown", "typeDropdown", "indDropdown", "layoutDropdown", "patternDropdown", "smcDropdown"].forEach(id => {
    const dd = document.getElementById(id);
    if (!dd) return;
    const trigger = dd.querySelector(".dd-trigger, .action-btn");
    const panel = dd.querySelector(".dd-panel");
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = panel.classList.contains("open");
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
      if (!wasOpen) panel.classList.add("open");
      syncSheetBackdrop();
      if (id === "assetDropdown" && !wasOpen) {
        setTimeout(() => document.getElementById("assetSearch").focus(), 30);
      }
      if (id === "compareDropdown" && !wasOpen) {
        renderCompareActive();
        setTimeout(() => document.getElementById("compareSearch").focus(), 30);
      }
      if (id === "layoutDropdown" && !wasOpen) renderLayoutList();
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
    item.addEventListener("click", () => switchSymbol(sym));
    list.appendChild(item);
  });
  if (items.length === 0) list.innerHTML = '<div class="dd-empty">Kein Symbol gefunden</div>';
}
document.getElementById("assetSearch").addEventListener("input", e => renderAssetList(e.target.value));

// ---------- Multi-Exchange Symbol-Loader ----------
// Lädt Paare von Binance, Coinbase, Kraken und Bybit. Filter-Regeln:
// - Quote: nur USDT, USDC, USD, BTC
// - Status: nur aktiv gehandelt
// - Volumen: 24h-Äquivalent > 5 Mio USD
// - Defaults: CONFIG.DEFAULT_SYMBOLS immer enthalten, nie doppelt
// - Label: "BASE/QUOTE (Exchange)"
const ALLOWED_QUOTES = new Set(["USDT", "USDC", "USD", "BTC"]);

async function loadAllExchangeSymbols() {
  const defaultIds = new Set(CONFIG.DEFAULT_SYMBOLS.map(s => s.id));
  const seen = new Set(CONFIG.DEFAULT_SYMBOLS.map(s => s.id));
  const result = [...CONFIG.DEFAULT_SYMBOLS];

  // --- Binance: alle USDT/USDC/BTC/USD Pairs (Status TRADING) ---
  // Kein Volumen-Filter: Binance listet nur aktive Pairs als TRADING,
  // und RENDER/USDT etc. können in ruhigen Phasen < 1M haben obwohl liquide.
  try {
    const infoRes = await fetch(`${CONFIG.BINANCE_REST}/exchangeInfo`);
    if (infoRes.ok) {
      const info = await infoRes.json();
      info.symbols
        .filter(s => s.status === "TRADING" && ALLOWED_QUOTES.has(s.quoteAsset))
        .forEach(s => {
          if (seen.has(s.symbol)) return;
          seen.add(s.symbol);
          result.push({ id: s.symbol, label: `${s.baseAsset}/${s.quoteAsset} (Binance)`, type: "binance" });
        });
    }
  } catch (e) {}

  // --- Coinbase: alle aktiven Pairs ---
  try {
    const res = await fetch(`${CONFIG.COINBASE_REST}/products`);
    if (res.ok) {
      const arr = await res.json();
      arr.filter(p => p.status === "online" && ALLOWED_QUOTES.has(p.quote_currency))
        .forEach(p => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          result.push({ id: p.id, label: `${p.base_currency}/${p.quote_currency} (Coinbase)`, type: "coinbase", coinbaseProduct: p.id });
        });
    }
  } catch (e) {}

  // --- Kraken: alle online Pairs ---
  try {
    const res = await fetch(`${CONFIG.KRAKEN_REST}/AssetPairs`);
    if (res.ok) {
      const json = await res.json();
      if (!json.error?.length) {
        Object.entries(json.result || {}).forEach(([key, p]) => {
          if (p.status !== "online") return;
          const q = (p.quote || "").replace(/^Z/, "").replace(/^X/, "");
          if (!ALLOWED_QUOTES.has(q)) return;
          const pairId = `${key}_KR`;
          if (seen.has(pairId)) return;
          seen.add(pairId);
          result.push({ id: pairId, label: `${p.wsname || key} (Kraken)`, type: "kraken", krakenPair: key });
        });
      }
    }
  } catch (e) {}

  // --- Bybit: Spot-Pairs mit Volumen-Filter (viele Trash-Tokens) ---
  try {
    const res = await fetch(`${CONFIG.BYBIT_REST}/v5/market/tickers?category=spot`);
    if (res.ok) {
      const json = await res.json();
      if (json.retCode === 0) {
        const BYBIT_VOL_MIN = 1_000_000;   // Turnover in USD
        (json.result?.list || []).forEach(t => {
          const sym = t.symbol;
          const quote = ["USDT","USDC","BTC","USD"].find(q => sym.endsWith(q));
          if (!quote) return;
          const base = sym.slice(0, sym.length - quote.length);
          const pairId = `${sym}_BY`;
          if (seen.has(pairId)) return;
          const vol = parseFloat(t.turnover24h) || 0;
          if (!defaultIds.has(pairId) && vol < BYBIT_VOL_MIN) return;
          seen.add(pairId);
          result.push({ id: pairId, label: `${base}/${quote} (Bybit)`, type: "bybit", bybitSymbol: sym });
        });
      }
    }
  } catch (e) {}

  state.allSymbols = result;
  renderAssetList();
  renderCompareList();
}

async function loadBinanceSymbols() {
  return loadAllExchangeSymbols();
}

// ---------- Multi-Asset-Vergleich ----------
function renderCompareList(filter = "") {
  const list = document.getElementById("compareList");
  if (!list) return;
  list.innerHTML = "";
  const f = filter.toUpperCase().trim();

  // Quote-Währung des aktiven Symbols ermitteln (aus Label: "BTC/USDT (Binance)" → "USDT")
  const activeQuote = (["USDT","USDC","USD","BTC"]
    .find(q => state.symbol.label.includes("/" + q)) || "").toUpperCase();

  const items = state.allSymbols.filter(s => {
    if (s.type === "worker") return false;   // Gold nie vergleichbar
    if (s.id === state.symbol.id) return false;
    if (state.compareAssets.some(c => c.id === s.id)) return false;
    // Gleiche Quote-Währung wie aktives Symbol
    if (activeQuote && !s.label.includes("/" + activeQuote)) return false;
    if (f) return s.id.toUpperCase().includes(f) || s.label.toUpperCase().includes(f);
    return true;
  });
  items.slice(0, 80).forEach(sym => {
    const item = document.createElement("div");
    item.className = "dd-item";
    item.textContent = sym.label;
    item.addEventListener("click", () => addCompareAsset(sym));
    list.appendChild(item);
  });
  if (items.length === 0) list.innerHTML = '<div class="dd-empty">Kein Symbol mit gleicher Quote-Währung</div>';
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
    chip.className = "compare-chip" + (a.hidden ? " hidden-asset" : "");
    const eye = a.hidden
      ? `<path d="M2 2l20 20M9.9 5.1A9.9 9.9 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a9.9 9.9 0 0 0 4.2-.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>`;
    chip.innerHTML = `<span class="cc-dot" style="background:${a.color}"></span>`
      + `<span class="cc-label">${a.label}</span>`
      + `<button class="cc-eye" title="${a.hidden ? "Einblenden" : "Ausblenden"}"><svg viewBox="0 0 24 24" width="13" height="13">${eye}</svg></button>`
      + `<button class="cc-remove" title="Entfernen">✕</button>`;
    // stopPropagation: sonst schliesst der globale Click-Handler das
    // Dropdown und man kann nicht mehrere Assets hintereinander entfernen.
    chip.querySelector(".cc-eye").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCompareAsset(a.id);
    });
    chip.querySelector(".cc-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      removeCompareAsset(a.id);
    });
    box.appendChild(chip);
  });
}

async function addCompareAsset(sym) {
  if (state.compareAssets.length >= COMPARE_COLORS.length) {
    setStatus(`Maximal ${COMPARE_COLORS.length} Vergleichs-Assets`);
    return;
  }
  const color = COMPARE_COLORS[state.compareAssets.length];
  const entry = { id: sym.id, label: sym.label, color, data: [], hidden: false };
  state.compareAssets.push(entry);
  renderCompareActive();
  renderCompareList(document.getElementById("compareSearch")?.value || "");
  await refreshCompareData(entry);
  applyCompareIndicator();
}

function toggleCompareAsset(id) {
  const a = state.compareAssets.find(c => c.id === id);
  if (!a) return;
  a.hidden = !a.hidden;
  window.__tvCompareAssets = state.compareAssets;
  renderCompareActive();
  try { drawCompare(); } catch (e) {}
  updateLegend();
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
    let candles;
    const tf = state.timeframe;
    if (entry.type === "coinbase") {
      candles = await DataLayer.fetchCoinbaseKlines(entry.coinbaseProduct, tf.coinbaseInterval || 86400, CONFIG.CANDLE_LIMIT);
    } else if (entry.type === "kraken") {
      candles = await DataLayer.fetchKrakenKlines(entry.krakenPair, tf.krakenInterval || "1440", CONFIG.CANDLE_LIMIT);
    } else if (entry.type === "bybit") {
      candles = await DataLayer.fetchBybitKlines(entry.bybitSymbol, tf.bybitInterval || "D", CONFIG.CANDLE_LIMIT);
    } else {
      candles = await DataLayer.fetchBinanceKlines(entry.id, tf.binanceInterval, CONFIG.CANDLE_LIMIT);
    }
    entry.data = candles.map(c => ({ timestamp: c.timestamp, close: c.close }));
    window.__tvCompareAssets = state.compareAssets;
  } catch (e) {
    setStatus(`Vergleichsdaten ${entry.label} fehlgeschlagen`);
  }
}

// ---------- Compare: Canvas-basierter Relative-Performance-Modus ----------
// Zeichnet alle Linien (Hauptasset + Vergleiche) selbst auf einem Canvas.
// Eigene Y-Achse in %, reaktiv bei Scroll/Zoom. Keine KLC-Indikator-Abhängigkeit.

let _compareCanvas = null;

function ensureCompareCanvas() {
  if (_compareCanvas) return _compareCanvas;
  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:11;";
  chartEl.style.position = "relative";
  chartEl.appendChild(c);
  _compareCanvas = c;
  return c;
}

function drawCompare() {
  if (state.compareAssets.length === 0) {
    if (_compareCanvas) {
      _compareCanvas.getContext("2d").clearRect(0, 0, _compareCanvas.width, _compareCanvas.height);
    }
    return;
  }

  const canvas = ensureCompareCanvas();
  const w = chartEl.clientWidth, h = chartEl.clientHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // Pane-Grenzen (nur Preis-Pane, nicht Sub-Panes)
  let paneTop = 0, paneH = h;
  try {
    const b = chart.getSize("candle_pane");
    if (b && b.height) { paneTop = b.top || 0; paneH = b.height; }
  } catch (e) {}

  const dataList = chart.getDataList();
  if (!dataList || dataList.length === 0) return;

  // Sichtbarer Bereich
  let fromIdx = 0, toIdx = dataList.length - 1;
  try {
    const vr = chart.getVisibleRange();
    if (vr) {
      fromIdx = Math.max(0, vr.realFrom != null ? vr.realFrom : vr.from);
      toIdx   = Math.min(dataList.length - 1, vr.realTo != null ? vr.realTo : vr.to);
    }
  } catch (e) {}

  // Referenzpreise: Kurs jedes Assets am ersten sichtbaren Bar (0%-Anker)
  const mainRef = dataList[fromIdx]?.close;
  if (!mainRef) return;

  const assetRefs = state.compareAssets.map(a => {
    const m = new Map((a.data || []).map(p => [p.timestamp, p.close]));
    for (let i = fromIdx; i <= toIdx; i++) {
      const v = m.get(dataList[i].timestamp);
      if (v != null) return { m, ref: v };
    }
    return { m, ref: null };
  });

  // Alle sichtbaren Prozentwerte berechnen für Autoscaling
  let pMin = Infinity, pMax = -Infinity;
  for (let i = fromIdx; i <= toIdx; i++) {
    const d = dataList[i];
    if (d.close && mainRef) {
      const pct = ((d.close - mainRef) / mainRef) * 100;
      if (pct < pMin) pMin = pct;
      if (pct > pMax) pMax = pct;
    }
    assetRefs.forEach(({ m, ref }) => {
      if (!ref) return;
      const v = m.get(d.timestamp);
      if (v != null) {
        const pct = ((v - ref) / ref) * 100;
        if (pct < pMin) pMin = pct;
        if (pct > pMax) pMax = pct;
      }
    });
  }
  if (!isFinite(pMin) || !isFinite(pMax)) return;
  const pad = Math.max(5, (pMax - pMin) * 0.05);
  pMin -= pad; pMax += pad;
  const pRange = pMax - pMin || 1;

  // Preis → Y-Pixel innerhalb des Pane
  const pctToY = (pct) => paneTop + ((pMax - pct) / pRange) * paneH;

  // Clip auf Pane
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, paneTop, w, paneH);
  ctx.clip();

  // Hauptasset-Linie (weiss)
  drawLine(ctx, dataList, fromIdx, toIdx, (d) => {
    if (!d.close || !mainRef) return null;
    return { x: null, pct: ((d.close - mainRef) / mainRef) * 100 };
  }, "#ffffff", 2, dataList, pctToY, chart);

  // Vergleichs-Linien
  state.compareAssets.forEach((asset, idx) => {
    if (asset.hidden) return;
    const { m, ref } = assetRefs[idx];
    if (!ref) return;
    drawLine(ctx, dataList, fromIdx, toIdx, (d) => {
      const v = m.get(d.timestamp);
      if (v == null) return null;
      return { pct: ((v - ref) / ref) * 100 };
    }, asset.color, 2, dataList, pctToY, chart);
  });

  // 0%-Linie
  const y0 = pctToY(0);
  ctx.strokeStyle = "rgba(143,163,184,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
  ctx.setLineDash([]);

  // Eigene Y-Achse rechts (Prozent-Beschriftung)
  const axisX = w - 4;
  ctx.fillStyle = T.text;
  ctx.font = "13px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  const steps = 6;
  for (let s = 0; s <= steps; s++) {
    const pct = pMin + (pMax - pMin) * (s / steps);
    const y = pctToY(pct);
    if (y < paneTop + 8 || y > paneTop + paneH - 8) continue;
    const label = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
    ctx.fillText(label, axisX, y + 4);
  }

  // 2.3: Kürzel + aktueller Wert am rechten Ende jeder Linie.
  // Ohne das muss man Farben raten, sobald mehr als drei Assets laufen.
  const lastVisible = dataList[toIdx];
  const chips = [];
  if (mainRef && lastVisible?.close) {
    chips.push({
      label: shortSymbol(state.symbol.label),
      pct: ((lastVisible.close - mainRef) / mainRef) * 100,
      color: "#ffffff",
    });
  }
  state.compareAssets.forEach((asset, idx) => {
    if (asset.hidden) return;
    const { m, ref } = assetRefs[idx];
    if (!ref) return;
    // Letzten verfügbaren Wert im sichtbaren Bereich suchen
    let v = null;
    for (let i = toIdx; i >= fromIdx && v == null; i--) v = m.get(dataList[i].timestamp);
    if (v == null) return;
    chips.push({ label: shortSymbol(asset.label), pct: ((v - ref) / ref) * 100, color: asset.color });
  });

  // Überlappung vermeiden: nach Y sortieren und mindestens 14px Abstand
  chips.forEach(c => { c.y = pctToY(c.pct); });
  chips.sort((a, b) => a.y - b.y);
  for (let i = 1; i < chips.length; i++) {
    if (chips[i].y - chips[i - 1].y < 14) chips[i].y = chips[i - 1].y + 14;
  }

  ctx.font = "12px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  chips.forEach(c => {
    const txt = `${c.label} ${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(1)}%`;
    const tw = ctx.measureText(txt).width;
    const bx = w - tw - 12, by = c.y - 7;
    ctx.fillStyle = T.bg || "rgba(13,17,23,0.9)";
    ctx.fillRect(bx - 3, by, tw + 6, 14);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 3, by, tw + 6, 14);
    ctx.fillStyle = c.color;
    ctx.fillText(txt, bx, by + 10);
  });

  ctx.restore();
}

// "BTC/USDT" -> "BTC", "Gold XAU/USD" -> "XAU"
function shortSymbol(label) {
  const s = String(label).split("/")[0].trim();
  const parts = s.split(" ");
  return (parts.at(-1) || s).toUpperCase().slice(0, 5);
}

function drawLine(ctx, dataList, from, to, valFn, color, width, dl, pctToY, chart) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let started = false;
  for (let i = from; i <= to; i++) {
    const r = valFn(dataList[i]);
    if (!r) { started = false; continue; }
    let x;
    try {
      const pt = chart.convertToPixel({ dataIndex: i }, { paneId: "candle_pane", absolute: true });
      x = pt ? pt.x : null;
    } catch (e) { x = null; }
    if (x == null) { started = false; continue; }
    const y = pctToY(r.pct);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function applyCompareIndicator() {
  if (state.compareAssets.length > 0) {
    // Vergleichsmodus: ALLES entfernen was auf Preis-Basis läuft —
    // Indikatoren, VRVP, Grid-Bot-Bänder, Muster, FVG/OB.
    CONFIG.INDICATORS.forEach(ind => {
      if (state.active.has(ind.key)) { try { removeIndicator(ind); } catch (e) {} }
    });
    if (state.vrvpCanvas) {
      state.vrvpCanvas.getContext("2d").clearRect(0, 0, state.vrvpCanvas.width, state.vrvpCanvas.height);
    }
    try { gbClearBands(); } catch (e) {}
    try { clearPatterns(); } catch (e) {}
    try { clearSMC(); } catch (e) {}
    // Alle Overlays (FRVP, Zeichnungen, Fibonacci etc.) verstecken —
    // sie laufen auf Preis-Basis und hätten im %-Vergleich falsche Positionen.
    // IDs merken für Wiederherstellung.
    state._hiddenDrawingIds = [];
    (state.drawings || []).forEach(d => {
      try { chart.removeOverlay(d.id); state._hiddenDrawingIds.push(d.id); } catch (e) {}
    });
    if (state.tagCanvas) {
      state.tagCanvas.getContext("2d").clearRect(0, 0, state.tagCanvas.width, state.tagCanvas.height);
    }
    chart.setStyles({
      candle: {
        type: "area",
        area: {
          lineColor: "rgba(0,0,0,0)", lineSize: 0,
          backgroundColor: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0)" }],
        },
        priceMark: { last: { show: false }, high: { show: false }, low: { show: false } },
      },
      yAxis: { tickText: { color: "rgba(0,0,0,0)" }, axisLine: { color: "rgba(0,0,0,0)" }, tickLine: { color: "rgba(0,0,0,0)" } },
    });
    setTimeout(() => {
      try { drawCompare(); } catch (e) {}
      // VRVP nochmals leeren: onVisibleRangeChange kann nach dem ersten
      // Clear noch einmal feuern (KLC interne Scroll-Anpassung beim
      // style-Wechsel). Der Flag in onVisibleRangeChange verhindert neue
      // Zeichnungen; hier stellen wir sicher dass der Canvas leer ist.
      if (state.vrvpCanvas) {
        state.vrvpCanvas.getContext("2d").clearRect(0, 0, state.vrvpCanvas.width, state.vrvpCanvas.height);
      }
    }, 100);
  } else {
    chart.setStyles(baseStyles());
    CONFIG.INDICATORS.forEach(ind => {
      if (!state.active.has(ind.key)) return;
      try { removeIndicator(ind); } catch (e) {}
      try { applyIndicator(ind); } catch (e) {}
    });
    if (state.gbOpen && !state.gbCollapsed) { try { gbDrawBands(); } catch (e) {} }
    // Gespeicherte Overlays (FRVP, Zeichnungen) wiederherstellen
    if (state._hiddenDrawingIds && state._hiddenDrawingIds.length) {
      state._hiddenDrawingIds = [];
      try { restoreDrawings(state.drawings); } catch (e) {}
    }
    scheduleTagDraw();
    if (_compareCanvas) {
      _compareCanvas.getContext("2d").clearRect(0, 0, _compareCanvas.width, _compareCanvas.height);
    }
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
  const goldMode     = state.symbol.type === "worker";
  const krakenMode   = state.symbol.type === "kraken";
  const coinbaseMode = state.symbol.type === "coinbase";
  const bybitMode    = state.symbol.type === "bybit";
  CONFIG.TIMEFRAMES.forEach(tf => {
    const item = document.createElement("div");
    // Gold: nur Daily. Kraken: kein Monthly. Coinbase: nur bis Daily. Bybit: alle.
    const disabled = (goldMode && tf.id !== "1d")
                  || (krakenMode && !tf.krakenInterval)
                  || (coinbaseMode && !tf.coinbaseInterval)
                  || (bybitMode && !tf.bybitInterval);
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

// Indikatoren in der vom Nutzer gewählten Reihenfolge (Punkt 6).
// Unbekannte/neue Keys landen hinten in Config-Reihenfolge.
function orderedIndicators() {
  const order = state.indOrder || [];
  const known = new Set(order);
  const inOrder = order
    .map(k => CONFIG.INDICATORS.find(i => i.key === k))
    .filter(Boolean);
  const rest = CONFIG.INDICATORS.filter(i => !known.has(i.key));
  return [...inOrder, ...rest];
}

function renderIndPanel() {
  const list = document.getElementById("indList");
  list.innerHTML = "";

  orderedIndicators().forEach(ind => {
    const row = document.createElement("div");
    row.className = "dd-ind-row";
    row.draggable = true;
    row.dataset.key = ind.key;

    // Drag & Drop zum Umsortieren (Punkt 6)
    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", ind.key);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      list.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = list.querySelector(".dragging");
      if (dragging && dragging !== row) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const fromKey = e.dataTransfer.getData("text/plain");
      if (!fromKey || fromKey === ind.key) return;
      const cur = orderedIndicators().map(i => i.key);
      const from = cur.indexOf(fromKey);
      const to   = cur.indexOf(ind.key);
      cur.splice(to, 0, cur.splice(from, 1)[0]);
      state.indOrder = cur;
      saveWorkspace();
      renderIndPanel();
    });

    const grip = document.createElement("span");
    grip.className = "dd-grip";
    grip.textContent = "⠿";
    grip.title = "Ziehen zum Umsortieren";
    row.appendChild(grip);

    const check = document.createElement("input");
    check.type = "checkbox"; check.id = "ind_" + ind.key; check.checked = state.active.has(ind.key);
    check.addEventListener("change", () => {
      if (check.checked) { state.active.add(ind.key); applyIndicator(ind); }
      else { state.active.delete(ind.key); removeIndicator(ind); }
      scheduleTagDraw();
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
          scheduleTagDraw();
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

  // Aktive Indikatoren auflisten (Name + Farbpunkte der sichtbaren Plots).
  // Im Vergleichsmodus NICHT — dort sind die Indikatoren vom Chart entfernt.
  if (state.compareAssets.length === 0) {
    CONFIG.INDICATORS.filter(i => state.active.has(i.key)).forEach(ind => {
      const sv = Settings.get(ind.key);
      const dots = (ind.plots || [])
        .filter(p => sv.plots[p.key] && sv.plots[p.key].visible !== false)
        .map(p => `<span class="lg-dot" style="background:${sv.plots[p.key].color}"></span>`)
        .join("");
      html += `<div class="legend-line"><span class="lg-name">${ind.label}</span>${dots}</div>`;
    });
  }
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
    item.className = "dd-item dd-item--gear" + (t.id === state.chartType ? " active" : "");

    const name = document.createElement("span");
    name.textContent = t.label;
    name.style.flex = "1";
    name.addEventListener("click", () => {
      state.chartType = t.id;
      saveWorkspace();
      document.getElementById("typeLabel").textContent = t.label;
      document.getElementById("typePanel").classList.remove("open");
      chart.setStyles(baseStyles());
      renderTypeList();
    });
    item.appendChild(name);

    // Zahnrad: öffnet Farb-/Füll-Einstellungen für diesen Typ
    const gear = document.createElement("button");
    gear.className = "ind-gear";
    gear.title = t.id === "area" ? "Linienfarbe & Füllung" : "Kerzenfarben";
    gear.textContent = "⚙";
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      // Erst auf den Typ wechseln, dessen Zahnrad geklickt wurde
      if (state.chartType !== t.id) {
        state.chartType = t.id;
        saveWorkspace();
        document.getElementById("typeLabel").textContent = t.label;
        chart.setStyles(baseStyles());
        renderTypeList();
      }
      document.getElementById("typePanel").classList.remove("open");
      openChartStyleMenu(document.getElementById("typeTrigger"));
    });
    item.appendChild(gear);

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
  // Ganze Datenbreite zeigen und Y-Achse neu automatisch skalieren
  chart.scrollToRealTime();
  autoScaleY();
}

// Mauszeiger über dem Chart setzen. "" stellt das Fadenkreuz wieder her.
function setChartCursor(cursor) {
  const el = document.getElementById("mainChart");
  if (el) el.classList.toggle("cursor-pointer", cursor === "pointer");
}


// ============================================================
// EIGENER PREIS-TAG-RENDERER (Canvas über dem Chart)
//
// Warum selbst zeichnen: KLineCharts kennt für Indikator-Tags NUR einen
// globalen Schalter, und Tag-Hintergrund = Linienfarbe inkl. Deckkraft
// (im Bundle verifiziert). Pro Linie schalten, Deckkraft entkoppeln und
// "aktueller Preis immer zuoberst" gehen nur mit eigener Zeichnung.
// Werte kommen aus chart.getIndicatorByPaneId(...).result, Positionen aus
// convertToPixel({...}, {paneId, absolute:true}) — beides API-verifiziert.
// ============================================================
function ensureTagCanvas() {
  if (state.tagCanvas) return state.tagCanvas;
  const c = document.createElement("canvas");
  // z-index 11: über dem VRVP-Canvas (10), pointer-events aus
  c.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:11;";
  chartEl.style.position = "relative";
  chartEl.appendChild(c);
  state.tagCanvas = c;
  return c;
}

let _tagQueued = false;
function scheduleTagDraw() {
  if (_tagQueued) return;
  _tagQueued = true;
  requestAnimationFrame(() => { _tagQueued = false; try { drawIndicatorTags(); } catch (e) {} });
}

function formatTagValue(v, price) {
  if (v == null || !isFinite(v)) return null;
  if (price) {
    const frac = Math.abs(v) >= 1000 ? 1 : Math.abs(v) >= 1 ? 2 : 4;
    return v.toLocaleString("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: frac });
  }
  return v.toFixed(2);
}

function drawIndicatorTags() {
  const c = ensureTagCanvas();
  const W = chartEl.clientWidth, H = chartEl.clientHeight;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Im Vergleichsmodus keine Tags (weder Indikator- noch Preis-Tags) —
  // die Y-Achse zeigt Prozente, Preis-Tags wären dort schlicht falsch.
  if (state.compareAssets && state.compareAssets.length > 0) return;

  const data = chart.getDataList();
  if (!data || !data.length) return;
  const lastTs = data[data.length - 1].timestamp;
  const cs = state.chartStyle;

  const drawTag = (y, text, bg, size) => {
    if (y == null || !isFinite(y) || y < 0 || y > H) return;
    ctx.font = size + "px 'IBM Plex Mono', monospace";
    const tw = ctx.measureText(text).width;
    const th = size + 6;
    const x0 = W - tw - 10;
    ctx.fillStyle = bg;
    ctx.fillRect(x0, y - th / 2, tw + 10, th);
    ctx.fillStyle = textOn(bg.startsWith("#") ? bg : "#888888");
    ctx.textBaseline = "middle";
    ctx.fillText(text, x0 + 5, y + 0.5);
  };

  // --- Indikator-Tags: echt pro Linie (showLast) ---
  // TAG_RESULT_KEY: Config-Plot-Key → Ergebnis-Key im indicators.js-Result.
  // EMA e1..e4 → ema1..ema4, RVWAP line → rvwap, GC upper/midUp/lower →
  // gcUpper/gcMid/gcLower, Hull up → mhull. Plots die KEIN Tag bekommen
  // (GC midDown, Hull down/band) stehen absichtlich nicht im Mapping.
  const TAG_RESULT_KEY = {
    ema:   { e1: "ema1", e2: "ema2", e3: "ema3", e4: "ema4" },
    rvwap: { line: "rvwap" },
    gc:    { upper: "gcUpper", midUp: "gcMid", lower: "gcLower" },
    hull:  { up: "mhull" },
  };
  CONFIG.INDICATORS.forEach(ind => {
    if (!state.active.has(ind.key) || ind.noTags || ind.key === "vrvp") return;
    const paneId = ind.pane === "sub" ? (state.subPaneIds[ind.key] || "pane_" + ind.key) : "candle_pane";
    let inst = null;
    try { inst = chart.getIndicatorByPaneId(paneId, ind.name); } catch (e) {}
    if (!inst || !Array.isArray(inst.result) || !inst.result.length) return;
    const lastRow = inst.result[inst.result.length - 1] || {};
    const sv = Settings.get(ind.key);
    const keyMap = TAG_RESULT_KEY[ind.key];
    (ind.plots || []).forEach(p => {
      const pl = sv.plots[p.key];
      if (!pl || pl.visible === false || pl.showLast === false) return;
      // Ergebnis-Key: gemappte Indikatoren nur wenn Key im Mapping steht
      const rk = keyMap ? keyMap[p.key] : p.key;
      if (keyMap && rk == null) return;
      const v = lastRow[rk];
      if (v == null || !isFinite(v)) return;
      // Trendabhängige Tag-Farbe für GC-Mittellinie und Hull-Linie
      let hex = pl.hex || "#888888";
      if (ind.key === "gc" && p.key === "midUp") {
        hex = (sv.plots[lastRow.gcUp ? "midUp" : "midDown"] || pl).hex || hex;
      } else if (ind.key === "hull" && p.key === "up") {
        hex = (sv.plots[lastRow.up ? "up" : "down"] || pl).hex || hex;
      }
      let y = null;
      try { y = chart.convertToPixel({ timestamp: lastTs, value: v }, { paneId, absolute: true }).y; } catch (e) {}
      drawTag(y, formatTagValue(v, ind.pane !== "sub"), hex, 12);
    });
  });

  // --- Aktueller Preis: IMMER zuletzt gezeichnet = immer zuoberst ---
  if (cs.lastText !== false) {
    const k = data[data.length - 1];
    const up = k.close >= k.open;
    const bg = up ? cs.upColor : cs.downColor;
    let y = null;
    try { y = chart.convertToPixel({ timestamp: lastTs, value: k.close }, { paneId: "candle_pane", absolute: true }).y; } catch (e) {}
    drawTag(y, formatTagValue(k.close, true), bg, cs.lastSize || 12);
  }
}

// ---------- Zeichnungs-Register ----------
// KLineCharts hat keine API, um alle Overlays auszulesen (getOverlayStore
// existiert nicht). Für "Zeichnungen im Layout speichern" müssen wir also
// selbst mitschreiben: jedes fertige Overlay landet hier, gelöschte fliegen
// raus. Grid-Bänder und Muster gehören NICHT dazu — die erzeugen ihre
// Module selbst neu.
const SAVED_OVERLAYS = new Set([
  "segment", "horizontalStraightLine", "verticalStraightLine", "priceLine",
  "rectangle", "rayLine", "priceChannelLine", "parallelStraightLine",
  "frvp", "fibRetracement", "fibExtension", "priceRange", "dateRange",
  "simpleAnnotation", "freehand", "positionTool", "polyline", "avwap",
]);

function registerDrawing(id, name, points, extendData, styles) {
  if (!SAVED_OVERLAYS.has(name)) return;
  state.drawings.push({
    id, name,
    points: points.map(p => ({ timestamp: p.timestamp, value: p.value })),
    extendData: extendData ?? null,
    styles: styles ?? null,
  });
  saveWorkspace();
}

function unregisterDrawing(id) {
  const i = state.drawings.findIndex(d => d.id === id);
  if (i >= 0) { state.drawings.splice(i, 1); saveWorkspace(); }
}

// Nach dem Zeichnen die tatsächlichen Punkte aus dem Overlay holen und
// registrieren. Muss NACH onDrawEnd laufen, sonst sind die Punkte noch leer.
function captureDrawing(id) {
  setTimeout(() => {
    try {
      const o = chart.getOverlayById(id);
      if (o && o.points?.length) {
        registerDrawing(id, o.name, o.points, o.extendData, o.styles);
      }
    } catch (e) {}
  }, 30);
}

// Gespeicherte Zeichnungen wiederherstellen
function restoreDrawings(list) {
  if (!list || !list.length) return;
  state.drawings = [];
  list.forEach(d => {
    try {
      const id = chart.createOverlay({
        name: d.name,
        points: d.points,
        extendData: d.extendData ?? undefined,
        styles: d.styles ?? undefined,
        onSelected:   (e) => { state.selectedOverlayId = e.overlay.id; return false; },
        onDeselected: () => { state.selectedOverlayId = null; return false; },
        onMouseEnter: () => { setChartCursor("pointer"); return false; },
        onMouseLeave: () => { setChartCursor(""); return false; },
        onRightClick: (e) => {
          if (d.name === "frvp") openFrvpMenu(e.overlay, e); else openOverlayMenu(e.overlay, e);
          return true;
        },
        onRemoved: (e) => {
          unregisterDrawing(e.overlay.id);
          if (d.name === "avwap" && typeof window.__tvRemoveAnchorVwap === "function") {
            window.__tvRemoveAnchorVwap(e.overlay.id);
          }
          return false;
        },
      });
      if (id) {
        state.drawings.push({ ...d, id });
        // AVWAP-Indikator beim Wiederherstellen neu aktivieren
        if (d.name === "avwap" && d.points?.[0]?.timestamp) {
          setTimeout(() => window.__tvAnchorVwap?.(d.points[0].timestamp, id), 50);
        }
      }
    } catch (e) {}
  });
}

// ---------- Freihand-Zeichnen ----------
// Sonderweg: KLineCharts kennt nur Klick-für-Klick-Werkzeuge. Freihand
// braucht Tracking bei gedrückter Maus, also sammeln wir die Punkte
// selbst und erzeugen das Overlay erst beim Loslassen.
let _fhPoints = null;

function startFreehand() {
  state.activeTool = "freehand";
  renderDrawbar();
  setStatus("Freihand: Maus gedrückt halten und ziehen");
  const el = document.getElementById("mainChart");
  el.classList.add("cursor-crosshair");

  // KLineCharts fängt mousedown selbst ab und verschiebt den Ausschnitt.
  // Ohne das Abschalten zeichnet man nicht, sondern scrollt nur.
  try { chart.setScrollEnabled(false); chart.setZoomEnabled(false); } catch (e) {}

  const toPoint = (ev) => {
    const rect = el.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const y = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
    try {
      const v = chart.convertFromPixel({ x, y }, { paneId: "candle_pane" });
      return (v && v.timestamp != null && v.value != null) ? { timestamp: v.timestamp, value: v.value } : null;
    } catch (e) { return null; }
  };

  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const p = toPoint(ev);
    if (!p) return;
    _fhPoints = [p];
    ev.preventDefault();
    ev.stopPropagation();
  };
  const onMove = (ev) => {
    if (!_fhPoints) return;
    const p = toPoint(ev);
    // Nur neue Punkte aufnehmen — sonst hunderte identische bei Stillstand
    if (p && (_fhPoints.length === 0 || p.timestamp !== _fhPoints.at(-1).timestamp || p.value !== _fhPoints.at(-1).value)) {
      _fhPoints.push(p);
    }
    ev.preventDefault();
  };
  const onUp = () => {
    if (!_fhPoints) return;
    const pts = _fhPoints;
    _fhPoints = null;
    if (pts.length >= 2) {
      try {
        const ed = { color: state.drawStyle.color, size: state.drawStyle.width || 2 };
        const id = chart.createOverlay({
          name: "freehand",
          points: pts,
          extendData: ed,
          onRightClick: (e) => { openOverlayMenu(e.overlay, e); return true; },
          onMouseEnter: () => { setChartCursor("pointer"); return false; },
          onMouseLeave: () => { setChartCursor(""); return false; },
          onRemoved: (e) => { unregisterDrawing(e.overlay.id); return false; },
        });
        if (id) registerDrawing(id, "freehand", pts, ed, null);
      } catch (e) {}
    }
    if (!state.pinTool) stopFreehand();
  };

  _fhHandlers = { onDown, onMove, onUp, el };
  // capture: true -> unser Handler läuft VOR dem von KLineCharts
  el.addEventListener("mousedown", onDown, { capture: true });
  el.addEventListener("touchstart", onDown, { capture: true, passive: false });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchend", onUp);
}

let _fhHandlers = null;

function stopFreehand() {
  // Immer zurückschalten, auch wenn keine Handler hängen — sonst bleibt
  // der Chart im schlimmsten Fall unbedienbar.
  try { chart.setScrollEnabled(true); chart.setZoomEnabled(true); } catch (e) {}
  if (!_fhHandlers) return;
  const { onDown, onMove, onUp, el } = _fhHandlers;
  el.removeEventListener("mousedown", onDown, { capture: true });
  el.removeEventListener("touchstart", onDown, { capture: true });
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("touchmove", onMove);
  document.removeEventListener("mouseup", onUp);
  document.removeEventListener("touchend", onUp);
  el.classList.remove("cursor-crosshair");
  _fhHandlers = null;
  _fhPoints = null;
  state.activeTool = null;
  renderDrawbar();
}

// ---------- Polyline (klickbasiert) ----------
// KLineCharts kann keine Mehrpunkt-Linien nativ. Also sammeln wir Klicks
// selbst (wie Freihand, nur klick- statt bewegungsbasiert): jeder Linksklick
// setzt einen Punkt, Rechtsklick / Enter / Doppelklick schliesst ab, ESC
// bricht ab. Nach jedem Klick wird die Vorschau-Linie neu gezeichnet.
let _polyPoints = null;
let _polyHandlers = null;
let _polyPreviewId = null;

function _polyRedrawPreview() {
  if (_polyPreviewId != null) { try { chart.removeOverlay(_polyPreviewId); } catch (e) {} _polyPreviewId = null; }
  if (!_polyPoints || _polyPoints.length < 2) return;
  try {
    _polyPreviewId = chart.createOverlay({
      name: "polyline",
      points: _polyPoints.slice(),
      extendData: { color: state.drawStyle.color, size: state.drawStyle.width || 1.5 },
    });
    if (Array.isArray(_polyPreviewId)) _polyPreviewId = _polyPreviewId[0];
  } catch (e) {}
}

function startPolyline() {
  state.activeTool = "polyline";
  renderDrawbar();
  setStatus("Polylinie: klicken für Punkte, Rechtsklick oder Enter beendet, ESC bricht ab");
  const el = document.getElementById("mainChart");
  el.classList.add("cursor-crosshair");
  _polyPoints = [];

  // Scroll/Zoom aus, damit Klicks nicht als Pan interpretiert werden
  try { chart.setScrollEnabled(false); chart.setZoomEnabled(false); } catch (e) {}

  const toPoint = (ev) => {
    const rect = el.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const y = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
    try {
      const v = chart.convertFromPixel({ x, y }, { paneId: "candle_pane" });
      return (v && v.timestamp != null && v.value != null) ? { timestamp: v.timestamp, value: v.value } : null;
    } catch (e) { return null; }
  };

  const onClick = (ev) => {
    if (ev.button != null && ev.button !== 0) return;   // nur Linksklick
    const p = toPoint(ev);
    if (!p) return;
    _polyPoints.push(p);
    ev.preventDefault();
    ev.stopPropagation();
    _polyRedrawPreview();
  };

  // Rechtsklick beendet die Polylinie (kein Kontextmenü währenddessen)
  const onContext = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    finishPolyline();
  };

  // Doppelklick beendet ebenfalls
  const onDbl = (ev) => { ev.preventDefault(); ev.stopPropagation(); finishPolyline(); };

  _polyHandlers = { onClick, onContext, onDbl, el };
  el.addEventListener("mousedown", onClick, { capture: true });
  el.addEventListener("touchstart", onClick, { capture: true, passive: false });
  el.addEventListener("contextmenu", onContext, { capture: true });
  el.addEventListener("dblclick", onDbl, { capture: true });
}

function finishPolyline() {
  if (!_polyPoints) return;
  const pts = _polyPoints.slice();
  // Vorschau entfernen
  if (_polyPreviewId != null) { try { chart.removeOverlay(_polyPreviewId); } catch (e) {} _polyPreviewId = null; }
  const pin = state.pinTool;
  stopPolyline();
  if (pts.length >= 2) {
    try {
      const ed = { color: state.drawStyle.color, size: state.drawStyle.width || 1.5 };
      const id = chart.createOverlay({
        name: "polyline",
        points: pts,
        extendData: ed,
        onRightClick: (e) => { openOverlayMenu(e.overlay, e); return true; },
        onSelected:   (e) => { state.selectedOverlayId = e.overlay.id; return false; },
        onDeselected: () => { state.selectedOverlayId = null; return false; },
        onMouseEnter: () => { setChartCursor("pointer"); return false; },
        onMouseLeave: () => { setChartCursor(""); return false; },
        onRemoved: (e) => { unregisterDrawing(e.overlay.id); return false; },
      });
      const oid = Array.isArray(id) ? id[0] : id;
      if (oid) registerDrawing(oid, "polyline", pts, ed, null);
    } catch (e) {}
  }
  if (pin) setTimeout(() => startPolyline(), 0);
}

function stopPolyline() {
  // Nichts aktiv? Nur Scroll/Zoom sicherstellen und raus — sonst würde
  // jeder Werkzeugstart activeTool fälschlich zurücksetzen.
  if (!_polyHandlers && _polyPreviewId == null && !_polyPoints) return;
  try { chart.setScrollEnabled(true); chart.setZoomEnabled(true); } catch (e) {}
  if (_polyPreviewId != null) { try { chart.removeOverlay(_polyPreviewId); } catch (e) {} _polyPreviewId = null; }
  if (_polyHandlers) {
    const { onClick, onContext, onDbl, el } = _polyHandlers;
    el.removeEventListener("mousedown", onClick, { capture: true });
    el.removeEventListener("touchstart", onClick, { capture: true });
    el.removeEventListener("contextmenu", onContext, { capture: true });
    el.removeEventListener("dblclick", onDbl, { capture: true });
    el.classList.remove("cursor-crosshair");
  }
  _polyHandlers = null;
  _polyPoints = null;
  state.activeTool = null;
  renderDrawbar();
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
  window.__tvStartTool = startTool;   // Draw-Sheet-Zugriff
  // Freihand und Polyline laufen über eigene Maus-Handler, nicht über KLineCharts
  if (overlayName === "freehand") { stopPolyline(); startFreehand(); return; }
  if (overlayName === "polyline") { stopFreehand(); startPolyline(); return; }
  stopFreehand();
  stopPolyline();
  state.activeTool = overlayName;
  const overlayConfig = {
    name: overlayName,
    mode: state.magnetMode,
    // KLineCharts snappt im Magnet-Modus an alle vier OHLC-Werte (High, Low,
    // Open, Close) — aber nur innerhalb von modeSensitivity Pixeln. Der
    // Default 8 ist so eng, dass sich nur das Einrasten nahe der Kerzenmitte
    // bemerkbar macht. Grösserer Fangbereich = spürbares Einrasten an allen
    // vier Punkten.
    modeSensitivity: state.magnetMode === "strong_magnet" ? 40 : 18,
    styles: currentOverlayStyles(),
    onDrawEnd: (e) => {
      // simpleAnnotation liest seinen Text aus extendData. Ohne den bleibt
      // nur die Linie mit Pfeil übrig — sieht aus wie ein Bug, ist aber
      // schlicht ein leeres Label.
      if (overlayName === "simpleAnnotation" && e?.overlay?.id) {
        const txt = window.prompt("Text für die Notiz:", "");
        if (txt && txt.trim()) {
          try { chart.overrideOverlay({ id: e.overlay.id, extendData: txt.trim() }); } catch (err) {}
        } else {
          try { chart.removeOverlay(e.overlay.id); } catch (err) {}
        }
      }
      // Ins Register aufnehmen, damit Layouts die Zeichnung sichern können
      if (e?.overlay?.id) captureDrawing(e.overlay.id);
      // AVWAP: der generische onDrawEnd hier überschreibt den aus der
      // Overlay-Registrierung — deshalb die Indikator-Bridge direkt aufrufen.
      if (overlayName === "avwap" && e?.overlay?.points?.[0]?.timestamp) {
        window.__tvAnchorVwap?.(e.overlay.points[0].timestamp, e.overlay.id);
      }
      state.drawingId = null;
      if (state.pinTool) {
        setTimeout(() => startTool(overlayName), 0);
      } else {
        state.activeTool = null;
        document.getElementById("posToolTopBtn")?.classList.remove("active");
        renderDrawbar();
      }
      return false;
    },
    onSelected:   (e) => { state.selectedOverlayId = e.overlay.id; return false; },
    onDeselected: () => { state.selectedOverlayId = null; return false; },
    onRemoved:    (e) => {
      unregisterDrawing(e.overlay.id);
      if (overlayName === "avwap") window.__tvRemoveAnchorVwap?.(e.overlay.id);
      return false;
    },
    // 2.15: Zeigt an, dass die Zeichnung anklickbar ist. Ohne das sieht
    // man dem Fadenkreuz nicht an, dass hier etwas zu holen ist.
    onMouseEnter: () => { setChartCursor("pointer"); return false; },
    onMouseLeave: () => { setChartCursor(""); return false; },
    // Rechtsklick auf JEDE Zeichnung → Kontext-Menü mit Löschen
    onRightClick: (e) => {
      if (overlayName === "frvp") {
        openFrvpMenu(e.overlay, e);
      } else {
        openOverlayMenu(e.overlay, e);
      }
      return true;
    },
  };
  // FRVP: zuletzt gespeicherte Einstellungen als Vorlage (Punkt 4),
  // sonst die eingebauten Defaults.
  if (overlayName === "frvp") {
    overlayConfig.extendData = state.frvpDefaults || {
      rows: 150, valueArea: 70, width: 30, opacity: 55,
      showVAH: true, showVAL: true, showPOC: true,
      colorUp: "rgba(63,182,139,0.55)", colorDown: "rgba(208,94,94,0.55)",
      colorVAH: "#e8b64c", colorVAL: "#e8b64c", colorPOC: "#ffffff" };
  }
  const id = chart.createOverlay(overlayConfig);
  state.drawingId = Array.isArray(id) ? id[0] : id;
  renderDrawbar();
}

// ---------- Generisches Overlay-Menü (Einzellöschen per Rechtsklick) ----------
// KLineCharts liefert Klick-Koordinaten relativ zum Chart-Canvas. Das Menü
// liegt per position:fixed im Fenster — ohne den Offset des Containers
// erscheint es systematisch versetzt statt an der Zeichnung.
// Menüs dürfen nie über den Bildrand ragen — sonst ist "Übernehmen"
// unerreichbar. Nach dem Einblenden die ECHTE Grösse messen und klemmen
// (menuPosition schätzt nur; das FRVP-Menü ist höher als die Schätzung).
function clampMenuToViewport(menu) {
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 6) menu.style.top = Math.max(6, window.innerHeight - r.height - 6) + "px";
  if (r.right > window.innerWidth - 6) menu.style.left = Math.max(6, window.innerWidth - r.width - 6) + "px";
}

// Auf Touch-Geräten mit schmalem Screen werden Menüs zu Bottom-Sheets:
// volle Breite am unteren Rand statt am Finger. Grund: ein fingerpositioniertes
// Menü öffnet am unteren Bildrand ausserhalb des Sichtfelds, und die Tap-Ziele
// in einem schmalen Popup sind zu klein. Bottom-Sheet ist die native
// Mobile-Konvention und löst beides.
function useSheetLayout() {
  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 720;
}

// Einheitliche Platzierung für alle fixed-positionierten Menüs.
// Desktop: an der übergebenen Position, in den Viewport geklemmt.
// Touch/schmal: als Bottom-Sheet (Position kommt aus dem CSS).
function placeMenu(menu, x, y) {
  if (!menu) return;
  if (useSheetLayout()) {
    menu.classList.add("as-sheet");
    menu.style.left = "";
    menu.style.top  = "";
    return;
  }
  menu.classList.remove("as-sheet");
  menu.style.left = x + "px";
  menu.style.top  = y + "px";
  clampMenuToViewport(menu);
}

function menuPosition(event, menuW = 130, menuH = 70) {
  const rect = document.getElementById("mainChart").getBoundingClientRect();
  const cx = event?.pointerCoordinate?.x ?? event?.x;
  const cy = event?.pointerCoordinate?.y ?? event?.y;
  // Fallback: Mitte des Charts, falls das Event keine Koordinaten trägt
  const x = rect.left + (cx != null ? cx : rect.width / 2);
  const y = rect.top  + (cy != null ? cy : rect.height / 2);
  return {
    x: Math.max(6, Math.min(x + 4, window.innerWidth  - menuW)),
    y: Math.max(6, Math.min(y + 4, window.innerHeight - menuH)),
  };
}

function openOverlayMenu(overlay, event) {
  const menu = document.getElementById("overlayMenu");
  if (!menu) return;
  const { x, y } = menuPosition(event, 190, 230);
  placeMenu(menu, x, y);

  // Aktuellen Linien-Stil aus dem Overlay lesen (Fallback auf Akzentfarbe)
  const ls = (overlay.styles && overlay.styles.line) || {};
  const cur = parseColor(ls.color || "#e8b64c");
  const colEl  = document.getElementById("omColor");
  const opEl   = document.getElementById("omOpacity");
  const opVal  = document.getElementById("omOpacityVal");
  const wEl    = document.getElementById("omWidth");
  const dashEl = document.getElementById("omDashed");
  colEl.value  = cur.hex;
  opEl.value   = cur.alpha;
  opVal.textContent = cur.alpha + "%";
  wEl.value    = ls.size || 1;
  dashEl.checked = ls.style === "dashed";

  // Live anwenden — jede Änderung sofort sichtbar, kein separater Apply-Klick.
  const apply = () => {
    const hex = colEl.value;
    const alpha = parseInt(opEl.value, 10);
    opVal.textContent = alpha + "%";
    const line = {
      color: hexToRgba(hex, alpha),
      size:  parseInt(wEl.value, 10) || 1,
      style: dashEl.checked ? "dashed" : "solid",
      dashedValue: dashEl.checked ? [6, 4] : [2, 2],
    };
    try {
      chart.overrideOverlay({ id: overlay.id, styles: { line } });
      // Ins Zeichnungs-Register spiegeln, damit Layouts den Stil behalten
      const rec = state.drawings.find(d => d.id === overlay.id);
      if (rec) { rec.styles = { line }; saveWorkspace(); }
    } catch (e) {}
  };
  colEl.oninput  = apply;
  opEl.oninput   = apply;
  wEl.oninput    = apply;
  dashEl.onchange = apply;

  menu.classList.remove("hidden");
  clampMenuToViewport(menu);
  document.getElementById("overlayDelete").onclick = () => {
    chart.removeOverlay(overlay.id);
    menu.classList.add("hidden");
  };
}

// Farbe (hex oder rgba) in {hex, alpha%} zerlegen — für die Menü-Regler.
function parseColor(c) {
  if (!c) return { hex: "#e8b64c", alpha: 100 };
  if (c.startsWith("#")) return { hex: c.slice(0, 7), alpha: 100 };
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return { hex: "#e8b64c", alpha: 100 };
  const hex = "#" + [0, 1, 2].map(i => Math.round(parseFloat(m[i])).toString(16).padStart(2, "0")).join("");
  const alpha = m.length >= 4 ? Math.round(parseFloat(m[3]) * 100) : 100;
  return { hex, alpha };
}
document.addEventListener("click", (e) => {
  const om = document.getElementById("overlayMenu");
  if (om && !om.contains(e.target)) om.classList.add("hidden");
});
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
  // 2.1: Deckkraft der Balken (10–100 %, 5er-Schritte)
  const opac = ext.opacity != null ? ext.opacity : 55;
  document.getElementById("frvpOpacity").value = opac;
  document.getElementById("frvpOpacityVal").textContent = opac + "%";
  document.getElementById("frvpOpacity").oninput = (e) => {
    document.getElementById("frvpOpacityVal").textContent = e.target.value + "%";
  };
  document.getElementById("frvpExtendRight").checked = ext.extendRight === true;

  const p = menuPosition(event, 260, 380);
  menu.classList.remove("hidden");
  placeMenu(menu, p.x, p.y);   // klemmt bzw. wird auf Touch zum Bottom-Sheet

  document.getElementById("frvpApply").onclick = () => {
    const op = parseInt(document.getElementById("frvpOpacity").value, 10) || 55;
    const newExt = {
      rows:      parseInt(document.getElementById("frvpRows").value, 10)  || 150,
      valueArea: parseInt(document.getElementById("frvpVA").value, 10)    || 70,
      width:     parseInt(document.getElementById("frvpWidth").value, 10) || 30,
      opacity:   op,
      showVAH:   document.getElementById("frvpShowVAH").checked,
      showVAL:   document.getElementById("frvpShowVAL").checked,
      showPOC:   document.getElementById("frvpShowPOC").checked,
      colorUp:   hexToRgba(document.getElementById("frvpColorUp").value,   op),
      colorDown: hexToRgba(document.getElementById("frvpColorDown").value, op),
      colorVAH:    document.getElementById("frvpColorVAH").value,
      colorVAL:    document.getElementById("frvpColorVAL").value,
      colorPOC:    document.getElementById("frvpColorPOC").value,
      extendRight: document.getElementById("frvpExtendRight").checked,
    };
    chart.overrideOverlay({ id: overlay.id, extendData: newExt });
    // Als Vorlage für künftige FRVPs merken (Punkt 4)
    state.frvpDefaults = { ...newExt };
    // Auch im Zeichnungs-Register aktualisieren, damit Layouts es behalten
    const rec = state.drawings.find(d => d.id === overlay.id);
    if (rec) rec.extendData = newExt;
    saveWorkspace();
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
  placeMenu(pop, bar.right + 6, 120);

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

// Zeichenwerkzeug-Kategorien
const DRAW_CATEGORIES = [
  {
    id: "lines", title: "Linien",
    icon: `<svg viewBox="0 0 24 24"><circle cx="4" cy="20" r="2.2" fill="currentColor"/><circle cx="20" cy="4" r="2.2" fill="currentColor"/><line x1="5.6" y1="18.4" x2="18.4" y2="5.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    tools: [
      { overlay: "segment",                label: "Trendlinie",       desc: "Verbindet Hochs oder Tiefs" },
      { overlay: "horizontalStraightLine",  label: "Horizontale Linie",desc: "Support- und Resistance-Level" },
      { overlay: "verticalStraightLine",    label: "Vertikale Linie",  desc: "Zeitereignis markieren" },
      { overlay: "priceLine",               label: "Preislinie",       desc: "Horizontale mit Preislabel" },
      { overlay: "rectangle",               label: "Rechteck",         desc: "Preiszonen, Orderblöcke" },
      { overlay: "rayLine",                 label: "Strahl",           desc: "Halbgerade ab einem Punkt" },
      { overlay: "priceChannelLine",        label: "Parallelkanal",    desc: "Zwei parallele Trendlinien" },
      { overlay: "parallelStraightLine",    label: "Parallele Linien", desc: "Mehrere parallele Geraden" },
      { overlay: "polyline",                label: "Polylinie",         desc: "Mehrpunkt-Linie, ESC zum Beenden" },
    ],
  },
  {
    id: "zones", title: "Zonen & Profile",
    icon: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="3" rx="1" fill="currentColor"/><rect x="3" y="9" width="12" height="3" rx="1" fill="currentColor"/><rect x="3" y="14" width="9" height="3" rx="1" fill="currentColor"/><rect x="3" y="19" width="5" height="2" rx="1" fill="currentColor"/></svg>`,
    tools: [
      { overlay: "frvp",        label: "Fixed Range Vol.",  desc: "Volumen pro Preisstufe" },
      { overlay: "avwap",       label: "Anchored VWAP",     desc: "VWAP ab einem Klick-Punkt" },
    ],
  },
  {
    id: "fib", title: "Fibonacci",
    icon: `<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3,2"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    tools: [
      { overlay: "fibRetracement", label: "Fib Retracement", desc: "Korrektur-Ziele nach Impuls" },
      { overlay: "fibExtension",   label: "Fib Extension",   desc: "Kursziele projizieren (3 Punkte)" },
    ],
  },
  {
    id: "measure", title: "Messwerkzeuge",
    icon: `<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>`,
    tools: [
      { overlay: "priceRange", label: "Preisspanne",  desc: "Prozentuale Preisänderung" },
      { overlay: "dateRange",  label: "Zeitspanne",   desc: "Zeit und Kerzenanzahl" },
    ],
  },
  {
    id: "annot", title: "Annotationen",
    icon: `<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    tools: [
      { overlay: "simpleAnnotation", label: "Textfeld",  desc: "Notiz an eine Kerze heften" },
      { overlay: "freehand",         label: "Freihand",  desc: "Frei zeichnen mit gedrückter Maus" },
    ],
  },
];

function renderDrawbar() {
  const bar = document.getElementById("drawbar");
  bar.innerHTML = "";

  // Stil-Wähler oben
  const styleBtn = document.createElement("button");
  styleBtn.id = "drawStyleBtn";
  styleBtn.className = "draw-cat-btn";
  styleBtn.title = "Zeichenstil";
  styleBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1.17A8 8 0 0 0 12 2z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="9" r="1.5" fill="#ff5252"/><circle cx="12" cy="7" r="1.5" fill="#e8b64c"/><circle cx="16" cy="9" r="1.5" fill="#3fb68b"/><circle cx="17" cy="13" r="1.5" fill="#5aa9e6"/></svg>`;
  styleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleDrawStylePopover(); });
  bar.appendChild(styleBtn);

  const sep0 = document.createElement("div"); sep0.className = "draw-sep"; bar.appendChild(sep0);

  // Kategorie-Gruppen
  DRAW_CATEGORIES.forEach(cat => {
    const group = document.createElement("div");
    group.className = "draw-group";

    const catBtn = document.createElement("button");
    catBtn.className = "draw-cat-btn" + (state.activeTool && cat.tools.some(t => t.overlay === state.activeTool) ? " active" : "");
    catBtn.title = cat.title;
    catBtn.innerHTML = cat.icon;
    catBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const popup = group.querySelector(".draw-popup");
      const wasOpen = popup.classList.contains("open");
      bar.querySelectorAll(".draw-popup").forEach(p => p.classList.remove("open"));
      if (!wasOpen) {
        // position:fixed → Viewport-Koordinaten aus dem Button berechnen,
        // damit das Fly-Out über dem Chart schwebt statt in der Sidebar
        // geclippt zu werden.
        const r = catBtn.getBoundingClientRect();
        popup.classList.add("open");
        const ph = popup.offsetHeight;
        const pw = popup.offsetWidth;
        if (useSheetLayout()) {
          // Mobile: Drawbar liegt unten und ist horizontal — das Fly-Out
          // muss NACH OBEN aufklappen und horizontal in den Screen geklemmt
          // werden, sonst öffnet es seitlich ins Nichts.
          const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
          popup.style.left = left + "px";
          popup.style.top  = Math.max(8, r.top - ph - 8) + "px";
        } else {
          popup.style.left = (r.right + 8) + "px";
          const top = Math.min(r.top, window.innerHeight - ph - 12);
          popup.style.top = Math.max(8, top) + "px";
        }
      }
    });
    group.appendChild(catBtn);

    const popup = document.createElement("div");
    popup.className = "draw-popup";
    cat.tools.forEach(tool => {
      const item = document.createElement("div");
      item.className = "draw-popup-item" + (state.activeTool === tool.overlay ? " active" : "");
      item.innerHTML = `<span class="dpi-name">${tool.label}</span><span class="dpi-desc">${tool.desc}</span>`;
      item.addEventListener("click", () => {
        popup.classList.remove("open");
        startTool(tool.overlay);
      });
      popup.appendChild(item);
    });
    group.appendChild(popup);
    bar.appendChild(group);
  });

  const sep1 = document.createElement("div"); sep1.className = "draw-sep"; bar.appendChild(sep1);

  // Magnet
  const magnet = document.createElement("button");
  magnet.className = "draw-cat-btn small" + (state.magnetMode !== "normal" ? " active" : "");
  magnet.title = state.magnetMode === "normal" ? "Magnet: aus" : state.magnetMode === "weak_magnet" ? "Magnet: schwach" : "Magnet: stark";
  magnet.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M4 8a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="4" y1="8" x2="4" y2="14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="20" y1="8" x2="20" y2="14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  magnet.addEventListener("click", () => {
    state.magnetMode = state.magnetMode === "normal" ? "weak_magnet" : state.magnetMode === "weak_magnet" ? "strong_magnet" : "normal";
    renderDrawbar();
  });
  bar.appendChild(magnet);

  // Pin
  const pin = document.createElement("button");
  pin.className = "draw-cat-btn small" + (state.pinTool ? " active" : "");
  pin.title = state.pinTool ? "Werkzeug bleibt aktiv" : "Werkzeug nach Zeichnung deaktivieren";
  pin.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M9 4v6l-2 4v2h10v-2l-2-4V4M12 16v5M8 4h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  pin.addEventListener("click", () => { state.pinTool = !state.pinTool; renderDrawbar(); });
  bar.appendChild(pin);

  const sep2 = document.createElement("div"); sep2.className = "draw-sep"; bar.appendChild(sep2);

  // Alles löschen
  const clear = document.createElement("button");
  clear.className = "draw-cat-btn small danger";
  clear.title = "Alle Zeichnungen löschen";
  clear.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  clear.addEventListener("click", () => chart.removeOverlay());
  bar.appendChild(clear);
}

// Popups schliessen bei Klick ausserhalb
document.addEventListener("click", (e) => {
  if (!e.target.closest(".draw-group")) {
    document.querySelectorAll(".draw-popup").forEach(p => p.classList.remove("open"));
  }
});

// Tastatur: ESC bricht Zeichnen ab, Entf löscht selektiertes Overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Polyline aktiv: abbrechen (Vorschau weg, kein Overlay)
    if (state.activeTool === "polyline") { stopPolyline(); return; }
    if (state.drawingId != null) {
      chart.removeOverlay(state.drawingId);
      state.drawingId = null;
    }
    stopFreehand();
    state.activeTool = null;
    document.getElementById("posToolTopBtn")?.classList.remove("active");
    renderDrawbar();
  } else if (e.key === "Enter" && state.activeTool === "polyline") {
    // Enter: Polylinie abschliessen
    finishPolyline();
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
  const priceStr = last.close.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
  const changeStr = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;

  document.getElementById("phSymbol").textContent = state.symbol.label;
  document.getElementById("phPrice").textContent  = priceStr;
  const chEl = document.getElementById("phChange");
  chEl.textContent = changeStr;
  chEl.className = "ph-change " + (change >= 0 ? "up" : "down");

  // Mobile Info-Bar synchron halten
  const mibPrice  = document.getElementById("mibPrice");
  const mibChange = document.getElementById("mibChange");
  const mibAsset  = document.getElementById("mibAsset");
  const mibTf     = document.getElementById("mibTf");
  if (mibAsset)  mibAsset.textContent  = state.symbol.label;
  if (mibTf)     mibTf.textContent     = state.timeframe?.label || "–";
  if (mibPrice)  mibPrice.textContent  = priceStr;
  if (mibChange) {
    mibChange.textContent = changeStr;
    mibChange.style.color = change >= 0 ? "var(--up)" : "var(--down)";
  }
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
  if (_compareCanvas && state.compareAssets.length > 0) {
    _compareCanvas.width  = chartEl.clientWidth;
    _compareCanvas.height = chartEl.clientHeight;
    try { drawCompare(); } catch (e) {}
  }
}
new ResizeObserver(resize).observe(document.querySelector(".workspace"));

// ---------- Touch-Support (Mobile) ----------
// KLineCharts hat eingeschränkten Touch-Support. Wir ergänzen:
// - Pinch-to-Zoom (zwei Finger) via touchstart/touchmove
// - Einzel-Finger-Pan ist bereits in KLC eingebaut
// ============================================================
// MOBILE DRAW BOTTOM SHEET
// ============================================================
(function initDrawSheet() {
  const btn      = document.getElementById("drawSheetBtn");
  const sheet    = document.getElementById("drawSheet");
  const backdrop = document.getElementById("drawSheetBackdrop");
  const grid     = document.getElementById("drawSheetGrid");
  if (!btn || !sheet || !grid) return;

  // Symbole: erst aus CONFIG.DRAW_TOOLS, Rest hier ergaenzt.
  // Die Werkzeugliste selbst kommt aus DRAW_CATEGORIES — damit koennen
  // Sheet und Desktop-Drawbar nie auseinanderlaufen.
  const GLYPH = {};
  (CONFIG.DRAW_TOOLS || []).forEach(t => { GLYPH[t.overlay] = t.icon; });
  Object.assign(GLYPH, {
    polyline: "⋀", avwap: "⌁", simpleAnnotation: "✎",
    freehand: "✐", positionTool: "⇅",
  });

  // Flache Liste aller Werkzeuge + Positions-Tool
  const tools = [];
  DRAW_CATEGORIES.forEach(cat => cat.tools.forEach(t => tools.push(t)));
  tools.push({ overlay: "positionTool", label: "Long / Short" });

  tools.forEach(t => {
    const item = document.createElement("div");
    item.className = "draw-sheet-item";
    item.dataset.tool = t.overlay;
    item.innerHTML = `<span class="ds-glyph">${GLYPH[t.overlay] || "•"}</span><span>${t.label}</span>`;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      quiet(() => startTool(t.overlay), "draw-sheet " + t.overlay);
      closeSheet();
    });
    grid.appendChild(item);
  });

  // Zeichenstil ist auf dem Handy sonst nicht erreichbar (Drawbar ist aus)
  const styleItem = document.createElement("div");
  styleItem.className = "draw-sheet-item";
  styleItem.innerHTML = `<span class="ds-glyph">◑</span><span>Stil</span>`;
  styleItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSheet();
    quiet(() => toggleDrawStylePopover(), "draw-sheet stil");
  });
  grid.appendChild(styleItem);

  const openSheet = () => {
    document.querySelectorAll(".dd-panel.open").forEach(p => p.classList.remove("open"));
    sheet.classList.remove("hidden");
    syncSheetBackdrop();
  };
  const closeSheet = () => { sheet.classList.add("hidden"); syncSheetBackdrop(); };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    sheet.classList.contains("hidden") ? openSheet() : closeSheet();
  });
  backdrop.addEventListener("click", () => {
    closeSheet();
    document.querySelectorAll(".dd-panel.open").forEach(p => p.classList.remove("open"));
    syncSheetBackdrop();
  });
})();

// Mobile Info-Bar
(function initMobileInfoBar() {
  const mibAsset   = document.getElementById("mibAsset");
  const mibTf      = document.getElementById("mibTf");
  const mibCompare = document.getElementById("mibCompare");
  const wlClose    = document.getElementById("wlCloseBtn");
  if (!mibAsset) return;

  // Taps öffnen die jeweiligen Dropdowns
  mibAsset.addEventListener("click",   () => document.getElementById("assetTrigger")?.click());
  mibTf.addEventListener("click",      () => document.getElementById("tfTrigger")?.click());
  mibCompare?.addEventListener("click",() => document.getElementById("compareTrigger")?.click());

  // Watchlist-Schliessen-Button auf Mobile
  // Watchlist schliessen — gleicher Weg wie der Toggle-Button,
  // damit Zustand, Persistenz und Chart-Resize konsistent bleiben.
  wlClose?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.watchlistOpen = false;
    saveWorkspace();
    renderWatchlist();
    setTimeout(resize, 50);
  });
})();

// ============================================================
// WORKSPACE SPEICHERN

(function initTouch() {
  const el = document.getElementById("mainChart");

  // KLC verwaltet Pinch-Zoom (X-Achse) selbst via _initPinch() — nicht anfassen.
  //
  // Y-ACHSEN-ZOOM: KLineCharts hat dafür auf Touch KEINE Implementierung.
  // Im Bundle verifiziert: touchMoveEvent behandelt `case we` (yAxis) nur mit
  // `a.dispatchEvent("pressedMouseMoveEvent", s)` — die eigentliche Zoom-
  // Rechnung steht ausschliesslich im Desktop-Pfad (pressedMouseMoveEvent des
  // Controllers). Deshalb bauen wir sie hier für Touch nach, mit exakt der
  // gleichen Formel wie Desktop, damit sich beides gleich anfühlt.
  //
  // Geste: EIN Finger vertikal auf der Preisskala ziehen (wie TradingView).
  // Kein Pinch — zwei Finger in einem 80px-Streifen sind auf dem Handy nicht
  // zuverlässig zu treffen.

  const AXIS_W = 80;   // Breite der Preisskala rechts

  const inAxisZone = (touch) => {
    const rect = el.getBoundingClientRect();
    return (touch.clientX - rect.left) > (rect.width - AXIS_W);
  };

  // ---------- Long-Press → Rechtsklick-Menü ----------
  let lpTimer = null, lpStart = null;
  const LP_MS = 500, LP_MOVE = 12;
  const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpStart = null; };

  // ---------- Y-Achsen-Drag-Zoom ----------
  let yDrag = null;        // { startY, base, yAxis }
  let lastAxisTap = 0;     // für Doppeltipp-Erkennung auf der Skala

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { cancelLP(); yDrag = null; return; }
    const t = e.touches[0];

    // Auf der Preisskala: Y-Zoom vorbereiten, kein Long-Press
    if (inAxisZone(t)) {
      cancelLP();
      yDrag = null;

      // Doppeltipp auf die Skala = Auto-Fit (Y-Zoom zurücksetzen).
      // Gegenstück zum Drag: man kommt immer wieder in den Normalzustand.
      const now = Date.now();
      if (now - lastAxisTap < 300) {
        lastAxisTap = 0;
        quiet(() => { autoScaleY(); setStatus("Preisachse zurückgesetzt"); }, "axis dbltap");
        return;
      }
      lastAxisTap = now;

      quiet(() => {
        const pane = chart.getDrawPaneById("candle_pane");
        if (!pane) return;
        const yAxis = pane.getAxisComponent();
        if (!yAxis) return;
        // Nur abbrechen wenn die Methode existiert UND explizit false liefert.
        // Fehlt sie (andere KLC-Version), gilt Zoom als erlaubt.
        if (typeof yAxis.getScrollZoomEnabled === "function" && !yAxis.getScrollZoomEnabled()) return;
        if (typeof yAxis.convertToRealValue !== "function") return;
        const r = yAxis.getRange();
        if (!r || r.range == null) return;
        // Kopie des Startzustands — alle Folgeschritte rechnen relativ dazu,
        // sonst driftet der Zoom bei jedem Frame weiter.
        yDrag = { startY: t.pageY, base: Object.assign({}, r), yAxis };
      }, "yDrag start");
      return;
    }

    // Sonst: normaler Long-Press
    if (state.activeTool) return;
    lpStart = { x: t.clientX, y: t.clientY };
    lpTimer = setTimeout(() => {
      if (!lpStart) return;
      const pos = { x: lpStart.x, y: lpStart.y };
      cancelLP();
      // Ist eine Zeichnung ausgewählt, öffnen wir deren Menü direkt.
      // Ein synthetisches contextmenu-Event bringt nichts: KLineCharts
      // führt dabei keine Treffer-Prüfung auf Overlays durch, das Menü
      // käme also nie zustande.
      if (state.selectedOverlayId) {
        quiet(() => {
          const ov = chart.getOverlayById(state.selectedOverlayId);
          if (ov) openOverlayMenu(ov, { clientX: pos.x, clientY: pos.y, pageX: pos.x, pageY: pos.y });
        }, "long-press overlay menu");
        return;
      }
      // Sonst: normales Kontextmenü des Charts
      el.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
        clientX: pos.x, clientY: pos.y,
      }));
    }, LP_MS);
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];

    // --- Y-Achsen-Zoom aktiv ---
    if (yDrag) {
      quiet(() => {
        const { startY, base, yAxis } = yDrag;
        if (!startY) return;
        // Identische Formel wie KLineCharts Desktop:
        //   scale    = aktuelleY / startY
        //   newRange = ursprünglicheRange * scale
        //   Differenz symmetrisch oben/unten verteilen
        // Nach unten ziehen -> scale > 1 -> Range grösser -> rauszoomen.
        const scale = t.pageY / startY;
        if (!isFinite(scale) || scale <= 0) return;
        const newRange = base.range * scale;
        const w = (newRange - base.range) / 2;
        const from = base.from - w;
        const to   = base.to   + w;
        // WICHTIG: setRange braucht ALLE Felder (from/to/range/realFrom/
        // realTo/realRange). Ein unvollständiges Objekt setzt zwar den State,
        // führt aber zu falschem bzw. gar keinem Rendering.
        const realFrom = yAxis.convertToRealValue(from);
        const realTo   = yAxis.convertToRealValue(to);
        yAxis.setRange({
          from, to, range: newRange,
          realFrom, realTo, realRange: realTo - realFrom,
        });
        // Ohne diesen Aufruf passiert sichtbar NICHTS — setRange allein
        // löst keinen Redraw aus. (Desktop-Pfad macht exakt dasselbe.)
        chart.adjustPaneViewport(false, true, true, true);
        scheduleTagDraw();
      }, "yDrag move");
      return;
    }

    // --- Long-Press abbrechen bei Bewegung ---
    if (lpStart &&
        (Math.abs(t.clientX - lpStart.x) > LP_MOVE ||
         Math.abs(t.clientY - lpStart.y) > LP_MOVE)) {
      cancelLP();
    }
  }, { passive: true });

  // ---------- Doppeltipp löscht die ausgewählte Zeichnung ----------
  // Ersatz für «Rechtsklick → Löschen» auf dem Desktop. Greift nur, wenn
  // wirklich eine Zeichnung ausgewählt ist, und nicht auf der Preisskala
  // (dort ist der Doppeltipp bereits mit Auto-Fit belegt).
  let lastTapTime = 0;
  el.addEventListener("touchend", (e) => {
    const finished = e.touches.length === 0;
    const t = e.changedTouches && e.changedTouches[0];
    const onAxis = t ? inAxisZone(t) : false;
    const now = Date.now();

    if (finished && !onAxis && now - lastTapTime < 320 && state.selectedOverlayId) {
      quiet(() => {
        chart.removeOverlay(state.selectedOverlayId);
        state.selectedOverlayId = null;
        setStatus("Zeichnung gelöscht");
      }, "dbl-tap delete");
      lastTapTime = 0;   // verhindert Dreifach-Auslösung
    } else if (finished) {
      lastTapTime = now;
    }

    if (finished) { cancelLP(); yDrag = null; }
  }, { passive: true });

  el.addEventListener("touchcancel", () => { cancelLP(); yDrag = null; }, { passive: true });
})();
function saveWorkspace() {
  try {
    localStorage.setItem("tv_workspace", JSON.stringify({
      symbol: state.symbol,
      timeframeId: state.timeframe.id,
      active: [...state.active],
      chartType: state.chartType,
      legendCollapsed: state.legendCollapsed,
      _mobileInit:     state._mobileInit,
      // ALLE Watchlisten + welche aktiv ist. Vorher wurde nur state.watchlist
      // (Getter auf die aktive) gespeichert — beim Neuladen waren alle
      // anderen Listen weg.
      watchlists: state.watchlists,
      activeWatchlist: state.activeWatchlist,
      watchlistOpen: state.watchlistOpen,
      // Muster-Strenge (streng/mittel/locker) — wurde geladen, nie gespeichert
      patternOpts: state.patternOpts,
      theme: state.theme,
    currentLayout: state.currentLayout,
    gbOpen: state.gbOpen,
    gbCollapsed: state.gbCollapsed,
    gbProfile: state.gbProfile,
    gbHeight: state.gbHeight,
    gbActiveTier: state.gbActiveTier,
    drawings: state.drawings,
    indOrder: state.indOrder,
    frvpDefaults: state.frvpDefaults,
    gbCapital: state.gbCapital,
    gbTiers: state.gbTiers,
    gbThresholds: state.gbThresholds,
      chartStyle: state.chartStyle,
      drawStyle:  state.drawStyle,
      smcOpts:    state.smcOpts,
    }));
  } catch (e) {
    // QuotaExceededError: localStorage voll (z.B. viele Zeichnungen).
    // Sichtbar machen statt still schlucken.
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
      try { setStatus("⚠ Speicher voll: Workspace konnte nicht gespeichert werden. Zeichnungen reduzieren."); } catch (_) {}
    }
  }
}

// ---------- Watchlist ----------
// ---------- Watchlisten verwalten ----------
function renderWlSelect() {
  const sel = document.getElementById("wlSelect");
  if (!sel) return;
  const names = Object.keys(state.watchlists);
  if (names.length === 0) {
    state.watchlists = { Standard: [] };
    state.activeWatchlist = "Standard";
    return renderWlSelect();
  }
  if (!state.watchlists[state.activeWatchlist]) state.activeWatchlist = names[0];
  sel.innerHTML = names.map(n =>
    `<option value="${n}"${n === state.activeWatchlist ? " selected" : ""}>${n}</option>`).join("");
}

function switchWatchlist(name) {
  if (!state.watchlists[name]) return;
  state.activeWatchlist = name;
  saveWorkspace();
  renderWatchlist();
  restartWatchlistStream();
}

function createWatchlist(name) {
  const n = (name || "").trim();
  if (!n) { setStatus("Name fehlt"); return; }
  if (state.watchlists[n]) { setStatus(`"${n}" existiert bereits`); return; }
  state.watchlists[n] = [];
  state.activeWatchlist = n;
  saveWorkspace();
  renderWlSelect();
  renderWatchlist();
  restartWatchlistStream();
  setStatus(`Watchlist "${n}" angelegt`);
}

function deleteWatchlist(name) {
  const names = Object.keys(state.watchlists);
  if (names.length <= 1) { setStatus("Die letzte Liste kann nicht gelöscht werden"); return; }
  delete state.watchlists[name];
  state.activeWatchlist = Object.keys(state.watchlists)[0];
  saveWorkspace();
  renderWlSelect();
  renderWatchlist();
  restartWatchlistStream();
  setStatus(`"${name}" gelöscht`);
}

function renderWatchlist() {
  const panel = document.getElementById("watchlist");
  const list  = document.getElementById("wlList");
  if (!panel || !list) return;
  panel.classList.toggle("hidden", !state.watchlistOpen);
  renderWlSelect();
  list.innerHTML = "";

  if (state.watchlist.length === 0) {
    list.innerHTML = '<div class="wl-empty">Keine Symbole</div>';
    return;
  }

  state.watchlist.forEach(sym => {
    const p = state.wlPrices[sym];
    const item = document.createElement("div");
    item.className = "wl-item" + (sym === state.symbol.id ? " active" : "");

    const label = sym.replace("USDT", "/USDT");
    const priceStr = p && p.price != null
      ? p.price.toLocaleString("de-CH", { maximumFractionDigits: p.price < 10 ? 4 : 2 })
      : "–";
    const chg = p && p.changePct != null ? p.changePct : null;
    const chgStr = chg != null ? (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%" : "–";
    const chgClass = chg == null ? "" : chg >= 0 ? "up" : "down";

    item.innerHTML = `
      <div class="wl-sym">${label}</div>
      <div class="wl-vals">
        <span class="wl-price">${priceStr}</span>
        <span class="wl-chg ${chgClass}">${chgStr}</span>
      </div>
      <button class="wl-remove" title="Entfernen">✕</button>`;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".wl-remove")) return;
      const found = state.allSymbols.find(s => s.id === sym);
      if (found) switchSymbol(found);
    });
    item.querySelector(".wl-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      state.watchlist = state.watchlist.filter(s => s !== sym);
      saveWorkspace();
      renderWatchlist();
      restartWatchlistStream();
    });
    list.appendChild(item);
  });
}

function renderWlSearch(filter = "") {
  const box = document.getElementById("wlResults");
  if (!box) return;
  box.innerHTML = "";
  const f = filter.toUpperCase().trim();
  if (!f) { box.innerHTML = '<div class="wl-empty">Tippen zum Suchen</div>'; return; }
  const items = state.allSymbols
    .filter(s => s.type === "binance" && s.id.includes(f) && !state.watchlist.includes(s.id))
    .slice(0, 20);
  if (items.length === 0) { box.innerHTML = '<div class="wl-empty">Nichts gefunden</div>'; return; }
  items.forEach(s => {
    const r = document.createElement("div");
    r.className = "wl-result";
    r.textContent = s.label;
    r.addEventListener("click", () => {
      if (!state.watchlist.includes(s.id)) {
        state.watchlist.push(s.id);
        saveWorkspace();
        renderWatchlist();
        restartWatchlistStream();
      }
      document.getElementById("wlSearchBox").classList.add("hidden");
      document.getElementById("wlSearch").value = "";
    });
    box.appendChild(r);
  });
}

// Initiale 24h-Daten holen (Preis + Änderung)
async function loadWatchlistPrices() {
  if (state.watchlist.length === 0) return;
  try {
    const ticks = await DataLayer.fetchTicker24h(state.watchlist);
    ticks.forEach(t => { state.wlPrices[t.symbol] = { price: t.price, changePct: t.changePct }; });
    renderWatchlist();
  } catch (e) { /* Netzfehler: Liste bleibt ohne Preise */ }
}

// Live-Updates via miniTicker (ein Socket für alle Symbole)
function restartWatchlistStream() {
  if (state.wlCloseStream) { state.wlCloseStream(); state.wlCloseStream = null; }
  if (state.watchlist.length === 0) return;
  loadWatchlistPrices();
  const wanted = new Set(state.watchlist);
  state.wlStreamOk = false;
  state.wlCloseStream = DataLayer.openMiniTickerStream((ticks) => {
    let changed = false;
    ticks.forEach(t => {
      if (!wanted.has(t.symbol)) return;
      const prev = state.wlPrices[t.symbol] || {};
      state.wlPrices[t.symbol] = {
        price: t.price,
        // 24h-Änderung aus miniTicker: (close - open) / open
        changePct: t.open ? ((t.price - t.open) / t.open) * 100 : prev.changePct,
      };
      changed = true;
    },
    (s) => {
      state.wlStreamOk = s === "live";
      if (state.wlStreamOk) setLive("live", "Live");
    }
  );
    if (changed) requestAnimationFrame(renderWatchlist);
  });
}

// ---------- Symbol-Wechsel (zentral, auch von Watchlist genutzt) ----------
function switchSymbol(sym) {
  // 2.8: Zeichnungen gehören zum Asset, nicht zum Chart. Ein FRVP oder
  // eine Fibonacci auf BTC-Preisen ist auf ETH schlicht falsch — die
  // Preisniveaus haben dort keine Bedeutung. Also weg damit.
  clearAllDrawings();

  state.symbol = sym;
  saveWorkspace();
  document.getElementById("assetLabel").textContent = sym.label;
  document.getElementById("assetPanel").classList.remove("open");
  if (sym.type === "worker") state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
  // Kraken: Falls aktives TF kein krakenInterval hat (z.B. 1M), auf 1D wechseln
  if (sym.type === "kraken" && !state.timeframe.krakenInterval) {
    state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
  }
  // Coinbase: kein W/M — auf 1D wechseln falls nötig
  if (sym.type === "coinbase" && !state.timeframe.coinbaseInterval) {
    state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
  }
  // Bybit: alle TFs unterstützt, aber sicherheitshalber Guard
  if (sym.type === "bybit" && !state.timeframe.bybitInterval) {
    state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
  }
  renderTfList();
  renderCompareList();
  renderWatchlist();
  loadData();
  reloadAllCompareData();
}

// Alle User-Zeichnungen entfernen. Grid-Bänder und Muster bleiben, die
// werden vom jeweiligen Modul selbst verwaltet.
function clearAllDrawings() {
  // removeOverlay() ohne id löscht ALLE Overlays. chart.getOverlayStore()
  // existiert in 9.8.12 nicht — der frühere Versuch lief still ins Leere.
  try { chart.removeOverlay(); } catch (e) {}
  state.drawings = [];
  state.patternOverlayIds = [];
  state.smcOverlayIds = [];
  state.gbActiveTier = null;
  state.selectedOverlayId = null;
  state.drawingId = null;
}

// ---------- Lazy Loading: ältere Kerzen beim Zurückscrollen ----------
// KLineCharts ruft diesen Callback selbst auf, sobald der User an den
// linken Rand scrollt (type "forward"). callback(daten, mehr?) liefert
// die Daten zurück; more=false stoppt weitere Anfragen.
chart.setLoadDataCallback(async ({ type, data, callback }) => {
  // Nur ältere Daten (forward = nach links), nur Binance, nicht im Replay
  if (type !== "forward" || !data) { callback([], false); return; }
  const exType = state.symbol.type;
  if (exType !== "binance" && exType !== "kraken" && exType !== "coinbase" && exType !== "bybit") { callback([], false); return; }

  setStatus("Lade ältere Kerzen …");
  try {
    let older;
    if (exType === "kraken") {
      older = await DataLayer.fetchKrakenKlinesBefore(
        state.symbol.krakenPair, state.timeframe.krakenInterval,
        data.timestamp, CONFIG.LAZY_LOAD_CHUNK
      );
    } else if (exType === "coinbase") {
      older = await DataLayer.fetchCoinbaseKlinesBefore(
        state.symbol.coinbaseProduct, state.timeframe.coinbaseInterval,
        data.timestamp, CONFIG.LAZY_LOAD_CHUNK
      );
    } else if (exType === "bybit") {
      older = await DataLayer.fetchBybitKlinesBefore(
        state.symbol.bybitSymbol, state.timeframe.bybitInterval,
        data.timestamp, CONFIG.LAZY_LOAD_CHUNK
      );
    } else {
      older = await DataLayer.fetchBinanceKlinesBefore(
        state.symbol.id, state.timeframe.binanceInterval,
        data.timestamp, CONFIG.LAZY_LOAD_CHUNK
      );
    }
    const more = older.length >= CONFIG.LAZY_LOAD_CHUNK;
    callback(older, more);
    setTimeout(() => {
      const total = chart.getDataList().length;
      setStatus(`${total} Candles · ${state.symbol.label} · ${state.timeframe.label}`
        + (more ? "" : " · Historie vollständig"));
      if (state.active.has("vrvp")) requestAnimationFrame(drawVrvp);
    }, 50);
  } catch (e) {
    setStatus("Nachladen fehlgeschlagen");
    callback([], false);
  }
});

// Labels aus dem State setzen. Nötig nach Workspace-/Layout-Restore, sonst
// zeigt die Topbar die statischen HTML-Defaults (1D, BTC/USDT, Kerzen)
// statt der wiederhergestellten Auswahl.
function syncLabels() {
  const a = document.getElementById("assetLabel");
  const t = document.getElementById("tfLabel");
  const c = document.getElementById("typeLabel");
  if (a) a.textContent = state.symbol.label;
  if (t) t.textContent = state.timeframe.label;
  if (c) c.textContent = state.chartType === "area" ? "Linie" : "Kerzen";
}

// ============================================================
// GRID BOT
// Liest die Marktdaten aus dem Chart (Preis, SMA, RSI, ATR — alles
// schon vorhanden), holt die Derivate-Daten dazu und rechnet die
// Cockpit-Logik. Die Bänder im Chart überleben das Schliessen der
// Leiste bewusst: sonst müsste man sie offen halten, nur um die
// Visualisierung zu sehen.
// ============================================================

// ---------- Marktdaten aus den Chart-Daten rechnen ----------
// Eigene Berechnung statt Zugriff auf die Indikator-Instanzen: die
// sind nur da, wenn der User sie aktiviert hat. Der Grid Bot soll
// auch ohne aktiven ATR200 funktionieren.
// gbMarketData: berechnet alle Bot-Inputs aus Chart-Daten.
// dailyD: optionale Tages-Kerzen für ATR/SMA/ER. Wenn vorhanden, basieren
// diese Metriken immer auf Tagesdaten — unabhängig vom aktiven Chart-Timeframe.
// Ohne dailyD Fallback auf Chart-Kerzen (wie bisher).
function gbMarketData(dailyD) {
  const d = chart.getDataList();
  if (!d || d.length < 10) return null;

  // Preis und Volumen immer aus den aktuellen Chart-Kerzen (aktuellster Tick)
  const closes = d.map(x => x.close);
  const price = closes.at(-1);
  if (!price) return null;

  // Für ATR/SMA/ER: Tages-Kerzen bevorzugen wenn vorhanden, sonst Chart-Kerzen.
  // Das stellt sicher dass ATR14/90/200 immer tägliche Volatilität misst —
  // unabhängig davon ob der Chart auf 15m, 4h oder 1D steht.
  const base = (dailyD && dailyD.length >= 50) ? dailyD : d;
  const baseCloses = base.map(x => x.close);

  const sma = (n) => {
    if (baseCloses.length < n) return null;
    const s = baseCloses.slice(-n);
    return s.reduce((a, b) => a + b, 0) / n;
  };

  // Kaufman Efficiency Ratio auf Tages-Basis (auf 15m/4h-Kerzen zu rauschig)
  const efficiencyRatio = (period = 20) => {
    if (baseCloses.length < period + 1) return null;
    const seg = baseCloses.slice(-(period + 1));
    const direction = Math.abs(seg[seg.length - 1] - seg[0]);
    let volatility = 0;
    for (let i = 1; i < seg.length; i++) volatility += Math.abs(seg[i] - seg[i - 1]);
    return volatility > 0 ? direction / volatility : 0;
  };

  // RSI 14 nach Wilder aus Chart-Kerzen (Preis-Impuls ist TF-sensitiv, OK so)
  const rsiWilder = (period = 14) => {
    if (closes.length < period + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch > 0) gain += ch; else loss -= ch;
    }
    let ag = gain / period, al = loss / period;
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      ag = (ag * (period - 1) + (ch > 0 ? ch : 0)) / period;
      al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    }
    if (al === 0) return 100;
    return 100 - 100 / (1 + ag / al);
  };

  // ATR nach Wilder auf base (Tages-Kerzen wenn vorhanden), in % vom Preis
  const atrPct = (period) => {
    if (base.length < period + 1) return null;
    const tr = [];
    for (let i = 1; i < base.length; i++) {
      tr.push(Math.max(
        base[i].high - base[i].low,
        Math.abs(base[i].high - base[i - 1].close),
        Math.abs(base[i].low  - base[i - 1].close)
      ));
    }
    let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
    for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
    return (a / price) * 100;
  };

  // Volumen-Signal aus Chart-Kerzen (aktuellster TF, passt so)
  const vols = d.map(x => x.volume || 0);
  const volMa = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volSignal = vols.at(-1) > volMa * 2 ? "🔥 Volumen-Spike (Achtung Trendwende/Ausbruch)"
                  : vols.at(-1) < volMa * 0.5 ? "😴 Volumen-Flaute" : "➖ Volumen normal";

  const a14 = atrPct(14), a90 = atrPct(90), a200 = atrPct(200);
  const context = (a14 != null && a90 != null)
    ? (a14 < a90 * 0.8 ? "Volatilitäts-Kontraktion (Kompression)"
     : a14 > a90 * 1.3 ? "Volatilitäts-Expansion" : "Normale Volatilität")
    : "—";

  const sma200v = sma(200);
  return {
    price, sma50: sma(50), sma200: sma200v, rsi: rsiWilder(14),
    atr14: a14, atr90: a90, atr200: a200,
    volumeSignal: volSignal, marketContext: context,
    mayer: sma200v ? price / sma200v : null,
    er: efficiencyRatio(20),
    dailyDataUsed: base !== d,
  };
}

// ---------- Rechnen und rendern ----------
async function gbRefresh(force) {
  // Tages-Kerzen separat holen — ATR/SMA/ER sollen immer auf Tagesdaten basieren,
  // unabhängig davon welchen Chart-Timeframe der Nutzer gerade anschaut.
  // 200 Kerzen reichen für ATR200 + SMA200 + ER20. Nur für Binance-Symbole;
  // bei anderen Exchanges (Kraken, Coinbase, Bybit) wird mit Chart-Daten gerechnet.
  let dailyD = null;
  try {
    if (state.symbol.type === "binance") {
      dailyD = await DataLayer.fetchBinanceKlines(state.symbol.id, "1d", 210);
    } else if (state.symbol.type === "bybit") {
      dailyD = await DataLayer.fetchBybitKlines(state.symbol.bybitSymbol, "D", 210);
    } else if (state.symbol.type === "kraken") {
      dailyD = await DataLayer.fetchKrakenKlines(state.symbol.krakenPair, "1440", 210);
    }
  } catch (e) { dailyD = null; }   // Fallback: Chart-Kerzen

  const market = gbMarketData(dailyD);
  if (!market) { setStatus("Grid Bot: zu wenig Chart-Daten (200+ Kerzen nötig)"); return; }

  if (force) Derivatives.clearCache();
  document.getElementById("gbUpdated").textContent = "lädt…";

  let deriv = { funding: null, oi: null, ls: null, fng: null, errors: [] };
  try {
    deriv = await Derivatives.fetchAll(state.symbol.value);
  } catch (e) {
    deriv.errors = [String(e.message || e)];
  }

  const opts = {
    capital: state.gbCapital,
    riskPct: null,                       // null -> Risiko-Budget kommt aus dem Profil
    feePct:  GridBot.getThresholds().feeRoundtrip,
    tiers:   state.gbTiers,
  };
  GridBot.setThresholds(state.gbThresholds);
  state.gbResult = GridBot.compute(market, deriv, opts);

  gbRenderStatus();
  gbRenderTiers();
  gbRenderData();
  if (state.gbActiveTier) gbDrawBands(state.gbActiveTier);
}

function gbRenderStatus() {
  const r = state.gbResult;
  if (!r) return;

  // Die Statuszeile beantwortet in einem Blick: soll ich überhaupt?
  const rec = r.recommendation || {};
  const pill = document.getElementById("gbHeadline");
  const short = { defensive: "Defensiv", "accumulate-spot": "Spot/DCA", "accumulate-grid": "Makro-Grid",
                  range: "Kurzfrist", "long-bias": "Long-Bias", wait: "Beobachten" }[rec.stage] || "—";
  pill.textContent = short;
  pill.className = "gb-pill " + ({ defensive: "stop", "accumulate-spot": "long", "accumulate-grid": "long",
                                   range: "", "long-bias": "long", wait: "wait" }[rec.stage] || "");

  const set = (id, txt, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    el.className = "gb-stat" + (cls ? " " + cls : "");
  };

  const m = r.mayer;
  set("gbRegime", m != null ? "Mayer " + m.toFixed(2) : "Mayer –",
      m == null ? "" : m > GridBot.CYCLE.mayerExpensive ? "warn" : m < GridBot.CYCLE.mayerCheap ? "good" : "");

  const er = r.er;
  set("gbRsi", er != null ? "ER " + er.toFixed(2) : "ER –",
      er == null ? "" : er >= GridBot.CYCLE.erTrend ? "warn" : er < GridBot.CYCLE.erRange ? "good" : "");

  const fng = r.derivatives?.fng;
  set("gbFunding", fng != null ? "F&G " + fng : "F&G –",
      fng == null ? "" : fng > GridBot.CYCLE.fngGreed ? "warn" : fng < GridBot.CYCLE.fngFear ? "good" : "");

  const rsi = r.market?.rsi;
  set("gbFng", rsi != null ? "RSI " + rsi.toFixed(0) : "RSI –",
      rsi == null ? "" : (rsi >= 75 || rsi <= 25) ? "warn" : "");

  document.getElementById("gbUpdated").textContent = state.gbUpdated || "";

  // Zyklus-Ampel in der Topbar synchron aktualisieren
  updateCycleBar(r);
}

// Zyklus-Ampel: 5 farbige Kürzel-Pills, Klick öffnet Popover mit Details.
// Reihenfolge: F&G → OI → Fund → M → ER
function updateCycleBar(r) {
  if (!r) return;

  // Daten aus gbResult
  const fng   = r.derivatives?.fng ?? null;
  const oi30  = r.derivatives?.oiChange30 ?? null;
  const fund  = r.derivatives?.funding8h ?? null;
  const m     = r.mayer ?? r.market?.mayer ?? null;
  const er    = r.market?.er ?? r.er ?? null;

  const TH = GridBot.DEFAULT_THRESHOLDS;
  const CY = GridBot.CYCLE;

  // Farbklasse je Indikator
  const cls = {
    fng:  fng  == null ? "" : fng  < CY.fngFear    ? "good" : fng  > CY.fngGreed        ? "warn" : "neut",
    oi:   oi30 == null ? "" : oi30 < TH.oiChangeLow ? "good" : oi30 > TH.oiChangeHigh   ? "warn" : "neut",
    fund: fund == null ? "" : fund < TH.fundingLong  ? "good" : fund > TH.fundingShort   ? "warn" : "neut",
    m:    m    == null ? "" : m    < CY.mayerCheap   ? "good" : m    > CY.mayerExpensive ? "warn" : "neut",
    er:   er   == null ? "" : er   < CY.erRange      ? "good" : er   > CY.erTrend        ? "warn" : "neut",
  };

  // Popover-Inhalte je Pill
  const PILLS = {
    fng: {
      label: "Fear & Greed (0–100)",
      value: fng != null ? String(fng) : "–",
      desc: fng == null ? "Keine Daten"
        : fng < CY.fngFear   ? "Angst — historische Akkumulationszone"
        : fng > CY.fngGreed  ? "Gier — defensiv werden, Hebel-Leitplanke aktiv"
        : "Neutral",
    },
    oi: {
      label: "Open Interest Δ30T",
      value: oi30 != null ? (oi30 > 0 ? "+" : "") + oi30.toFixed(1) + "%" : "–",
      desc: oi30 == null ? "Keine Daten"
        : oi30 < TH.oiChangeLow ? "Leverage bereinigt — Markt sauberer, Grid ruhiger"
        : oi30 > TH.oiChangeHigh ? "Starker Leverage-Aufbau — Liquidationsrisiko steigt"
        : "Neutral / aufbauend",
    },
    fund: {
      label: "Funding Rate 8h",
      value: fund != null ? fund.toFixed(4) + "%" : "–",
      desc: fund == null ? "Keine Daten"
        : fund < TH.fundingLong  ? "Shorts zahlen — contrarian bullisch"
        : fund > TH.fundingShort ? "Longs zahlen teuer — überfüllte Seite"
        : "Normal",
    },
    mayer: {
      label: "Mayer Multiple (P/SMA200)",
      value: m != null ? m.toFixed(2) : "–",
      desc: m == null ? "Keine Daten"
        : m < CY.mayerCheap     ? "Unter SMA200 — historisch jeder BTC-Akkumulationsboden"
        : m > CY.mayerExpensive ? "Teuer — Hebel-Leitplanke aktiv (max. 1×)"
        : "Normaler Bereich",
    },
    er: {
      label: "Efficiency Ratio (0–1)",
      value: er != null ? er.toFixed(2) : "–",
      desc: er == null ? "Keine Daten"
        : er < CY.erRange ? "Range — Grid ideal"
        : er > CY.erTrend ? "Trend — Grid riskant, reduzierte Füllrate"
        : "Übergang",
    },
  };

  // Pills setzen (nur Kürzel + Farbe)
  const pills = [
    ["cycleFng",   cls.fng],
    ["cycleOi",    cls.oi],
    ["cycleFund",  cls.fund],
    ["cycleMayer", cls.m],
    ["cycleEr",    cls.er],
  ];
  pills.forEach(([id, c]) => {
    const el = document.getElementById(id);
    if (el) el.className = "cycle-pill" + (c ? " " + c : "");
  });

  // Popover-Daten auf Pills schreiben (für Klick-Handler)
  document.querySelectorAll(".cycle-pill").forEach(pill => {
    const key = pill.dataset.pill === "mayer" ? "mayer" : pill.dataset.pill;
    const data = PILLS[key];
    if (data) {
      pill._cycleData  = data;
      pill._cycleColor = cls[pill.dataset.pill === "mayer" ? "m" : pill.dataset.pill] || "";
    }
  });
}

// Popover-Logik: einmalig beim Start verdrahten
(function initCyclePopover() {
  const popover = document.getElementById("cyclePopover");
  if (!popover) return;
  let closeTimer = null;

  const closePopover = () => {
    popover.classList.add("hidden");
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  };

  document.querySelectorAll(".cycle-pill").forEach(pill => {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      const data = pill._cycleData;
      if (!data) return;

      // Popover befüllen
      document.getElementById("cyclePopoverLabel").textContent = data.label;
      const valEl = document.getElementById("cyclePopoverValue");
      valEl.textContent = data.value;
      valEl.className = "cp-value" + (pill._cycleColor ? " " + pill._cycleColor : "");
      document.getElementById("cyclePopoverDesc").textContent = data.desc;

      // Position: unter der geklickten Pill
      popover.classList.remove("hidden");
      const pr = pill.getBoundingClientRect();
      const pw = popover.offsetWidth || 200;
      let left = pr.left;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      popover.style.left = Math.max(8, left) + "px";
      popover.style.top  = (pr.bottom + 6) + "px";

      // Auto-close nach 5 Sekunden
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(closePopover, 5000);
    });
  });

  // Klick ausserhalb schliesst Popover
  document.addEventListener("click", closePopover);
})();

function gbRenderTiers() {
  const r = state.gbResult;
  const t = document.getElementById("gbTiers");
  const box = document.getElementById("gbRecoBox");
  if (!r || !r.tiers.length) {
    t.innerHTML = '<tbody><tr><td class="lbl">Keine Daten</td></tr></tbody>';
    if (box) box.innerHTML = "";
    return;
  }

  // ---- Empfehlung: die eine Aussage, um die es geht ----
  const rec = r.recommendation || {};
  const stageClass = { defensive: "reco-stop", "accumulate-spot": "reco-go", "accumulate-grid": "reco-go",
                       range: "reco-go", "long-bias": "reco-go", wait: "reco-wait" }[rec.stage] || "reco-wait";
  if (box) {
    box.className = "gb-reco " + stageClass;
    box.innerHTML = `<div class="reco-main">${rec.label || "—"}</div>`
      + `<div class="reco-why">${rec.why || ""}</div>`
      + `<div class="reco-meta">`
        + `<span>Grid-Eignung: <b>${r.gridSuitability?.label || "—"}</b></span>`
        + `<span>Profil: <b>${r.profile?.name || "—"}</b></span>`
        + (r.tiers.some(x => x.leverageGuard) ? `<span class="reco-guard">⚠ Hebel-Leitplanke aktiv → max 1×</span>` : "")
      + `</div>`;
  }

  const fmt = (n) => n == null ? "–" : n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
  const sign = (n) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

  // Nur was man in Pionex tatsächlich eintippt oder zum Entscheiden braucht.
  // Alles andere (Scores, ATR, Faktoren) rechnet im Hintergrund.
  const rows = [
    ["Range oben",   (x) => fmt(x.upper)],
    ["Range unten",  (x) => fmt(x.lower)],
    ["Grids",        (x) => x.grids],
    ["Hebel",        (x) => x.leverage + "×" + (x.leverageGuard ? " ⚠" : "")],
    ["Investment",   (x) => fmt(x.positionSize) + " USDT"],
    ["Stop Loss",    (x) => fmt(x.stopLoss)],
    ["Sicherheit",   (x) => x.safety],
    ["Netto-Erwartung", (x) => x.viability ? sign(x.viability.net) : "–"],
  ];

  const nCols = r.tiers.length + 1;
  let html = "<thead><tr><th></th>" + r.tiers.map(x => {
    const isReco = rec.tier === x.id;
    return `<th class="tier-head${isReco ? " tier-reco" : ""}">${x.label}${isReco ? " ★" : ""}<span class="tier-hz">${x.horizon}</span></th>`;
  }).join("") + "</tr></thead><tbody>";

  rows.forEach(([lbl, fn]) => {
    html += `<tr><td class="lbl">${lbl}</td>` + r.tiers.map(x => {
      const isReco = rec.tier === x.id;
      let cls = isReco ? "on" : "";
      if (lbl === "Netto-Erwartung" && x.viability && !x.viability.ok) cls = "neg";
      return `<td${cls ? ` class="${cls}"` : ""}>${fn(x)}</td>`;
    }).join("") + "</tr>";
  });

  html += '<tr><td class="lbl"></td>' + r.tiers.map(x =>
    `<td><button class="gb-show${state.gbActiveTier === x.id ? " active" : ""}" data-tier="${x.id}">${state.gbActiveTier === x.id ? "Im Chart ✓" : "Im Chart"}</button></td>`
  ).join("") + "</tr></tbody>";
  t.innerHTML = html;

  t.querySelectorAll(".gb-show").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.tier;
      state.gbActiveTier = state.gbActiveTier === id ? null : id;
      saveWorkspace();
      gbRenderTiers();
      gbDrawBands(state.gbActiveTier);
    });
  });

  const w = document.getElementById("gbWarning");
  w.textContent = r.missing.length ? "Quellen fehlen: " + r.missing.join(", ") : "";
  w.className = "gb-note" + (r.missing.length ? " warn" : "");
}

function gbRenderData() {
  const r = state.gbResult;
  const box = document.getElementById("gbData");
  if (!r) return;
  const n = (v, d = 2, suf = "") => v == null ? "–" : v.toFixed(d) + suf;
  const blk = (title, kvs) =>
    `<div><div class="gb-blk-title">${title}</div>` +
    kvs.map(([k, v]) => `<div class="gb-kv"><span>${k}</span><span>${v}</span></div>`).join("") + "</div>";

  box.innerHTML =
    blk("Markt & Trend", [
      ["Preis", n(r.market.price, 0)],
      ["SMA50", n(r.market.sma50, 0)],
      ["SMA200", n(r.market.sma200, 0)],
      ["Abstand SMA200", n(r.market.sma200Dist, 2, "%")],
      ["RSI14 (Wilder)", n(r.market.rsi, 1)],
      ["ATR14 / 90 / 200", `${n(r.market.atr14)} / ${n(r.market.atr90)} / ${n(r.market.atr200)}`],
      ["Volumen", r.market.volumeSignal],
    ]) +
    blk("Sentiment & Derivate", [
      ["Fear & Greed", r.derivatives.fng != null ? `${r.derivatives.fng} (${r.derivatives.fngLabel})` : "–"],
      ["F&G Ø30 / Ø90", `${n(r.derivatives.fngAvg30, 1)} / ${n(r.derivatives.fngAvg90, 1)}`],
      ["Funding 8h", n(r.derivatives.funding8h, 4, "%")],
      ["Funding monatlich", n(r.derivatives.fundingMonthly, 2, "%")],
      ["Open Interest", r.derivatives.oiNow != null ? n(r.derivatives.oiNow, 0) + " BTC" : "–"],
      ["OI Δ30T / Δ90T", `${n(r.derivatives.oiChange30, 2, "%")} / ${n(r.derivatives.oiChange90, 2, "%")}`],
      ["L/S Ratio", n(r.derivatives.lsRatio, 4)],
      ["OI-Interpretation", r.oiInterpretation],
    ]) +
    blk("Konfluenz", [
      ["Trend-Score", r.confluence.trendScore ?? "–"],
      ["Derivate-Score", r.confluence.derivativeScore ?? "–"],
      ["Summe", r.confluence.sum ?? "–"],
      ["Extrem-Filter", r.confluence.extreme],
      ["Roh-Bias (vor Filter)", r.rawBias],
      ["Bias (final)", r.bias],
      ["Regime", r.regime],
    ]);
}

// ---------- Grid-Bänder im Chart ----------
function gbClearBands() {
  (state.gbBandIds || []).forEach(id => { try { chart.removeOverlay(id); } catch (e) {} });
  state.gbBandIds = [];
}

// ---------- Einstellungs-Felder ----------
function gbRenderSettings() {
  const box = document.getElementById("gbPaneSettings");
  if (!box) return;

  // Vier Felder. Der Rest ist bewusst fest.
  //
  // Aus der Parameter-Referenz zum Dashboard:
  //   "Schwellen nie direkt ändern (fest in Formel).
  //    Aggressivität über Profil (I16) steuern."
  //
  // Der Grund: Mayer < 0.9 traf jeden Akkumulations-Boden seit 2015. Wer
  // die Schwelle hochdreht, weil "Defensiv" erscheint, senkt nicht das
  // Risiko — nur die Warnung. Die Werte, die hier stehen dürfen, sind die
  // über DEIN Setup (Kapital, Börse), nicht die über den Markt.
  const th = GridBot.getThresholds();
  const prof = GridBot.profileValues();

  box.innerHTML = `
    <div class="gb-set-wrap">
      <div class="gb-set-block">
        <div class="gb-set-title">Dein Setup</div>
        <label>Kapital (USDT)<input type="number" id="gbCapital" value="${state.gbCapital}" min="10" step="100"></label>
        <label>Gebühr Roundtrip %<input type="number" id="gbFee" value="${th.feeRoundtrip}" min="0" max="1" step="0.01"></label>
        <label>Füllungen je Grid/Monat<input type="number" id="gbFills" value="${th.fillsPerGrid}" min="1" max="8" step="1"></label>
      </div>

      <div class="gb-set-block">
        <div class="gb-set-title">Aggressivität</div>
        <label>Risiko-Profil<select id="gbProfile">
          ${Object.keys(GridBot.PROFILES).map(p =>
            `<option value="${p}"${p === prof.name ? " selected" : ""}>${p}</option>`).join("")}
        </select></label>
        <div class="gb-prof-info" id="gbProfInfo"></div>
      </div>
    </div>

    <div class="gb-set-note">
      Alle Schwellwerte — Mayer 0.9 / 2.0, Fear&amp;Greed 35 / 80, ER 0.3 / 0.5, RSI 25 / 75 —
      sind bewusst fest verdrahtet und nicht editierbar. Sie sind historisch kalibriert:
      Mayer unter 0.9 traf jeden BTC-Akkumulationsboden seit 2015. Wer sie verschiebt, weil
      das Ergebnis nicht gefällt, senkt nicht das Risiko, sondern nur die Warnung.
      Aggressivität steuerst du über das Profil. Was genau gerechnet wird, steht im FAQ.
    </div>
  `;

  const renderProfInfo = () => {
    const p = GridBot.PROFILES[document.getElementById("gbProfile").value];
    document.getElementById("gbProfInfo").innerHTML =
      `<div class="pi-row"><span>Hebel max</span><b>${p.leverageCap}×</b></div>`
      + `<div class="pi-row"><span>Risiko je Bot</span><b>${p.riskBudget}%</b></div>`
      + `<div class="pi-row"><span>Gap-Puffer</span><b>${p.gapBuffer}%</b></div>`;
  };
  renderProfInfo();

  document.getElementById("gbProfile").addEventListener("change", (e) => {
    GridBot.setProfile(e.target.value);
    state.gbProfile = e.target.value;
    renderProfInfo();
    saveWorkspace();
    gbRefresh();
  });

  const num = (id, key) => {
    document.getElementById(id).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      if (key === "capital") { state.gbCapital = v; }
      else { GridBot.setThresholds({ [key]: v }); state.gbThresholds = GridBot.getThresholds(); }
      saveWorkspace();
      gbRefresh();
    });
  };
  num("gbCapital", "capital");
  num("gbFee", "feeRoundtrip");
  num("gbFills", "fillsPerGrid");
}

function gbDrawBands(tierId) {
  gbClearBands();
  if (!tierId || !state.gbResult) return;
  const t = state.gbResult.tiers.find(x => x.id === tierId);
  if (!t) return;

  const d = chart.getDataList();
  if (!d || !d.length) return;
  const ts = d[Math.max(0, d.length - 200)].timestamp;

  try {
    const id = chart.createOverlay({
      name: "gridBands",
      points: [{ timestamp: ts, value: t.upper }, { timestamp: d.at(-1).timestamp, value: t.lower }],
      lock: true,
      onMouseEnter: () => { setChartCursor("pointer"); return false; },
      onMouseLeave: () => { setChartCursor(""); return false; },
      extendData: {
        lower: t.lower, upper: t.upper, grids: t.grids, stopLoss: t.stopLoss,
        takeProfit: t.takeProfit, label: t.label, direction: t.direction, leverage: t.leverage,
      },
    });
    if (id) state.gbBandIds.push(id);
  } catch (e) {}
}

// Höhe der Leiste per Handle verstellbar — damit man alle Zahlen
// ohne Scrollen sehen kann, wenn man will.
function gbInitResize() {
  const handle = document.getElementById("gbResize");
  const bar = document.getElementById("gridBotBar");
  let dragging = false, startY = 0, startH = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const max = document.querySelector(".chart-col").clientHeight - 160;
    const h = Math.max(34, Math.min(max, startH + (startY - y)));
    bar.style.height = h + "px";
    state.gbHeight = h;
    resize();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    saveWorkspace();
  };

  const onDown = (e) => {
    dragging = true;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = bar.getBoundingClientRect().height;
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  };

  handle.addEventListener("mousedown", onDown);
  handle.addEventListener("touchstart", onDown, { passive: false });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchend", onUp);
}

function gbApplyHeight() {
  const bar = document.getElementById("gridBotBar");
  if (state.gbCollapsed) { bar.style.height = ""; return; }
  bar.style.height = (state.gbHeight || 250) + "px";
}

function gbToggleBar(show) {
  const bar = document.getElementById("gridBotBar");
  const on = show != null ? show : bar.classList.contains("hidden");
  bar.classList.toggle("hidden", !on);
  document.getElementById("gbResize").classList.toggle("hidden", !on || state.gbCollapsed);
  document.getElementById("gridBotBtn").classList.toggle("active", on);
  if (on) gbApplyHeight();
  state.gbOpen = on;
  saveWorkspace();
  resize();
  if (on && !state.gbResult) gbRefresh(false);
}

function gbSetCollapsed(c) {
  document.getElementById("gbBody").classList.toggle("collapsed", c);
  document.getElementById("gbResize").classList.toggle("hidden", c || !state.gbOpen);
  document.getElementById("gbChev").innerHTML = c
    ? '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  state.gbCollapsed = c;
  gbApplyHeight();
  saveWorkspace();
  resize();
}

// ---------- Fibonacci-Einstellungen ----------
// Levels aus config.js — dieselbe Quelle wie overlays.js zum Zeichnen.
const FIB_MENU_LEVELS = FIB_LEVEL_SETS;

let _fibTargetId = null;
let _fibTargetName = null;

function openFibMenu(event) {
  const ov = event?.overlay;
  if (!ov) return;
  _fibTargetId = ov.id;
  _fibTargetName = ov.name;
  const ed = ov.extendData || {};

  document.getElementById("fibMenuTitle").textContent =
    ov.name === "fibExtension" ? "Fibonacci Extension" : "Fibonacci Retracement";

  document.getElementById("fibShowLabels").checked  = ed.showLabels  !== false;
  document.getElementById("fibShowLevels").checked  = ed.showLevels  !== false;
  document.getElementById("fibShowPrices").checked  = ed.showPrices  !== false;
  document.getElementById("fibShowFill").checked    = ed.showFill    !== false;
  document.getElementById("fibExtendRight").checked = ed.extendRight === true;
  const op = ed.fillOpacity != null ? ed.fillOpacity : 5;
  document.getElementById("fibFillOpacity").value = op;
  document.getElementById("fibFillVal").textContent = op + "%";
  document.getElementById("fibLineWidth").value = ed.lineWidth || 1;

  // Level-Checkboxen
  const box = document.getElementById("fibLevels");
  box.innerHTML = "";
  const hidden = ed.hiddenLevels || {};
  (FIB_MENU_LEVELS[ov.name] || FIB_MENU_LEVELS.fibRetracement).forEach(lv => {
    const l = document.createElement("label");
    l.className = "fib-lv";
    l.innerHTML = `<input type="checkbox" data-lv="${lv.v}" ${hidden[String(lv.v)] ? "" : "checked"}>
                   <span class="fib-lv-dot" style="background:${lv.color}"></span>${lv.v}`;
    box.appendChild(l);
  });

  const menu = document.getElementById("fibMenu");
  menu.classList.remove("hidden");
  const x = Math.min(event.pageX ?? event.x ?? 100, window.innerWidth - 252);
  const y = Math.min(event.pageY ?? event.y ?? 100, window.innerHeight - 420);
  placeMenu(menu, Math.max(8, x), Math.max(8, y));
}

function applyFibMenu() {
  if (!_fibTargetId) return;
  const hiddenLevels = {};
  document.querySelectorAll("#fibLevels input[type=checkbox]").forEach(cb => {
    if (!cb.checked) hiddenLevels[cb.dataset.lv] = true;
  });
  const extendData = {
    showLabels:  document.getElementById("fibShowLabels").checked,
    showLevels:  document.getElementById("fibShowLevels").checked,
    showPrices:  document.getElementById("fibShowPrices").checked,
    showFill:    document.getElementById("fibShowFill").checked,
    extendRight: document.getElementById("fibExtendRight").checked,
    fillOpacity: parseInt(document.getElementById("fibFillOpacity").value, 10),
    lineWidth:   parseInt(document.getElementById("fibLineWidth").value, 10) || 1,
    hiddenLevels,
  };
  try { chart.overrideOverlay({ id: _fibTargetId, extendData }); } catch (e) {}
  closeFibMenu();
}

function closeFibMenu() {
  document.getElementById("fibMenu").classList.add("hidden");
  _fibTargetId = null;
  _fibTargetName = null;
}

// Von overlays.js aus aufrufbar
window.__tvOpenFibMenu = openFibMenu;

// Gemeinsame Sizing-Quelle für Grid Bot und Position-Tool.
// Eine Quelle, zwei Konsumenten — sonst hat man das Kapital an zwei
// Orten und irgendwann divergieren sie.
window.__tvSizing = () => ({
  capital: state.gbCapital,
  riskPct: GridBot.profileValues().riskBudget,   // Profil statt freies Feld
});

// ---------- Pattern-Erkennung ----------
// Scannt den aktuell sichtbaren Bereich und zeichnet gefundene Muster
// als Overlays. Die sind per Rechtsklick einzeln löschbar wie jede
// andere Zeichnung.
// Zeigt beim Überfahren, um welches Muster es geht. Nötig, weil das Label
// bei kurzen oder überlappenden Mustern nicht lesbar ist — dann sieht man
// nur Punkte und weiss nicht, wofür sie stehen.
let _patHintPrev = null;
function showPatternHint(p) {
  if (_patHintPrev == null) _patHintPrev = document.getElementById("statusline").textContent;
  const dir = p.direction === "bearish" ? "fallend" : p.direction === "bullish" ? "steigend" : "neutral";
  const conf = p.confirmedAt != null ? "bestätigt" : "unbestätigt";
  const tgt = p.target != null ? `  ·  Ziel ${p.target.toLocaleString("de-CH", { maximumFractionDigits: 0 })}` : "";
  // Volumen der Bestätigungskerze vs. 20-Bar-Schnitt: Ausbrüche auf dünnem
  // Volumen sind weniger glaubwürdig. Reine Information, kein Filter.
  const vol = p.volRatio != null
    ? `  ·  Vol ${p.volRatio.toFixed(1)}×${p.volRatio < 1 ? " (dünn)" : ""}` : "";
  setStatus(`${p.label}  ·  ${dir}  ·  ${conf}  ·  Form ${Math.round(p.quality * 100)}%${vol}${tgt}`);
}
function clearPatternHint() {
  if (_patHintPrev != null) { setStatus(_patHintPrev); _patHintPrev = null; }
}

function clearPatterns() {
  (state.patternOverlayIds || []).forEach(id => {
    try { chart.removeOverlay(id); } catch (e) {}
  });
  state.patternOverlayIds = [];
}

function scanPatterns() {
  if (typeof PatternEngine === "undefined") { setStatus("Pattern-Engine nicht geladen"); return; }
  clearPatterns();

  const data = chart.getDataList();
  if (!data || data.length < 40) { setStatus("Zu wenig Daten"); return; }

  let range;
  try { range = chart.getVisibleRange(); } catch (e) { range = null; }
  const from = range ? Math.max(0, range.realFrom ?? range.from) : 0;
  const to   = range ? Math.min(data.length, (range.realTo ?? range.to) + 1) : data.length;

  // Nur die angehakten Mustertypen suchen
  const enabled = {};
  document.querySelectorAll("#patTypes input[type=checkbox]").forEach(cb => {
    if (!cb.checked) enabled[cb.dataset.pat] = false;
  });
  // Mit linker Marge scannen: eine H&S, deren linke Schulter knapp
  // ausserhalb des Bildschirms liegt, würde sonst nicht erkannt. 150 Bars
  // decken das breiteste Muster (Trendlinien-Fenster + Fahnenmast) ab.
  // Gezeichnet wird trotzdem nur, was rechts im Sichtfeld endet.
  const scanFrom = Math.max(0, from - 150);
  let found = PatternEngine.scan(data, { from: scanFrom, to }, { ...state.patternOpts, ...enabled });
  const rightIdx = (p) => p.confirmedAt ?? p.channel?.to ?? p.points[p.points.length - 1].index;
  found = found.filter(p => rightIdx(p) >= from);

  if (found.length === 0) {
    setStatus("Keine Muster im sichtbaren Bereich");
    return;
  }

  state.patternOverlayIds = [];
  found.forEach(p => {
    try {
      let id;
      if (p.channel) {
        // Trendlinien-Muster: vier Eckpunkte der beiden Geraden
        const ch = p.channel;
        const pts = [
          { timestamp: data[ch.from].timestamp, value: ch.upper.at(ch.from) },
          { timestamp: data[ch.to].timestamp,   value: ch.upper.at(ch.to) },
          { timestamp: data[ch.from].timestamp, value: ch.lower.at(ch.from) },
          { timestamp: data[ch.to].timestamp,   value: ch.lower.at(ch.to) },
        ];
        const hasBreak = p.confirmedAt != null && !!data[p.confirmedAt];
        if (hasBreak) pts.push({ timestamp: data[p.confirmedAt].timestamp, value: p.neckline });
        // Fahnenmast (nur Flaggen/Wimpel)
        if (p.pole && data[p.pole.from] && data[p.pole.to]) {
          const lo = Math.min(data[p.pole.from].low, data[p.pole.to].low);
          const hi = Math.max(data[p.pole.from].high, data[p.pole.to].high);
          pts.push({ timestamp: data[p.pole.from].timestamp, value: p.pole.up ? lo : hi });
          pts.push({ timestamp: data[p.pole.to].timestamp,   value: p.pole.up ? hi : lo });
        }
        id = chart.createOverlay({
          name: "channelPattern", points: pts, lock: true,
          extendData: { label: p.label, direction: p.direction, quality: p.quality,
                        target: p.target, breakoutDir: p.breakoutDir,
                        hasBreak, pole: !!p.pole },
          onMouseEnter: () => { setChartCursor("pointer"); showPatternHint(p); return false; },
          onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
        });
      } else {
        // Pivot-Muster: Double / Triple / H&S
        const points = p.points.map(pt => ({ timestamp: data[pt.index].timestamp, value: pt.price }));
        if (p.confirmedAt != null && data[p.confirmedAt]) {
          points.push({ timestamp: data[p.confirmedAt].timestamp, value: p.neckline });
        }
        id = chart.createOverlay({
          name: "pattern", points, lock: true,
          extendData: {
            label: p.label, direction: p.direction, quality: p.quality,
            neckline: p.neckline, target: p.target,
            pivotCount: p.points.length,
            hasHead: p.type === "headShoulders" || p.type === "invHeadShoulders",
            slantedNeckline: p.necklineSlope != null,
          },
          onMouseEnter: () => { setChartCursor("pointer"); showPatternHint(p); return false; },
          onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
        });
      }
      if (id) state.patternOverlayIds.push(id);
    } catch (e) {}
  });

  const confirmed = found.filter(p => p.confirmedAt != null).length;
  setStatus(`${found.length} Muster (${confirmed} bestätigt) · Form% = Formqualität, keine Trefferquote · Rechtsklick löscht`);
}

// ---------- Smart Money Concepts (FVG / Order Blocks) ----------
function clearSMC() {
  (state.smcOverlayIds || []).forEach(id => {
    try { chart.removeOverlay(id); } catch (e) {}
  });
  state.smcOverlayIds = [];
}

function scanSMC() {
  if (typeof SMC === "undefined") { setStatus("SMC-Modul nicht geladen"); return; }
  clearSMC();

  const data = chart.getDataList();
  if (!data || data.length < 10) { setStatus("Zu wenig Daten"); return; }

  let range;
  try { range = chart.getVisibleRange(); } catch (e) { range = null; }
  const from = range ? Math.max(0, range.realFrom ?? range.from) : 0;
  const to   = range ? Math.min(data.length - 1, (range.realTo ?? range.to)) : data.length - 1;

  // Zonen dürfen links ausserhalb beginnen und bis ins Sichtfeld reichen.
  const scanFrom = Math.max(1, from - 200);

  // UI-Optionen lesen
  const opt = (id, def) => { const el = document.getElementById(id); return el ? el.checked : def; };
  const showFVGbull = opt("smcFvgBull", true);
  const showFVGbear = opt("smcFvgBear", true);
  const showOBbull  = opt("smcObBull", true);
  const showOBbear  = opt("smcObBear", true);
  const showFilled  = opt("smcShowFilled", false);
  const extendRight = opt("smcExtendRight", true);

  const zones = [];
  if (showFVGbull || showFVGbear) {
    SMC.detectFVG(data, { from: scanFrom, to }, state.smcOpts).forEach(z => {
      if (z.type === "bullish" && !showFVGbull) return;
      if (z.type === "bearish" && !showFVGbear) return;
      zones.push(z);
    });
  }
  if (showOBbull || showOBbear) {
    SMC.detectOrderBlocks(data, { from: scanFrom, to }, state.smcOpts).forEach(z => {
      if (z.type === "bullish" && !showOBbull) return;
      if (z.type === "bearish" && !showOBbear) return;
      zones.push(z);
    });
  }

  // Rechten Rand (Timestamp) fürs Verlängern bestimmen
  const lastTs = data[data.length - 1].timestamp;
  const barMs  = data.length >= 2 ? (data[data.length - 1].timestamp - data[data.length - 2].timestamp) : 0;
  const extendTs = lastTs + barMs * 30;   // etwas über den letzten Bar hinaus

  state.smcOverlayIds = [];
  let openCount = 0, drawn = 0;
  zones.forEach(z => {
    const closedIdx = z.kind === "fvg" ? z.filledIndex : z.mitigatedIndex;
    const isClosed  = closedIdx != null;
    if (isClosed && !showFilled) return;   // gefüllte/mitigierte standardmässig aus
    if (!isClosed) openCount++;

    // rechte Kante: bis zur Füllung, sonst bis (über) den letzten Bar
    let endTs;
    if (isClosed && data[closedIdx]) endTs = data[closedIdx].timestamp;
    else endTs = extendRight ? extendTs : lastTs;

    const startTs = z.timestamp;
    const dirArrow = z.type === "bullish" ? "▲" : "▼";
    const label = (z.kind === "fvg" ? "FVG " : "OB ") + dirArrow + (isClosed ? " ✓" : "");

    try {
      const id = chart.createOverlay({
        name: "smcZone",
        points: [
          { timestamp: startTs, value: z.top },
          { timestamp: endTs,   value: z.bottom },
        ],
        lock: true,
        extendData: { type: z.type, kind: z.kind, closed: isClosed, label },
        onMouseEnter: () => { setChartCursor("pointer"); showSMCHint(z); return false; },
        onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
        onRightClick: (e) => { try { chart.removeOverlay(e.overlay.id); } catch (x) {} return true; },
      });
      if (id) { state.smcOverlayIds.push(id); drawn++; }
    } catch (e) {}
  });

  if (drawn === 0) {
    setStatus("Keine SMC-Zonen im sichtbaren Bereich");
    return;
  }
  setStatus(`${drawn} SMC-Zonen (${openCount} offen) · Rechtsklick löscht einzelne`);
}

// Kurz-Info beim Hovern über eine SMC-Zone (nutzt die Statuszeile wie die Muster)
function showSMCHint(z) {
  if (_patHintPrev == null) _patHintPrev = document.getElementById("statusline").textContent;
  const dir = z.type === "bullish" ? "bullish" : "bearish";
  const kind = z.kind === "fvg" ? "Fair Value Gap" : "Order Block";
  const rng = `${z.bottom.toLocaleString("de-CH", { maximumFractionDigits: 2 })}–${z.top.toLocaleString("de-CH", { maximumFractionDigits: 2 })}`;
  const status = (z.kind === "fvg" ? z.filledIndex : z.mitigatedIndex) != null
    ? (z.kind === "fvg" ? "gefüllt" : "mitigiert") : "offen";
  const gap = z.gapPct != null ? `  ·  Lücke ${z.gapPct.toFixed(2)}%` : "";
  setStatus(`${kind}  ·  ${dir}  ·  Zone ${rng}  ·  ${status}${gap}`);
}

// ---------- Y-Achse entsperren ----------
// KLineCharts erlaubt vertikales Draggen nur wenn autoCalcTickFlag=false ist.
// Beim Start ist es true (Achse skaliert automatisch), deshalb blockiert das
// Draggen bis man die Achse einmal manuell anfasst. Wir übernehmen den
// automatisch berechneten Bereich als manuellen — Skalierung bleibt korrekt,
// Draggen geht sofort.
function unlockYAxis() {
  try {
    const pane = chart.getDrawPaneById("candle_pane");
    if (!pane) return;
    const yAxis = pane.getAxisComponent();
    if (!yAxis) return;
    const r = yAxis.getRange();
    if (r && r.range > 0) yAxis.setRange(r);
  } catch (e) { /* interne API — bei Versionswechsel still ignorieren */ }
}

// Auto-Zoom: Achse neu automatisch skalieren, danach wieder entsperren
function autoScaleY() {
  try {
    const pane = chart.getDrawPaneById("candle_pane");
    if (!pane) return;
    const yAxis = pane.getAxisComponent();
    if (!yAxis) return;
    yAxis.setAutoCalcTickFlag(true);
    chart.adjustPaneViewport?.(false, true, true, true, true);
    setTimeout(unlockYAxis, 60);
  } catch (e) {}
}

// ---------- Theme (Hell / Dunkel) ----------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  setTimeout(scheduleTagDraw, 30);
  // Icon wechseln: Mond im Dunkelmodus, Sonne im Hellmodus
  const icon = document.getElementById("themeIcon");
  if (icon) {
    icon.innerHTML = state.theme === "dark"
      ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>
         <path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  }
  // Chart-Theme nachziehen (Grid, Achsen, Text)
  const css = getComputedStyle(document.documentElement);
  T.text   = css.getPropertyValue("--text-dim").trim() || T.text;
  T.grid   = state.theme === "dark" ? "rgba(143,163,184,0.07)" : "rgba(60,80,100,0.09)";
  T.accent = css.getPropertyValue("--accent").trim() || T.accent;
  chart.setStyles(baseStyles());
  if (state.active.has("vrvp")) requestAnimationFrame(drawVrvp);
  if (state.compareAssets.length > 0) requestAnimationFrame(() => { try { drawCompare(); } catch (e) {} });
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveWorkspace();
  applyTheme();
}

// ---------- Layouts (mehrere benannte Workspaces) ----------
const LAYOUTS_KEY = "tv_layouts";

function loadLayouts() {
  try { return JSON.parse(localStorage.getItem(LAYOUTS_KEY)) || {}; }
  catch { return {}; }
}

function saveLayouts(obj) {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(obj)); } catch (e) {}
}

function currentLayoutSnapshot() {
  return {
    symbol: state.symbol,
    timeframeId: state.timeframe.id,
    // Nur die Kennung sichern, nicht die Kursdaten — die werden beim
    // Laden ohnehin neu geholt und wären sonst mehrere MB im localStorage.
    compareAssets: state.compareAssets.map(a => ({ id: a.id, label: a.label })),
    // Zeichnungen gehören zur Arbeitsfläche — ohne sie ist ein Layout
    // nur die halbe Ansicht. Ohne id gespeichert, die vergibt KLineCharts neu.
    drawings: state.drawings.map(({ id, ...rest }) => rest),
    active: [...state.active],
    chartType: state.chartType,
    legendCollapsed: state.legendCollapsed,
    watchlists: state.watchlists,
    activeWatchlist: state.activeWatchlist,
    watchlistOpen: state.watchlistOpen,
    theme: state.theme,
    currentLayout: state.currentLayout,
    gbOpen: state.gbOpen,
    gbCollapsed: state.gbCollapsed,
    gbProfile: state.gbProfile,
    gbHeight: state.gbHeight,
    gbActiveTier: state.gbActiveTier,
    indOrder: state.indOrder,
    frvpDefaults: state.frvpDefaults,
    gbCapital: state.gbCapital,
    gbTiers: state.gbTiers,
    gbThresholds: state.gbThresholds,
    chartStyle: state.chartStyle,
  };
}

function saveNamedLayout(name) {
  if (!name || !name.trim()) { setStatus("Layout braucht einen Namen"); return; }
  const layouts = loadLayouts();
  layouts[name.trim()] = currentLayoutSnapshot();
  saveLayouts(layouts);
  state.currentLayout = name.trim();
  saveWorkspace();
  renderLayoutList();
  setStatus(`Layout "${name.trim()}" gespeichert`);
}

async function applyNamedLayout(name) {
  const layouts = loadLayouts();
  const l = layouts[name];
  if (!l) return;
  state.currentLayout = name;

  state.symbol      = l.symbol || state.symbol;
  state.timeframe   = CONFIG.TIMEFRAMES.find(t => t.id === l.timeframeId) || state.timeframe;
  state.chartType   = l.chartType || state.chartType;
  state.legendCollapsed = !!l.legendCollapsed;
  if (l.watchlists) { state.watchlists = l.watchlists; state.activeWatchlist = l.activeWatchlist || Object.keys(l.watchlists)[0]; }
  else if (l.watchlist) { state.watchlists = { Standard: l.watchlist }; state.activeWatchlist = "Standard"; }
  state.watchlistOpen = l.watchlistOpen !== false;
  state.theme       = l.theme || state.theme;
  state.chartStyle  = l.chartStyle || state.chartStyle;

  // Indikatoren neu setzen: alte entfernen, neue aus dem Layout aktivieren
  [...state.active].forEach(k => {
    const ind = CONFIG.INDICATORS.find(i => i.key === k);
    if (ind) removeIndicator(ind);
  });
  state.active = new Set(l.active || CONFIG.DEFAULT_ACTIVE);

  // ---- Altlasten des VORHERIGEN Layouts vollständig räumen ----
  // clearAllDrawings lief bisher nur beim Symbol-Wechsel. Bei gleichem
  // Symbol (BTC-Layout -> Vergleichs-Layout auf BTC) blieben FRVPs und
  // Linien stehen. Und drawVrvp oben lief noch mit ALTEM state.active
  // (vrvp drin) und malte das Profil frisch — deshalb hier, NACH dem
  // Set-Wechsel, erneut: jetzt cleart es wirklich.
  clearAllDrawings();
  drawVrvp();
  // clearAllDrawings hat gbActiveTier genullt — Tier-Buttons nachziehen,
  // sonst zeigt einer "Im Chart ✓" ohne Band im Chart.
  if (state.gbResult) gbRenderTiers();

  // Vergleichs-Assets aus dem Layout übernehmen. Ohne das bleibt der
  // alte Compare-State stehen und man sieht Kerzen UND Vergleichslinien
  // gleichzeitig.
  state.compareAssets = (l.compareAssets || []).map((a, i) => ({
    id: a.id, label: a.label, color: COMPARE_COLORS[i % COMPARE_COLORS.length],
    data: [], hidden: false,
  }));
  window.__tvCompareAssets = state.compareAssets;

  saveWorkspace();
  syncLabels();
  applyTheme();
  renderTfList();
  renderTypeList();
  renderIndPanel();
  renderWatchlist();
  renderCompareActive();
  applyAllActive();
  restartWatchlistStream();

  // WARTEN, bis die Kerzen wirklich da sind. Ein Timeout wäre geraten:
  // dauert der Netzwerk-Request länger, werden die Zeichnungen auf der
  // Zeitachse des vorherigen Assets platziert und springen anschliessend.
  await loadData();

  // Schneller Doppelwechsel A→B: wenn inzwischen ein anderes Layout offen
  // ist, gehören diese Zeichnungen nicht mehr hierher.
  if (state.currentLayout !== name) return;

  // Preis/Legende auf die NEUEN Daten setzen. Ohne das zeigt die Legende
  // weiter den letzten Wert des vorherigen Assets (Preis „bleibt hängen"),
  // obwohl der Graph schon gewechselt hat.
  try { chart.setStyles({}); } catch (e) {}
  autoScaleY();
  updateLegend();

  restoreDrawings(l.drawings);
  scheduleTagDraw();

  // Kerzen aus- bzw. wieder einblenden — je nachdem ob das Layout
  // Vergleiche enthält. Muss NACH loadData laufen.
  applyCompareIndicator();
  if (state.compareAssets.length > 0) reloadAllCompareData();
  document.getElementById("layoutPanel").classList.remove("open");
  setStatus(`Layout "${name}" geladen`);
}

function renderLayoutList() {
  const list = document.getElementById("layoutList");
  if (!list) return;
  list.innerHTML = "";
  const layouts = loadLayouts();
  const names = Object.keys(layouts);
  if (names.length === 0) {
    list.innerHTML = '<div class="dd-empty">Noch keine Layouts</div>';
    return;
  }
  names.forEach(name => {
    const item = document.createElement("div");
    item.className = "layout-item";
    const isOpen = state.currentLayout === name;
    item.innerHTML = `<span class="li-name${isOpen ? " li-open" : ""}">${name}</span>`
      + `<button class="li-upd" title="Mit aktueller Ansicht überschreiben">`
      + `<svg viewBox="0 0 24 24" width="12" height="12"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
      + `<button class="li-del" title="Löschen">✕</button>`;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".li-del") || e.target.closest(".li-upd")) return;
      applyNamedLayout(name);
    });
    item.querySelector(".li-upd").addEventListener("click", (e) => {
      e.stopPropagation();
      const l = loadLayouts();
      l[name] = currentLayoutSnapshot();
      saveLayouts(l);
      state.currentLayout = name;
      saveWorkspace();
      renderLayoutList();
      setStatus(`Layout "${name}" überschrieben`);
    });
    item.querySelector(".li-del").addEventListener("click", (e) => {
      e.stopPropagation();
      const l = loadLayouts();
      delete l[name];
      saveLayouts(l);
      renderLayoutList();
    });
    list.appendChild(item);
  });
}

// Rechtsklick nahe der aktuellen Preislinie öffnet die Stil-Einstellungen.
// KLineCharts kennt kein Event für die Preis-Markierung — deshalb prüfen wir
// selbst, ob der Klick in ihrer Höhe lag.
document.getElementById("mainChart").addEventListener("contextmenu", (e) => {
  if (state.activeTool) return;                 // beim Zeichnen nicht stören
  const d = chart.getDataList();
  if (!d || !d.length) return;
  try {
    const pt = chart.convertToPixel({ value: d[d.length - 1].close }, { paneId: "candle_pane" });
    const rect = document.getElementById("mainChart").getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (pt && Math.abs(y - pt.y) <= 10) {
      e.preventDefault();
      e.stopPropagation();
      openChartStyleMenu({ getBoundingClientRect: () => ({
        left: Math.min(e.clientX, window.innerWidth - 250), bottom: e.clientY,
      })});
    }
  } catch (err) {}
});

// ---------- Chart-Stil-Menü ----------
function openChartStyleMenu(anchorEl) {
  const menu = document.getElementById("chartStyleMenu");
  if (!menu) return;
  const cs = state.chartStyle;
  const isLine = state.chartType === "area";

  document.getElementById("csmCandleSection").classList.toggle("hidden", isLine);
  document.getElementById("csmLineSection").classList.toggle("hidden", !isLine);

  document.getElementById("csUpColor").value    = cs.upColor;
  document.getElementById("csDownColor").value  = cs.downColor;
  document.getElementById("csHollow").checked   = !!cs.hollow;
  document.getElementById("csLineColor").value  = cs.lineColor;
  document.getElementById("csLineWidth").value  = cs.lineWidth;
  document.getElementById("csAreaFill").checked = cs.areaFill !== false;
  document.getElementById("csFillOpacity").value = cs.fillOpacity;
  document.getElementById("csFillOpacityVal").textContent = cs.fillOpacity + "%";
  document.getElementById("csLastLine").checked = cs.lastLine !== false;
  document.getElementById("csLastText").checked = cs.lastText !== false;
  document.getElementById("csLastSize").value   = cs.lastSize || 12;
  document.getElementById("csHiLo").checked     = cs.hiLoShow !== false;
  document.getElementById("csHiLoSize").value   = cs.hiLoSize || 12;

  const r = anchorEl.getBoundingClientRect();
  menu.classList.remove("hidden");
  placeMenu(menu, Math.min(r.left, window.innerWidth - 250), r.bottom + 6);
}

function applyChartStyle() {
  const cs = state.chartStyle;
  cs.upColor     = document.getElementById("csUpColor").value;
  cs.downColor   = document.getElementById("csDownColor").value;
  cs.hollow      = document.getElementById("csHollow").checked;
  cs.lineColor   = document.getElementById("csLineColor").value;
  cs.lineWidth   = parseInt(document.getElementById("csLineWidth").value, 10) || 2;
  cs.areaFill    = document.getElementById("csAreaFill").checked;
  cs.fillOpacity = parseInt(document.getElementById("csFillOpacity").value, 10);
  cs.lastLine    = document.getElementById("csLastLine").checked;
  cs.lastText    = document.getElementById("csLastText").checked;
  cs.lastSize    = parseInt(document.getElementById("csLastSize").value, 10) || 12;
  cs.hiLoShow    = document.getElementById("csHiLo").checked;
  cs.hiLoSize    = parseInt(document.getElementById("csHiLoSize").value, 10) || 12;
  saveWorkspace();
  chart.setStyles(baseStyles());
  document.getElementById("chartStyleMenu").classList.add("hidden");
}

function resetChartStyle() {
  state.chartStyle = {
    upColor: "#3fb68b", downColor: "#d05e5e", hollow: false,
    lineColor: "#e8b64c", lineWidth: 2, areaFill: true, fillOpacity: 15,
    lastLine: true, lastText: true, lastSize: 12, hiLoShow: true, hiLoSize: 12,
  };
  saveWorkspace();
  chart.setStyles(baseStyles());
  document.getElementById("chartStyleMenu").classList.add("hidden");
}

// ---------- Start ----------
initDropdowns();
syncLabels();
GridBot.setThresholds(state.gbThresholds);
GridBot.setProfile(state.gbProfile);
gbRenderSettings();
gbInitResize();
gbSetCollapsed(state.gbCollapsed);
if (state.gbOpen) gbToggleBar(true);
applyTheme();
renderLayoutList();
renderAssetList();
renderTfList();
renderTypeList();
renderIndPanel();
renderDrawbar();
renderWatchlist();
applyAllActive();
updateLegend();
loadBinanceSymbols();
// Zeichnungen aus dem Workspace erst wiederherstellen, wenn die Kerzen da
// sind — vorher kennt der Chart die Zeitachse nicht und die Punkte landen
// daneben. Ohne diesen Schritt waren gespeicherte Zeichnungen nach einem
// Reload zwar im localStorage, aber unsichtbar.
loadData().then(() => {
  const saved = state.drawings;
  if (saved && saved.length) restoreDrawings(saved);
});
restartWatchlistStream();

// ---------- Watchlist-Handler ----------
document.getElementById("wlToggleBtn").addEventListener("click", () => {
  state.watchlistOpen = !state.watchlistOpen;
  saveWorkspace();
  renderWatchlist();
  setTimeout(resize, 50);
});
document.getElementById("wlAddBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const box = document.getElementById("wlSearchBox");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    renderWlSearch("");
    setTimeout(() => document.getElementById("wlSearch").focus(), 30);
  }
});
document.getElementById("wlSearch").addEventListener("input", (e) => renderWlSearch(e.target.value));

// ---------- Theme-Handler ----------
document.getElementById("themeBtn").addEventListener("click", toggleTheme);

// ---------- Watchlisten-Handler ----------
document.getElementById("wlSelect").addEventListener("change", (e) => switchWatchlist(e.target.value));
document.getElementById("wlManageBtn").addEventListener("click", () => {
  document.getElementById("wlManage").classList.toggle("hidden");
});
document.getElementById("wlCreateBtn").addEventListener("click", () => {
  const inp = document.getElementById("wlNewName");
  createWatchlist(inp.value);
  inp.value = "";
});
document.getElementById("wlNewName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("wlCreateBtn").click();
});
document.getElementById("wlDeleteBtn").addEventListener("click", () => {
  if (confirm(`Watchlist "${state.activeWatchlist}" löschen?`)) deleteWatchlist(state.activeWatchlist);
});

// ---------- Grid-Bot-Handler ----------
document.getElementById("posToolTopBtn").addEventListener("click", () => {
  // Zweiter Klick bricht ab — gleiche Logik wie der ESC-Handler
  if (state.activeTool === "positionTool") {
    if (state.drawingId != null) { try { chart.removeOverlay(state.drawingId); } catch (err) {} state.drawingId = null; }
    state.activeTool = null;
    document.getElementById("posToolTopBtn").classList.remove("active");
    setStatus("Abgebrochen");
    return;
  }
  startTool("positionTool");
  document.getElementById("posToolTopBtn").classList.add("active");
  setStatus("Long/Short: 1. Einstieg klicken  →  2. Stop  →  3. Ziel");
});
document.getElementById("gridBotBtn").addEventListener("click", () => gbToggleBar());
document.getElementById("gbClose").addEventListener("click", (e) => { e.stopPropagation(); gbToggleBar(false); });
document.getElementById("gbToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  gbSetCollapsed(!state.gbCollapsed);
});
document.getElementById("gbRefresh").addEventListener("click", (e) => { e.stopPropagation(); gbRefresh(true); });
document.getElementById("gbStatus").addEventListener("click", (e) => {
  if (e.target.closest(".gb-icon")) return;
  gbSetCollapsed(!state.gbCollapsed);
});
document.querySelectorAll(".gb-tab").forEach(tab => {
  tab.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".gb-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const map = { strategy: "gbPaneStrategy", data: "gbPaneData", settings: "gbPaneSettings" };
    Object.values(map).forEach(id => document.getElementById(id).classList.add("hidden"));
    document.getElementById(map[tab.dataset.tab]).classList.remove("hidden");
    // Pane öffnen falls kollabiert
    if (state.gbCollapsed) gbSetCollapsed(false);
  });
});
// ---------- FAQ-Handler ----------
document.getElementById("faqBtn").addEventListener("click", () => {
  document.getElementById("faqModal").classList.remove("hidden");
});
document.getElementById("faqClose").addEventListener("click", () => {
  document.getElementById("faqModal").classList.add("hidden");
});
document.getElementById("faqModal").addEventListener("click", (e) => {
  // Klick auf den Hintergrund schliesst
  if (e.target.id === "faqModal") e.target.classList.add("hidden");
});
document.querySelectorAll(".faq-navbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".faq-navbtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".faq-sec").forEach(s =>
      s.classList.toggle("hidden", s.dataset.sec !== btn.dataset.sec));
    document.getElementById("faqBody").scrollTop = 0;
  });
});

// ---------- Fibonacci-Menü-Handler ----------
document.getElementById("fibApply").addEventListener("click", applyFibMenu);
document.getElementById("fibClose").addEventListener("click", closeFibMenu);
document.getElementById("fibDelete").addEventListener("click", () => {
  if (_fibTargetId) { try { chart.removeOverlay(_fibTargetId); } catch (e) {} }
  closeFibMenu();
});
document.getElementById("fibFillOpacity").addEventListener("input", (e) => {
  document.getElementById("fibFillVal").textContent = e.target.value + "%";
});
document.addEventListener("click", (e) => {
  const m = document.getElementById("fibMenu");
  if (m && !m.classList.contains("hidden") && !m.contains(e.target)) closeFibMenu();
});

// ---------- Pattern-Handler ----------
document.getElementById("patternBtn").addEventListener("click", scanPatterns);
document.getElementById("patternClearBtn").addEventListener("click", () => {
  clearPatterns();
  setStatus("Muster entfernt");
});
document.getElementById("patStrictness").addEventListener("change", (e) => {
  const presets = {
    streng: {},   // Engine-Defaults
    mittel: { lookback: 7, tolerance: 1.5, minDepth: 5.0, shoulderTol: 4.0, minHeadPct: 2.5, minQuality: 0.6 },
    locker: { lookback: 5, tolerance: 2.0, minDepth: 3.0, shoulderTol: 5.0, minHeadPct: 2.0, minQuality: 0.5 },
  };
  state.patternOpts = presets[e.target.value] || {};
  saveWorkspace();
  const warn = document.getElementById("patWarn");
  if (warn) warn.classList.toggle("hidden", e.target.value === "streng");
});

// ---------- SMC-Handler (FVG / Order Blocks) ----------
(function () {
  const scanBtn  = document.getElementById("smcScanBtn");
  const clearBtn = document.getElementById("smcClearBtn");
  if (scanBtn)  scanBtn.addEventListener("click", scanSMC);
  if (clearBtn) clearBtn.addEventListener("click", () => { clearSMC(); setStatus("SMC-Zonen entfernt"); });
})();

// ---------- Layout-Handler ----------
document.getElementById("layoutSaveBtn").addEventListener("click", () => {
  const input = document.getElementById("layoutName");
  saveNamedLayout(input.value);
  input.value = "";
});
document.getElementById("layoutName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    saveNamedLayout(e.target.value);
    e.target.value = "";
  }
});

// ---------- Chart-Stil-Handler ----------
document.getElementById("csApplyBtn").addEventListener("click", applyChartStyle);
document.getElementById("csResetBtn").addEventListener("click", resetChartStyle);
document.getElementById("csFillOpacity").addEventListener("input", (e) => {
  document.getElementById("csFillOpacityVal").textContent = e.target.value + "%";
});
document.addEventListener("click", (e) => {
  const m = document.getElementById("chartStyleMenu");
  if (m && !m.contains(e.target) && !e.target.closest(".ind-gear")) {
    m.classList.add("hidden");
  }
});

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
