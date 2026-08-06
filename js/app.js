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

// Das gespeicherte Symbol ist ein ganzes OBJEKT, kein blosser Bezeichner.
// Wurde es einmal gespeichert, blieben Aenderungen an CONFIG.DEFAULT_SYMBOLS
// wirkungslos — der Browser lud weiter die eingefrorene alte Fassung, mit
// veralteten oder fehlenden Feldern wie stooqSymbol oder type. Symptom:
// ein Symbol funktioniert erst wieder, nachdem man es von Hand neu
// auswaehlt, waehrend frisch gewaehlte Symbole sofort laufen.
//
// Deshalb: ueber die id gegen die aktuelle CONFIG abgleichen. Die
// Definition aus config.js hat immer Vorrang; nur wenn die id dort nicht
// mehr existiert (eigenes Symbol des Nutzers), bleibt die gespeicherte
// Fassung erhalten.
function _symbolAbgleichen(gespeichert) {
  if (!gespeichert) return CONFIG.DEFAULT_SYMBOLS[0];
  const aktuell = CONFIG.DEFAULT_SYMBOLS.find(s => s.id === gespeichert.id);
  return aktuell || gespeichert;
}

const state = {
  symbol:      _symbolAbgleichen(_ws?.symbol),
  timeframe:   CONFIG.TIMEFRAMES.find(t => t.id === (_ws?.timeframeId || "1d")) || CONFIG.TIMEFRAMES.find(t => t.id === "1d"),
  active:      new Set(_ws?.active || CONFIG.DEFAULT_ACTIVE),
  closeStream: null,
  allSymbols:  [...CONFIG.DEFAULT_SYMBOLS],
  activeTool:  null,
  vrvpMeta:    null,
  vrvpCanvas:  null,
  tooltipsVisible: true,
  subPaneIds:  {},   // indKey -> paneId (von createIndicator zurückgegeben)
  // Nur zwei Zustaende: "normal" (aus) und "strong_magnet" (ein). Die
  // frueheren drei Stufen (aus/schwach/stark) waren beim Zeichnen mit dem
  // Finger nicht unterscheidbar. Der Name "strong_magnet" bleibt, weil
  // KLineCharts ihn im Overlay-Modus so erwartet.
  magnetMode:  "normal",   // normal | strong_magnet
  pinTool:     false,      // Werkzeug nach Zeichnung aktiv lassen
  drawingId:   null,       // Overlay-ID während des Zeichnens (für ESC)
  selectedOverlayId: null, // zuletzt selektiertes Overlay (für Entf)
  chartType:   _ws?.chartType || "candle_solid", // candle_solid | area
  legendCollapsed: _ws?.legendCollapsed || false,
  drawStyle:   _ws?.drawStyle || { color: "#e8b64c", lineStyle: "solid", opacity: 100, width: 1 },
  compareAssets: [],   // [{ id, label, color, data: [{timestamp, close}] }]
  // Senkrechter Zoom im Vergleichsmodus. Die Prozent-Skala wird bei jedem
  // Neuzeichnen automatisch berechnet — ohne diesen Faktor haette ein
  // Y-Zug am Chart nur das Raster bewegt, die Linien aber nicht.
  compareScale: 1,

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

  // Elliott-Wellen-Scanner (Welle 3 / Golden Pocket)
  ewtOverlayIds: [],
  ewtOpts: _ws?.ewtOpts || {},

  // Logarithmische Preisskala. Default linear — die Log-Ansicht ist eine
  // Darstellungsoption, keine Voreinstellung.
  logScale: _ws?.logScale === true,

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

// ── Auswahl nach aussen spiegeln ──────────────────────────────────────
// overlays.js hat keinen Zugriff auf `state`, braucht die aktuelle Auswahl
// aber, um Beschriftungen und Anfasspunkte nur bei angetippter Zeichnung zu
// rendern. state.selectedOverlayId wird an ueber einem Dutzend Stellen
// zugewiesen — statt jede einzeln anzufassen, faengt dieser Setter alle ab.
//
// Der Wert wandert nach window.__tvSelectedId, und die betroffenen Overlays
// (das alte und das neue) werden neu gezeichnet. Ohne dieses Neuzeichnen
// erschienen die Anfasspunkte erst beim naechsten Chart-Ereignis.
(function mirrorSelection() {
  let sel = state.selectedOverlayId;
  window.__tvSelectedId = sel;
  Object.defineProperty(state, "selectedOverlayId", {
    configurable: true,
    get() { return sel; },
    set(v) {
      if (sel === v) return;
      const prev = sel;
      sel = v;
      window.__tvSelectedId = v;
      // `chart` ist ein spaeter deklariertes const — der Zugriff kann in die
      // temporale Todeszone fallen, solange die Datei noch ausgewertet wird.
      // try/catch faengt das ab; zur Laufzeit steht chart laengst.
      [prev, v].forEach((id) => {
        if (!id) return;
        try {
          const ov = chart.getOverlayById(id);
          if (ov) chart.overrideOverlay({ id, points: ov.points });
        } catch (e) {}
      });
    },
  });
})();


// Auf Touch-Geräten Watchlist standardmässig geschlossen (spart 210px Chartbreite).
// Nur beim allerersten Besuch (kein gespeicherter Workspace).
if (!_ws && window.matchMedia("(pointer: coarse)").matches) {
  state.watchlistOpen = false;
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
    // Fuenfter Parameter = Intervall des Durchschnitts ("auto" oder z. B. "1w").
    // KLineCharts behandelt calcParams als undurchsichtige Liste und erkennt
    // Aenderungen darin als neue Instanz — genau das wollen wir hier.
    case "sma":      create.calcParams = [inp.p1||20, inp.p2||50, inp.p3||100, inp.p4||200, inp.tf||"auto"]; break;
    case "ema":      create.calcParams = [inp.p1||21, inp.p2||50, inp.p3||100, inp.p4||200, inp.tf||"auto"]; break;
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


// Auf dem Handy sitzt der Muelleimer schon im Schwebebalken, der neben dem
// offenen Stilmenue stehen bleibt. Der zusaetzliche Loeschknopf IM Menue ist
// dort doppelt gemoppelt und kostet nur Platz. Am Desktop gibt es keinen
// Schwebebalken (er ist mobile-only), dort bleiben die Knoepfe.
quiet(() => {
  if (!window.matchMedia("(max-width: 720px), (pointer: coarse)").matches) return;
  ["overlayDelete", "posDelete", "fibDelete", "frvpDelete"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}, "mobile delete buttons");

// ---------- Globale M2-Zeitreihe ----------
// Wird einmal geladen und in window.__tvM2Series abgelegt; der Indikator in
// indicators.js liest von dort. Bewusst NICHT bei jedem Neuzeichnen laden —
// M2 aendert sich monatlich, nicht im Sekundentakt.
let _m2Laden = null;
function ensureM2Series() {
  if (window.__tvM2Series || _m2Laden) return _m2Laden || Promise.resolve();
  _m2Laden = DataLayer.fetchGlobalM2()
    .then(serie => {
      window.__tvM2Series = serie;
      // Der Indikator wurde womoeglich schon ohne Daten berechnet.
      quiet(() => chart.overrideIndicator({ name: "GLOBALM2" }), "M2 nachrechnen");
    })
    .catch(err => {
      // Ohne Worker-Route bleibt die Linie leer. Das ist kein stiller
      // Fehler — der Grund gehoert in die Statuszeile.
      setStatus(`Global M2 nicht verfügbar: ${err && err.message ? err.message : err}`);
      console.warn("[TreydView] M2", err);
    })
    .finally(() => { _m2Laden = null; });
  return _m2Laden;
}

// ---------- Indikatoren anwenden ----------
function applyIndicator(ind) {
  // M2 braucht seine eigene Zeitreihe, bevor der Indikator etwas rechnen kann.
  if (ind && ind.name === "GLOBALM2") { try { ensureM2Series(); } catch (e) {} }
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

// Tageskerzen zu Wochen- oder Monatskerzen zusammenfassen.
//
// Noetig fuer Quellen, die nur Tagesdaten liefern (Bitstamp, LBMA-Gold).
// Wochen beginnen Montag 00:00 UTC — der Unix-Epochenstart war ein
// Donnerstag, daher der Versatz von vier Tagen. Monate nach Kalender.
function aggregateCandles(candles, tfId) {
  if (!Array.isArray(candles) || candles.length === 0) return candles;
  const D = 86400000;
  // Der 1. Januar 1970 war ein DONNERSTAG. Montage liegen damit bei
  // Tagesindex ≡ 4 (mod 7). Der Versatz muss deshalb ABGEZOGEN werden —
  // mit +4 landen die Wochengrenzen auf Sonntag.
  const bucket = (ts) => {
    if (tfId === "1w") return Math.floor((ts - 4 * D) / (7 * D));
    const d = new Date(ts);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const start = (ts) => {
    if (tfId === "1w") return Math.floor((ts - 4 * D) / (7 * D)) * (7 * D) + 4 * D;
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  };
  const out = [];
  let cur = null, key = null;
  for (const c of candles) {
    const k = bucket(c.timestamp);
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { timestamp: start(c.timestamp), open: c.open, high: c.high,
              low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low  = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += (c.volume || 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function loadData() {
  const seq = ++_loadSeq;
  if (state.closeStream) { state.closeStream(); state.closeStream = null; }
  setLive("offline", "lädt …");
  setStatus(`Lade ${state.symbol.label} (${state.timeframe.label}) …`);
  let candles;
  try {
    if (state.symbol.type === "binance") {
      // Momentaufnahme aus dem Repo + Zuwachs direkt von Binance.
      //
      // Ohne sie liefen bei jedem Laden bis zu fuenf sequenzielle
      // Binance-Anfragen (CANDLE_LIMIT 5000, max. 1000 je Anfrage) —
      // dasselbe Muster, das wir bei Bitstamp und Gold abgeschafft haben,
      // hier nur unauffaelliger, weil Binance direkt aus dem Browser
      // erreichbar ist und keinen Worker braucht.
      //
      // Nur fuer Tageskerzen: die gespeicherte Datei enthaelt Tagesdaten.
      const snapBn = state.timeframe.id === "1d"
        ? (CONFIG.HISTORY_SNAPSHOTS || {})[state.symbol.id] : null;
      if (snapBn) {
        candles = await DataLayer.fetchHistoryCached(snapBn,
          (from) => DataLayer.fetchBinanceKlinesSince(
            state.symbol.id, state.timeframe.binanceInterval, from));
      } else {
        candles = await DataLayer.fetchBinanceKlines(state.symbol.id, state.timeframe.binanceInterval, CONFIG.CANDLE_LIMIT);
      }
    } else if (state.symbol.type === "kraken") {
      candles = await DataLayer.fetchKrakenKlines(state.symbol.krakenPair, state.timeframe.krakenInterval, CONFIG.CANDLE_LIMIT);
    } else if (state.symbol.type === "coinbase") {
      candles = await DataLayer.fetchCoinbaseKlines(state.symbol.coinbaseProduct, state.timeframe.coinbaseInterval, CONFIG.CANDLE_LIMIT);
    } else if (state.symbol.type === "stooq") {
      // Indizes kommen als Tageskerzen ueber den Worker (Stooq erlaubt
      // keinen Direktabruf aus dem Browser).
      candles = await DataLayer.fetchStooqHistory(state.symbol.stooqSymbol);
    } else if (state.symbol.type === "bitstamp") {
      // Bitstamp liefert nur 1h, 4h und 1d. Groebere Intervalle entstehen
      // aus Tageskerzen: Wochen- und Monatskerzen liessen sich zwar
      // anfragen, waeren aber je Boerse anders geschnitten.
      const stepMap = { "15m": 3600, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 86400, "1M": 86400 };
      const step = stepMap[state.timeframe.id] || 86400;
      // Momentaufnahme aus dem Repo + Zuwachs vom Worker. Nur fuer
      // Tageskerzen — die gespeicherte Datei enthaelt Tagesdaten.
      const snapBs = step === 86400 ? (CONFIG.HISTORY_SNAPSHOTS || {})[state.symbol.id] : null;
      candles = await DataLayer.fetchHistoryCached(snapBs,
        (from) => DataLayer.fetchBitstampHistory(state.symbol.bitstampPair, step, from));
      if (state.timeframe.id === "1w" || state.timeframe.id === "1M") {
        candles = aggregateCandles(candles, state.timeframe.id);
      }
      if (!candles || candles.length === 0) throw new Error(`Bitstamp: keine Kerzen für ${state.symbol.bitstampPair}`);
    } else if (state.symbol.type === "bybit") {
      candles = await DataLayer.fetchBybitKlines(state.symbol.bybitSymbol, state.timeframe.bybitInterval, CONFIG.CANDLE_LIMIT);
      if (!candles || candles.length === 0) throw new Error(`Bybit: keine Kerzen für ${state.symbol.bybitSymbol} / ${state.timeframe.bybitInterval}`);
    } else {
      // Gold: Momentaufnahme ab 1968 aus dem Repo, Zuwachs vom Worker.
      const snapAu = (CONFIG.HISTORY_SNAPSHOTS || {})[state.symbol.id];
      candles = await DataLayer.fetchHistoryCached(snapAu,
        (from) => DataLayer.fetchGoldHistory(from));
      if (state.timeframe.id === "1w" || state.timeframe.id === "1M") {
        candles = aggregateCandles(candles, state.timeframe.id);
      }
    }
  } catch (err) {
    if (seq !== _loadSeq) return;   // inzwischen wurde neu geladen
    // HTTP 500 heisst: der Worker ist erreichbar und wirft einen Fehler.
    // Die URL zu prüfen führt dann in die Irre — sie stimmt ja.
    const isWorker = state.symbol.type === "worker" || state.symbol.type === "stooq"
                  || state.symbol.type === "bitstamp";
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
function initDropdowns() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
    }
  });
  ["assetDropdown", "compareDropdown", "tfDropdown", "typeDropdown", "indDropdown", "layoutDropdown", "patternDropdown", "smcDropdown", "ewtDropdown"].forEach(id => {
    const dd = document.getElementById(id);
    if (!dd) return;
    const trigger = dd.querySelector(".dd-trigger, .action-btn");
    const panel = dd.querySelector(".dd-panel");
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = panel.classList.contains("open");
      document.querySelectorAll(".dd-panel").forEach(p => p.classList.remove("open"));
      if (!wasOpen) { panel.classList.add("open"); placeDropdownPanel(dd, trigger, panel); }
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

// Panels von Knoepfen, die in der Seitenleiste sitzen, muessen fixiert
// positioniert werden: .drawbar traegt overflow-y:auto und wuerde ein
// absolut positioniertes Panel abschneiden. Zudem zeigt .dd-panel--right
// mit right:0 in der schmalen Leiste nach LINKS aus dem Bild hinaus.
// Dieselbe Loesung wie bei den Werkzeug-Fly-Outs: position:fixed und
// Koordinaten aus dem Knopf rechnen.
function placeDropdownPanel(dd, trigger, panel) {
  if (!dd.closest("#drawbar")) {
    // Ausserhalb der Leiste gilt unveraendert das Stylesheet.
    panel.style.position = ""; panel.style.left = "";
    panel.style.top = "";      panel.style.right = "";
    return;
  }
  const r = trigger.getBoundingClientRect();
  panel.style.position = "fixed";
  panel.style.right = "auto";
  panel.style.left  = (r.right + 8) + "px";
  panel.style.top   = "8px";
  // Erst messen, dann klemmen: die Breite deckelt das Stylesheet
  // (#drawbar .dd-panel), hier wird nur verhindert, dass ein breites
  // Panel unten oder rechts aus dem Bild laeuft.
  const ph = panel.offsetHeight, pw = panel.offsetWidth;
  panel.style.top  = Math.max(8, Math.min(r.top, window.innerHeight - ph - 12)) + "px";
  panel.style.left = Math.max(8, Math.min(r.right + 8, window.innerWidth - pw - 12)) + "px";
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
    if (s.type === "worker" || s.type === "stooq") return false;   // Gold und Indizes nie vergleichbar
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
  // WICHTIG: das ganze Symbol uebernehmen, nicht nur id und label.
  // refreshCompareData entscheidet ueber entry.type, welche Boerse gefragt
  // wird, und braucht dazu bybitSymbol / krakenPair / coinbaseProduct.
  // Vorher enthielt entry nur id+label — jede Nicht-Binance-Boerse landete
  // im Binance-Zweig und wurde mit einer id wie "AEROUSDT_BY" abgefragt,
  // die es dort nicht gibt. Ergebnis: "Vergleichsdaten ... fehlgeschlagen".
  const entry = { ...sym, color, data: [], hidden: false };
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
      // Binance nutzt das reine Symbol. Sicherheitsnetz: sollte der Typ
      // einmal fehlen, wird nicht blind die interne id verschickt.
      const sym = entry.binanceSymbol || entry.id;
      candles = await DataLayer.fetchBinanceKlines(sym, tf.binanceInterval, CONFIG.CANDLE_LIMIT);
    }
    if (!candles || !candles.length) throw new Error("keine Kerzen erhalten");
    entry.data = candles.map(c => ({ timestamp: c.timestamp, close: c.close }));
    window.__tvCompareAssets = state.compareAssets;
  } catch (e) {
    // Grund mitgeben — "fehlgeschlagen" allein war beim Suchen nutzlos.
    setStatus(`Vergleichsdaten ${entry.label} fehlgeschlagen: ${e && e.message ? e.message : e}`);
    console.warn("[TreydView] Vergleich", entry.label, "type=", entry.type, e);
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
  // Senkrechter Zoom des Nutzers um die Mitte herum. Faktor > 1 = weiter
  // herausgezoomt, genau wie beim Ziehen an der Preisachse.
  const sc = state.compareScale > 0 ? state.compareScale : 1;
  if (sc !== 1) {
    const mid = (pMin + pMax) / 2, half = ((pMax - pMin) / 2) * sc;
    pMin = mid - half; pMax = mid + half;
  }
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

// Macht die originalen Kerzen unsichtbar, solange der Vergleichsmodus
// aktiv ist (drawCompare() zeichnet stattdessen die %-Linien auf einem
// eigenen Canvas darüber). Als eigene Funktion, damit sie an zwei Stellen
// exakt gleich angewandt wird — siehe applyTheme().
function compareHideStyles() {
  return {
    candle: {
      type: "area",
      area: {
        lineColor: "rgba(0,0,0,0)", lineSize: 0,
        backgroundColor: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0)" }],
      },
      priceMark: { last: { show: false }, high: { show: false }, low: { show: false } },
    },
    yAxis: { tickText: { color: "rgba(0,0,0,0)" }, axisLine: { color: "rgba(0,0,0,0)" }, tickLine: { color: "rgba(0,0,0,0)" } },
  };
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
    // EWT-Boxen haengen an Kurswerten und saessen auf der Prozent-Skala
    // voellig falsch — wie Muster und SMC-Zonen.
    try { clearEWT(); } catch (e) {}
    // Alle Overlays (FRVP, Zeichnungen, Fibonacci etc.) verstecken —
    // sie laufen auf Preis-Basis und hätten im %-Vergleich falsche Positionen.
    // IDs merken für Wiederherstellung.
    state._hiddenDrawingIds = [];
    state._drawingsHidden = true;
    (state.drawings || []).forEach(d => {
      try { chart.removeOverlay(d.id); state._hiddenDrawingIds.push(d.id); } catch (e) {}
    });
    if (state.tagCanvas) {
      state.tagCanvas.getContext("2d").clearRect(0, 0, state.tagCanvas.width, state.tagCanvas.height);
    }
    chart.setStyles(compareHideStyles());
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
    // Merker statt Id-Liste: Zeichnungen, die WAEHREND des Vergleichs
    // entstanden sind, haben nie eine Chart-Id bekommen und fehlten
    // deshalb in _hiddenDrawingIds.
    if (state._drawingsHidden || (state._hiddenDrawingIds && state._hiddenDrawingIds.length)) {
      state._hiddenDrawingIds = [];
      state._drawingsHidden = false;
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
  const goldMode     = state.symbol.type === "worker" || state.symbol.type === "stooq";
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
      // EWT-Strukturen haengen an dataIndex, nicht an Zeitstempeln.
      // Nach einem Intervallwechsel zeigt derselbe Index auf ein voellig
      // anderes Datum — die Zaehlungen saessen dann irgendwo. Deshalb
      // raeumen, bevor die neuen Kerzen kommen.
      try { clearEWT(); } catch (e) {}
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
      // Rechnet der Durchschnitt auf einem anderen Intervall, gehoert das
      // sichtbar in die Legende — sonst wundert man sich, warum die Linie
      // nicht zum Chart passt.
      const tfSuffix = (sv.inputs && sv.inputs.tf && sv.inputs.tf !== "auto")
        ? ` <span class="lg-tf">${sv.inputs.tf.toUpperCase()}</span>` : "";
      html += `<div class="legend-line"><span class="lg-name">${ind.label}</span>${tfSuffix}${dots}</div>`;
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
  // Waehrend des Vergleichs gezeichnet: merken, aber sofort vom Chart
  // nehmen. Sonst blieb genau diese eine Zeichnung sichtbar, weil
  // applyCompareIndicator nur die BEIM EINTRITT vorhandenen entfernt hat.
  if (state.compareAssets && state.compareAssets.length > 0) {
    state.drawings.push({
      id, name,
      points: points.map(p => ({ timestamp: p.timestamp, value: p.value })),
      extendData: extendData ?? null, styles: styles ?? null,
    });
    state._drawingsHidden = true;
    try { chart.removeOverlay(id); } catch (e) {}
    saveWorkspace();
    return;
  }
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
// Sucht das nächstgelegene Overlay zu einem Bildschirmpunkt — ohne dass es
// vorher ausgewählt sein muss. KLC selbst bietet keine getOverlays()-API,
// daher iterieren wir über alle IDs, die die App selbst mitführt.
// Gibt { overlay, pointIndex, dist } zurück oder null.
// pointIndex ist der Index des nächsten Punktes, wenn er innerhalb von
// pointTol liegt — sonst -1 (Treffer war auf der Linie, kein Einzelpunkt).
// Naechster Ankerpunkt, oder -1 wenn keiner in Greifweite liegt. Mehrfach
// gebraucht — vorher stand dieselbe Schleife in jedem Zweig.
function naechsterPunkt(ptsIdx, x, y, pointTol) {
  let idx = -1, best = Infinity;
  ptsIdx.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best) { best = d; idx = i; }
  });
  return best <= pointTol ? idx : -1;
}

function findOverlayNear(x, y, lineTol, pointTol) {
  pointTol = pointTol != null ? pointTol : lineTol;
  const ids = []
    .concat((state.drawings || []).map(d => d.id))
    .concat(state.patternOverlayIds || [])
    .concat(state.smcOverlayIds || [])
    .concat(state.ewtOverlayIds || [])
    .concat(state.gbBandIds || []);
  if (state.selectedOverlayId) ids.unshift(state.selectedOverlayId);

  const toPx = (p) => {
    try {
      const r = chart.convertToPixel(
        { timestamp: p.timestamp, value: p.value },
        { paneId: "candle_pane" }
      );
      const one = Array.isArray(r) ? r[0] : r;
      return one && one.x != null ? one : null;
    } catch (e) { return null; }
  };
  const distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  };

  let best = null;
  const seen = new Set();
  for (const id of ids) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    let ov;
    try { ov = chart.getOverlayById(id); } catch (e) { continue; }
    if (!ov || !ov.points || !ov.points.length) continue;

    // ptsIdx behaelt die Indizes: .filter(Boolean) verschiebt sie, sobald
    // sich ein Punkt nicht umrechnen laesst — dann meint pts[3] in
    // Wahrheit Punkt 4 oder fehlt ganz. Genau daran ist der Breiten-Griff
    // gescheitert. pts bleibt verdichtet fuer die allgemeine Linienpruefung.
    const ptsIdx = ov.points.map(toPx);
    const pts = ptsIdx.filter(Boolean);
    if (!pts.length) continue;

    // FRVP ist eine Fläche, keine Linie: Die zwei Ankerpunkte markieren
    // nur den Zeitbereich (beide auf derselben Höhe, der Bildschirmmitte
    // beim Zeichnen) — die sichtbaren Balken erstrecken sich aber über
    // den gesamten Kursbereich. Die normale Linien-Trefferzone würde hier
    // fast nie treffen. Für FRVP zählt deshalb die horizontale Nähe zum
    // Zeitfenster, die Höhe spielt keine Rolle.
    if (ov.name === "frvp" && pts.length >= 2) {
      const xs = pts.map(p => p.x);
      const left = Math.min(...xs) - lineTol, right = Math.max(...xs) + lineTol;
      if (x >= left && x <= right) {
        const distX = Math.min(Math.abs(x - Math.min(...xs)), Math.abs(x - Math.max(...xs)));
        if (!best || distX < best.dist) {
          best = { overlay: ov, pointIndex: -1, dist: distX };
        }
      }
      continue;
    }

    // Long/Short: Die drei Anker liegen auf dem Handy alle auf demselben
    // Zeitstempel, also auf einer einzigen senkrechten Linie. Die sichtbare
    // Zeichnung ist aber ein Kasten — overlays.js zieht Linien und
    // Preis-Schilder bis x1 = maxX + 60. Ein Tap auf das Stop- oder
    // Ziel-Schild lag damit rund 56 px neben der Anker-Linie und wurde nie
    // erkannt. Wie beim FRVP zaehlt deshalb die Flaeche, nicht die Linie.
    // Fibonacci: Die Level-Linien ziehen sich waagrecht durch den ganzen
    // Kasten. Bisher zaehlte nur die Naehe zu den zwei Ankerpunkten, ein
    // Tipp auf ein Level dazwischen ging ins Leere. Jetzt zaehlt jede
    // Level-Linie als Treffer.
    if ((ov.name === "fibRetracement" || ov.name === "fibExtension") && pts.length >= 2) {
      const levels = (typeof FIB_LEVEL_SETS !== "undefined" && FIB_LEVEL_SETS[ov.name])
        ? FIB_LEVEL_SETS[ov.name].map(l => l.v) : [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      // Die Linien liegen zwischen den beiden Ankern; y linear
      // interpolieren spart das Umrechnen ueber Kurswerte.
      if (!ptsIdx[0] || !ptsIdx[1]) continue;
      const yA = ptsIdx[0].y, yB = ptsIdx[1].y;
      const xs = [ptsIdx[0].x, ptsIdx[1].x];
      const left = Math.min(...xs) - lineTol;
      // Nach rechts laufen die Linien ueber den zweiten Anker hinaus weiter.
      const right = Math.max(...xs) + 240;
      if (x >= left && x <= right) {
        let dist = Infinity;
        for (const lv of levels) {
          const ly = yA + (yB - yA) * lv;
          dist = Math.min(dist, Math.abs(y - ly));
        }
        if (dist <= lineTol) {
          let nIdx = -1, nDist = Infinity;
          ptsIdx.forEach((p, i) => {
            if (!p) return;
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < nDist) { nDist = d; nIdx = i; }
          });
          if (!best || dist < best.dist) {
            best = { overlay: ov, pointIndex: nDist <= pointTol ? nIdx : -1, dist };
          }
        }
        continue;
      }
    }

    if (ov.name === "positionTool" && pts.length >= 2) {
      // Geometrie kommt aus overlays.js — dieselbe, die gezeichnet wurde.
      // Nachrechnen aus den Punkten fuehrte zu Abweichungen, sobald sich
      // der vierte Punkt nicht in Pixel umrechnen liess.
      const box = (window.__tvPositionBox || {})[ov.id];
      const geom = window.__tvPositionGeom || { MIN_WIDTH: 40, HANDLE_R: 7 };
      let left, right, cE, cS, cT;
      if (box) {
        ({ x0: left, x1: right, cEntry: cE, cStop: cS, cTarget: cT } = box);
      } else {
        // Noch nie gezeichnet (z. B. direkt nach dem Wiederherstellen):
        // Rueckfall auf die Punkte, mit erhaltenen Indizes.
        const xs = ptsIdx.slice(0, 3).filter(Boolean).map(p => p.x);
        if (!xs.length) continue;
        left  = Math.min(...xs);
        // Breite aus der Kerzenanzahl — dieselbe Rechnung wie in overlays.js.
        right = left + (window.__tvPositionWidthPx
          ? window.__tvPositionWidthPx(ov) : geom.MIN_WIDTH);
        cE = ptsIdx[0]; cS = ptsIdx[1]; cT = ptsIdx[2];
      }

      // Ist die Zeichnung angetippt, zaehlen NUR die drei Anfasspunkte als
      // Ziehpunkte: Stop, Ziel und der Breiten-Griff. Der Einstieg bleibt
      // liegen, und der Kasten laesst sich nicht als Ganzes verschieben.
      if (state.selectedOverlayId === ov.id && window.__tvPositionHandles) {
        const h = window.__tvPositionHandles(left, right, cE, cS, cT);
        const griff = [[1, h.stop], [2, h.target], [3, h.width]];
        const griffTol = Math.max(pointTol, geom.HANDLE_R + 14);
        let bestGriff = null;
        for (const [idx, pos] of griff) {
          if (!pos) continue;
          const d = Math.hypot(x - pos.x, y - pos.y);
          if (d <= griffTol && (!bestGriff || d < bestGriff.d)) {
            bestGriff = { d, idx };
          }
        }
        if (bestGriff) {
          if (!best || bestGriff.d < best.dist) {
            best = { overlay: ov, pointIndex: bestGriff.idx, dist: bestGriff.d };
          }
          continue;
        }
      }

      // Sonst nur Flaechentreffer: waehlt die Zeichnung aus und zeigt den
      // Schwebebalken, zieht aber nichts.
      const ys = [cE, cS, cT].filter(Boolean).map(p => p.y);
      if (!ys.length) continue;
      const top = Math.min(...ys) - lineTol, bot = Math.max(...ys) + lineTol;
      if (x >= left - lineTol && x <= right + lineTol && y >= top && y <= bot) {
        let dist = Infinity;
        for (const yy of ys) dist = Math.min(dist, Math.abs(y - yy));
        if (!best || dist < best.dist) {
          best = { overlay: ov, pointIndex: -1, dist };
        }
      }
      continue;
    }

    // Werkzeuge mit unbegrenzter Ausdehnung: Die Ankerpunkte markieren nur
    // die Lage, die sichtbare Linie zieht sich über den ganzen Chart. Ein
    // Tap darauf lag bisher weit ausserhalb der Punkt-Trefferzone.
    const INFINITE = {
      horizontalStraightLine: "h", priceLine: "h", horizontalRayLine: "h",
      verticalStraightLine:   "v", verticalRayLine:  "v",
    };
    if (INFINITE[ov.name]) {
      const dist = INFINITE[ov.name] === "h"
        ? Math.abs(y - pts[0].y)
        : Math.abs(x - pts[0].x);
      if (dist <= lineTol && (!best || dist < best.dist)) {
        const onPoint = Math.hypot(x - pts[0].x, y - pts[0].y) <= pointTol;
        best = { overlay: ov, pointIndex: onPoint ? 0 : -1, dist };
      }
      continue;
    }

    // Gerade durch zwei Punkte, in BEIDE Richtungen unendlich. Fiel bisher
    // in die Strecken-Pruefung und war nur zwischen den Ankern antippbar.
    if (ov.name === "straightLine" && pts.length >= 2) {
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        // Abstand Punkt <-> unendliche Gerade
        const dist = Math.abs(dy * (x - pts[0].x) - dx * (y - pts[0].y)) / len;
        if (dist <= lineTol && (!best || dist < best.dist)) {
          best = { overlay: ov, pointIndex: naechsterPunkt(ptsIdx, x, y, pointTol), dist };
        }
      }
      continue;
    }

    // Mehrlinige Werkzeuge: jede Parallele zaehlt, nicht nur die erste.
    if ((ov.name === "priceChannelLine" || ov.name === "parallelStraightLine") && pts.length >= 2) {
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        // Alle Anker liegen auf je einer Parallelen — Abstand zur Geraden
        // durch JEDEN Anker mit derselben Richtung pruefen.
        let dist = Infinity;
        for (const p of pts) {
          const d = Math.abs(dy * (x - p.x) - dx * (y - p.y)) / len;
          if (d < dist) dist = d;
        }
        if (dist <= lineTol && (!best || dist < best.dist)) {
          best = { overlay: ov, pointIndex: naechsterPunkt(ptsIdx, x, y, pointTol), dist };
        }
      }
      continue;
    }

    // Flaechige Werkzeuge: der ganze aufgezogene Kasten zaehlt, nicht nur
    // seine Kanten.
    const FLAECHIG = { rectangle: 1, priceRange: 1, dateRange: 1 };
    if (FLAECHIG[ov.name] && pts.length >= 2) {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const l = Math.min(...xs) - lineTol, r = Math.max(...xs) + lineTol;
      const t = Math.min(...ys) - lineTol, b = Math.max(...ys) + lineTol;
      if (x >= l && x <= r && y >= t && y <= b) {
        // Naehe zur naechsten Kante als Rangmass — ein kleineres Overlay
        // darueber gewinnt so weiterhin.
        const dist = Math.min(
          Math.abs(x - Math.min(...xs)), Math.abs(x - Math.max(...xs)),
          Math.abs(y - Math.min(...ys)), Math.abs(y - Math.max(...ys)));
        if (!best || dist < best.dist) {
          best = { overlay: ov, pointIndex: naechsterPunkt(ptsIdx, x, y, pointTol), dist };
        }
      }
      continue;
    }

    // rayLine läuft von Punkt 0 durch Punkt 1 und darüber hinaus weiter.
    if (ov.name === "rayLine" && pts.length >= 2) {
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const t = ((x - pts[0].x) * dx + (y - pts[0].y) * dy) / (len * len);
        const tc = Math.max(0, t);   // nur nach vorn verlängern, nicht rückwärts
        const cx = pts[0].x + tc * dx, cy = pts[0].y + tc * dy;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist <= lineTol && (!best || dist < best.dist)) {
          let nIdx = -1, nDist = Infinity;
          ptsIdx.forEach((p, i) => {
            if (!p) return;
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < nDist) { nDist = d; nIdx = i; }
          });
          best = { overlay: ov, pointIndex: nDist <= pointTol ? nIdx : -1, dist };
        }
      }
      continue;
    }

    // Nächster Einzelpunkt
    let nearestIdx = -1, nearestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });

    // Nächste Distanz zu einem Liniensegment (falls mehrere Punkte)
    let segDist = nearestDist;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSeg(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < segDist) segDist = d;
    }

    if (segDist <= lineTol && (!best || segDist < best.dist)) {
      best = {
        overlay: ov,
        pointIndex: nearestDist <= pointTol ? nearestIdx : -1,
        dist: segDist,
      };
    }
  }
  return best;
}

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
  // Im Vergleichsmodus gehoert NICHTS auf den Chart: die Zeichnungen haengen
  // an Kurswerten und saessen auf der Prozent-Skala voellig falsch.
  // Frueher lief dieser Pfad trotzdem — beim Start nach loadData() und beim
  // Laden eines Layouts — und holte die Zeichnungen zurueck, nachdem
  // applyCompareIndicator sie eben entfernt hatte.
  if (state.compareAssets && state.compareAssets.length > 0) {
    state.drawings = list.map(d => ({ ...d }));
    state._drawingsHidden = true;
    return;
  }
  state.drawings = [];
  list.forEach(d => {
    try {
      const id = chart.createOverlay({
        ...dragGuardsFor(d.name),
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

// Baut die Overlay-Konfiguration. Ausgelagert, damit auch der
// Long/Short-Weg auf dem Handy dieselbe Konfiguration bekommt.
// KLineCharts zieht ein beruehrtes Overlay von sich aus und verschiebt dabei
// ALLE Punkte — auf dem Handy wanderte der Long/Short-Kasten deshalb mit,
// statt sich am Breiten-Griff zu verbreitern. Ein true aus diesen Handlern
// bedeutet "verarbeitet, kein Standardverhalten".
//
// Bewusst NICHT ueber lock:true geloest: lock wird beim Speichern nicht
// mitgeschrieben, nach einem Neuladen waere das Verhalten also ein anderes.
// Und bewusst NICHT in der Overlay-Registrierung (overlays.js), weil das den
// Desktop mitaendern wuerde — Regel 1.
const DRAG_GUARDS = {
  onPressedMoveStart: () => true,
  onPressedMoving:    () => true,
  onPressedMoveEnd:   () => true,
};

function mobileDragGuards() {
  if (!window.matchMedia("(max-width: 720px), (pointer: coarse)").matches) return {};
  return { ...DRAG_GUARDS };
}

// Long/Short wird IMMER selbst gezogen — auch am Desktop. KLineCharts wuerde
// sonst alle drei Punkte gemeinsam verschieben, statt Stop, Ziel und Breite
// einzeln zu behandeln. Fuer alle anderen Werkzeuge bleibt der
// Desktop-Zug von KLineCharts unveraendert (Regel 1).
function dragGuardsFor(overlayName) {
  if (overlayName === "positionTool") return { ...DRAG_GUARDS };
  return mobileDragGuards();
}

function buildOverlayConfig(overlayName) {
  return {
    ...dragGuardsFor(overlayName),
    name: overlayName,
    mode: state.magnetMode,
    // KLineCharts snappt im Magnet-Modus an alle vier OHLC-Werte (High, Low,
    // Open, Close) — aber nur innerhalb von modeSensitivity Pixeln. Der
    // Default 8 ist so eng, dass sich nur das Einrasten nahe der Kerzenmitte
    // bemerkbar macht. Grösserer Fangbereich = spürbares Einrasten an allen
    // vier Punkten.
    modeSensitivity: 40,
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
}

function startTool(overlayName) {
  window.__tvStartTool = startTool;   // Draw-Sheet-Zugriff
  // Freihand und Polyline laufen über eigene Maus-Handler, nicht über KLineCharts
  if (overlayName === "freehand") { stopPolyline(); startFreehand(); return; }
  // Polylinie: auf dem Desktop weiterhin der Maus-Weg, auf dem Handy das
  // Fadenkreuz-System (unbegrenzte Punkte, Abschluss über den ✓-Knopf).
  if (overlayName === "polyline" && !tvIsMobile()) { stopFreehand(); startPolyline(); return; }
  stopFreehand();
  stopPolyline();
  state.activeTool = overlayName;
  const overlayConfig = buildOverlayConfig(overlayName);
  // FRVP: zuletzt gespeicherte Einstellungen als Vorlage (Punkt 4),
  // sonst die eingebauten Defaults.
  if (overlayName === "frvp") {
    overlayConfig.extendData = state.frvpDefaults || {
      rows: 150, valueArea: 70, width: 30, opacity: 55,
      showVAH: true, showVAL: true, showPOC: true,
      colorUp: "rgba(63,182,139,0.55)", colorDown: "rgba(208,94,94,0.55)",
      colorVAH: "#e8b64c", colorVAL: "#e8b64c", colorPOC: "#ffffff" };
  }
  // Mobile: KLCs eigener klick-basierter Erstellungsmodus (ausgelöst durch
  // chart.createOverlay() OHNE points) hört auf dieselben touchstart/
  // touchend-Ereignisse wie jede eigene Touch-Geste — das war über mehrere
  // Anläufe hinweg die Ursache wiederkehrender Kollisionen zwischen
  // Zeichnen, Stil-Menü und Verschieben. Der saubere Ausweg: KLC bekommt
  // auf dem Handy nie die Chance, selbst zu reagieren. Die App sammelt die
  // Punkte komplett selbst (Fadenkreuz) und ruft createOverlay() erst am
  // Ende MIT fertigen points auf — das ist kein interaktiver Modus mehr.
  if (tvIsMobile() && overlayName !== "frvp") {
    startMobilePointTool(overlayName, overlayConfig);
    renderDrawbar();
    return;
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
// Der Abdunkler haengt an body.menu-open (style.css: body.menu-open::after,
// z-index 649, pointer-events:all). Wird die Klasse beim Schliessen nicht
// entfernt, bleibt der Bildschirm dunkel und nimmt keine Eingaben mehr an.
// Darum nie blind entfernen, sondern immer aus dem tatsaechlichen Zustand
// ALLER Menues ableiten — sonst reisst das Schliessen eines Menues den
// Abdunkler weg, waehrend ein anderes noch offen ist.
const TV_MENU_IDS = ["overlayMenu", "frvpMenu", "fibMenu", "posMenu"];
function syncMenuOpen() {
  const anyOpen = TV_MENU_IDS.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
  document.body.classList.toggle("menu-open", anyOpen);
}

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

// Long/Short hat keine Linie im ueblichen Sinn, sondern zwei Flaechen.
// Deshalb ein eigenes Menue statt einer Erweiterung von #overlayMenu — das
// gilt fuer ALLE Zeichnungen und wuerde jedes andere Werkzeug mitveraendern.
function openPositionMenu(overlay, event) {
  const menu = document.getElementById("posMenu");
  if (!menu) return;
  const { x, y } = menuPosition(event, 210, 190);
  // placeMenu positioniert nur — es blendet NICHT ein. Ohne diese Zeile
  // blieb das Menue unsichtbar, obwohl alles andere richtig lief.
  menu.classList.remove("hidden");
  placeMenu(menu, x, y);
  syncMenuOpen();

  const ed = overlay.extendData || {};
  const stopEl = document.getElementById("posStopColor");
  const tgtEl  = document.getElementById("posTargetColor");
  const opEl   = document.getElementById("posOpacity");
  const opVal  = document.getElementById("posOpacityVal");
  stopEl.value = ed.stopColor   || "#d05e5e";
  tgtEl.value  = ed.targetColor || "#3fb68b";
  opEl.value   = ed.zoneOpacity != null ? ed.zoneOpacity : 10;
  opVal.textContent = opEl.value + "%";

  // Live anwenden, kein separater Uebernehmen-Knopf.
  const apply = () => {
    opVal.textContent = opEl.value + "%";
    try {
      const cur = chart.getOverlayById(overlay.id);
      const ext = {
        ...(cur && cur.extendData ? cur.extendData : {}),
        stopColor: stopEl.value,
        targetColor: tgtEl.value,
        zoneOpacity: parseInt(opEl.value, 10),
      };
      chart.overrideOverlay({ id: overlay.id, extendData: ext });
      const rec = state.drawings.find(d => d.id === overlay.id);
      if (rec) { rec.extendData = ext; saveWorkspace(); }
    } catch (e) {}
  };
  stopEl.oninput = apply;
  tgtEl.oninput  = apply;
  opEl.oninput   = apply;

  const del = document.getElementById("posDelete");
  if (del) del.onclick = (e) => {
    e.stopPropagation();
    quiet(() => {
      chart.removeOverlay(overlay.id);
      state.drawings = (state.drawings || []).filter(d => d.id !== overlay.id);
      state.selectedOverlayId = null;
      saveWorkspace();
    }, "posMenu delete");
    menu.classList.add("hidden");
    syncMenuOpen();
  };
}

quiet(() => {
  const x = document.getElementById("posMenuClose");
  const m = document.getElementById("posMenu");
  if (!x || !m) return;
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    m.classList.add("hidden");
    syncMenuOpen();
  });
  document.addEventListener("click", (e) => {
    if (!m.classList.contains("hidden") && !m.contains(e.target)) {
      m.classList.add("hidden");
      syncMenuOpen();
    }
  });
}, "posMenu close");

function openOverlayMenu(overlay, event) {
  // Long/Short bekommt sein eigenes, schlankes Menue.
  if (overlay && overlay.name === "positionTool") return openPositionMenu(overlay, event);
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
  document.body.classList.add("menu-open");
  clampMenuToViewport(menu);
  document.getElementById("overlayDelete").onclick = () => {
    chart.removeOverlay(overlay.id);
    menu.classList.add("hidden");
    syncMenuOpen();
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
  if (om && !om.contains(e.target)) {
    om.classList.add("hidden");
    // Ohne diese Ableitung blieb der Abdunkler nach dem Wegtippen liegen.
    syncMenuOpen();
  }
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
  document.body.classList.add("menu-open");

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
    syncMenuOpen();
  };
  document.getElementById("frvpDelete").onclick = () => {
    chart.removeOverlay(overlay.id);
    menu.classList.add("hidden");
    syncMenuOpen();
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

// Der Zeichenstil-Knopf ist ab m33 aus der Seitenleiste entfernt: der
// Stil einer Zeichnung wird ueber den Schwebebalken (Stift-Symbol) am
// ausgewaehlten Objekt gesetzt. state.drawStyle bleibt als Vorgabe fuer
// neue Zeichnungen bestehen und wird weiterhin aus dem Workspace geladen.

// Zeichenwerkzeug-Kategorien
// Einheitliche Symbolgarnitur im Stil der TradingView-Zeichnungsliste.
// Auf MODULEBENE, nicht in initDrawSheet: die Desktop-Leiste braucht sie
// ebenfalls, und initDrawSheet steigt auf dem Desktop frueh aus.
// Urspruenglich im Stil der TradingView-Zeichnungsliste: dünne
// Linien, hohle Ankerpunkte. Der Ankerpunkt nimmt die Blattfarbe als
// Füllung, damit er als Loch wirkt und in beiden Themes stimmt.
const DS_STROKE = "fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round";
const DS_DOT    = "fill:var(--bg-raised);stroke:currentColor;stroke-width:1.5";
const dsSvg = (inner) => `<svg viewBox="0 0 24 24" class="ds-icon" aria-hidden="true">${inner}</svg>`;
const dsDot = (x, y) => `<circle cx="${x}" cy="${y}" r="2.1" style="${DS_DOT}"/>`;
const dsLine = (d) => `<path d="${d}" style="${DS_STROKE}"/>`;

const TOOL_ICONS = {
  straightLine:           dsSvg(dsLine("M2 22 L22 2") + dsDot(8,16) + dsDot(16,8)),
  segment:                dsSvg(dsLine("M6 18 L18 6") + dsDot(6,18) + dsDot(18,6)),
  rayLine:                dsSvg(dsLine("M6 18 L22 2") + dsDot(6,18) + dsDot(14,10)),
  horizontalStraightLine: dsSvg(dsLine("M2 12 H22") + dsDot(9,12)),
  verticalStraightLine:   dsSvg(dsLine("M12 2 V22") + dsDot(12,9)),
  horizontalRayLine:      dsSvg(dsLine("M5 12 H22") + dsDot(5,12)),
  // Nur auf dem Desktop im Katalog (auf dem Handy vom Parallelkanal
  // abgedeckt) — braucht trotzdem ein Symbol fuer das Fly-Out.
  parallelStraightLine:   dsSvg(dsLine("M3 15 L14 5") + dsLine("M7 19 L18 9") + dsLine("M11 23 L22 13") + dsDot(3,15) + dsDot(14,5)),
  priceChannelLine:       dsSvg(dsLine("M3 17 L15 7") + dsLine("M9 21 L21 11") + dsDot(3,17) + dsDot(15,7) + dsDot(21,11)),
  fibRetracement:         dsSvg(dsLine("M4 6 H22 M4 11 H22 M4 16 H22 M4 21 H22") + dsDot(4,6) + dsDot(4,21)),
  fibExtension:           dsSvg(dsLine("M4 13 L11 6 L18 10") + dsLine("M4 17 H22 M4 21 H22") + dsDot(11,6) + dsDot(18,10)),
  frvp:                   dsSvg(dsLine("M4 5 H13 M4 10 H9 M4 15 H17 M4 20 H7") + dsLine("M21 4 V20")),
  priceRange:             dsSvg(dsLine("M12 20 V5 M8 9 L12 5 L16 9") + dsLine("M6 20 H18") + dsDot(19,4) + dsDot(5,20)),
  avwap:                  dsSvg(dsLine("M8 5 V19 M12 3 V21 M16 6 V18") + dsLine("M4 17 L20 7")),
  dateRange:              dsSvg(dsLine("M4 12 H20 M16 8 L20 12 L16 16") + dsLine("M4 6 V18") + dsDot(21,5) + dsDot(3,19)),
  rectangle:              dsSvg(dsLine("M5 6 H19 V18 H5 Z") + dsDot(5,6) + dsDot(19,6) + dsDot(5,18) + dsDot(19,18)),
  polyline:               dsSvg(dsLine("M3 18 L8 11 L13 15 L19 6") + dsLine("M15 5 L20 5 L20 10")),
  priceLine:              dsSvg(dsLine("M3 10 H17") + `<rect x="18" y="7" width="4" height="6" rx="1" style="fill:currentColor;stroke:none"/>` + dsDot(3,10)),
  simpleAnnotation:       dsSvg(dsLine("M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z")),
  freehand:               dsSvg(dsLine("M17 3.5a2.6 2.6 0 1 1 3.7 3.7L8 20 3 21.5 4.5 16.5 17 3.5z")),
};
const DRAW_CATEGORIES = [
  {
    id: "lines", title: "Linien",
    icon: TOOL_ICONS.segment,
    tools: [
      { overlay: "straightLine",            label: "Verlängerte Linie", desc: "Gerade durch zwei Punkte, endlos in beide Richtungen" },
      { overlay: "segment",                label: "Trendlinie",       desc: "Verbindet Hochs oder Tiefs" },
      { overlay: "horizontalStraightLine",  label: "Horizontale Linie",desc: "Support- und Resistance-Level" },
      { overlay: "verticalStraightLine",    label: "Vertikale Linie",  desc: "Zeitereignis markieren" },
      { overlay: "priceLine",               label: "Preislinie",       desc: "Horizontale mit Preislabel" },
      { overlay: "rectangle",               label: "Rechteck",         desc: "Preiszonen, Orderblöcke" },
      { overlay: "rayLine",                 label: "Strahl",           desc: "Halbgerade ab einem Punkt" },
      { overlay: "horizontalRayLine",       label: "Horizontaler Strahl", desc: "Waagrechte ab einem Punkt in eine Richtung" },
      { overlay: "priceChannelLine",        label: "Parallelkanal",    desc: "Zwei parallele Trendlinien" },
      { overlay: "parallelStraightLine",    label: "Parallele Linien", desc: "Mehrere parallele Geraden" },
      { overlay: "polyline",                label: "Polylinie",         desc: "Mehrpunkt-Linie, ESC zum Beenden" },
    ],
  },
  {
    id: "zones", title: "Zonen & Profile",
    icon: TOOL_ICONS.frvp,
    tools: [
      { overlay: "frvp",        label: "Fixed Range Vol.",  desc: "Volumen pro Preisstufe" },
      { overlay: "avwap",       label: "Anchored VWAP",     desc: "VWAP ab einem Klick-Punkt" },
    ],
  },
  {
    id: "fib", title: "Fibonacci",
    icon: TOOL_ICONS.fibRetracement,
    tools: [
      { overlay: "fibRetracement", label: "Fib Retracement", desc: "Korrektur-Ziele nach Impuls" },
      { overlay: "fibExtension",   label: "Fib Extension",   desc: "Kursziele projizieren (3 Punkte)" },
    ],
  },
  {
    id: "measure", title: "Messwerkzeuge",
    icon: TOOL_ICONS.priceRange,
    tools: [
      { overlay: "priceRange", label: "Preisspanne",  desc: "Prozentuale Preisänderung" },
      { overlay: "dateRange",  label: "Zeitspanne",   desc: "Zeit und Kerzenanzahl" },
    ],
  },
  {
    id: "annot", title: "Annotationen",
    icon: TOOL_ICONS.simpleAnnotation,
    tools: [
      { overlay: "simpleAnnotation", label: "Textfeld",  desc: "Notiz an eine Kerze heften" },
      { overlay: "freehand",         label: "Freihand",  desc: "Frei zeichnen mit gedrückter Maus" },
    ],
  },
];

// Panel-Knoepfe, die auf dem Desktop aus der Topbar in die Seitenleiste
// wandern. Reihenfolge = Reihenfolge in der Leiste.
const DRAWBAR_PANEL_IDS = [
  "gridBotBtn", "posToolTopBtn", "patternDropdown", "smcDropdown", "ewtDropdown",
];

function renderDrawbar() {
  const bar = document.getElementById("drawbar");
  if (!bar) return;

  // ── Persistenter Kopf mit den Panel-Knoepfen ──
  //
  // WICHTIG: Diese Knoepfe stammen aus der Topbar und tragen ihre
  // Ereignis-Handler seit dem Start der App. renderDrawbar() laeuft bei
  // jedem Werkzeugwechsel, Magnet- und Pin-Klick erneut. Wuerden sie im
  // geleerten Bereich liegen, wuerde `innerHTML = ""` sie samt Handlern
  // vernichten und jedes spaetere getElementById liefe ins Leere.
  // Deshalb ein eigener Container, der nur EINMAL befuellt und danach nie
  // wieder angefasst wird.
  let head = bar.querySelector(".drawbar-panels");
  if (!head) {
    head = document.createElement("div");
    head.className = "drawbar-panels";
    bar.appendChild(head);
    // Auf dem Handy bleibt das DOM unangetastet: dort liegt die Drawbar
    // ohnehin auf display:none und die Knoepfe gehoeren in die Bottom Bar.
    // Die Abfrage steht wortgleich hier statt ueber tvIsMobile(), weil das
    // ein spaeter deklariertes const ist (temporale Todeszone).
    if (!window.matchMedia("(max-width: 720px), (pointer: coarse)").matches) {
      DRAWBAR_PANEL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) head.appendChild(el);
      });
      if (head.childElementCount) {
        const sepHead = document.createElement("div");
        sepHead.className = "draw-sep";
        head.appendChild(sepHead);
      }
    }
  }

  // ── Werkzeug-Teil: wird bei jedem Aufruf neu gebaut ──
  let tools = bar.querySelector(".drawbar-tools");
  if (tools) tools.remove();
  tools = document.createElement("div");
  tools.className = "drawbar-tools";
  bar.appendChild(tools);

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
      // Symbol links neben dem Text — dieselbe Garnitur wie auf dem Handy,
      // nur als Liste statt Kachelraster.
      item.innerHTML =
        `<span class="dpi-icon">${TOOL_ICONS[tool.overlay] || ""}</span>` +
        `<span class="dpi-text"><span class="dpi-name">${tool.label}</span>` +
        `<span class="dpi-desc">${tool.desc}</span></span>`;
      item.addEventListener("click", () => {
        popup.classList.remove("open");
        startTool(tool.overlay);
      });
      popup.appendChild(item);
    });
    group.appendChild(popup);
    tools.appendChild(group);
  });

  const sep1 = document.createElement("div"); sep1.className = "draw-sep"; tools.appendChild(sep1);

  // Magnet
  const magnet = document.createElement("button");
  magnet.className = "draw-cat-btn small" + (state.magnetMode !== "normal" ? " active" : "");
  magnet.title = state.magnetMode === "normal" ? "Magnet: aus" : "Magnet: ein";
  // Hufeisen mit Blitz, wie auf dem Handy. Farben als Inline-style, weil die
  // Kerben an den Polen die Leistenfarbe brauchen.
  // Gleiches Hufeisen mit Blitz wie auf dem Handy.
  // Gleiches Symbol wie auf dem Handy: 45 Grad gedrehtes Hufeisen mit
  // abgesetzten Pol-Enden und freiem Blitz darueber.
  magnet.innerHTML = `<svg viewBox="0 0 24 24" style="width:20px;height:20px">
    <g transform="rotate(45 11 13.5)">
      <path d="M4.5 6 L8.8 6 L8.8 13.6 Q8.8 16.6 11 16.6 Q13.2 16.6 13.2 13.6 L13.2 6 L17.5 6 L17.5 13.6
               Q17.5 20.2 11 20.2 Q4.5 20.2 4.5 13.6 Z" style="fill:currentColor;stroke:none"/>
      <rect x="4.7" y="6.2" width="3.9" height="3.4" style="fill:var(--bg-raised);stroke:none"/>
      <rect x="13.4" y="6.2" width="3.9" height="3.4" style="fill:var(--bg-raised);stroke:none"/>
    </g>
    <path d="M16.2 0.6 L22.4 0.6 L19.6 5.2 L23 5.2 L15.4 12.4 L18.2 6.6 L14.6 6.6 Z"
          style="fill:currentColor;stroke:none"/>
  </svg>`;
  magnet.addEventListener("click", () => {
    state.magnetMode = state.magnetMode === "normal" ? "strong_magnet" : "normal";
    renderDrawbar();
  });
  tools.appendChild(magnet);

  // Pin
  const pin = document.createElement("button");
  pin.className = "draw-cat-btn small" + (state.pinTool ? " active" : "");
  pin.title = state.pinTool ? "Werkzeug bleibt aktiv" : "Werkzeug nach Zeichnung deaktivieren";
  pin.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M9 4v6l-2 4v2h10v-2l-2-4V4M12 16v5M8 4h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  pin.addEventListener("click", () => { state.pinTool = !state.pinTool; renderDrawbar(); });
  tools.appendChild(pin);

  const sep2 = document.createElement("div"); sep2.className = "draw-sep"; tools.appendChild(sep2);

  // Alles löschen
  const clear = document.createElement("button");
  clear.className = "draw-cat-btn small danger";
  clear.title = "Alle Zeichnungen löschen";
  clear.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  clear.addEventListener("click", () => chart.removeOverlay());
  tools.appendChild(clear);
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

  // Topbar-Zeile 2 (Mobile) mitversorgen
  const tb2p = document.getElementById("tb2Price");
  const tb2c = document.getElementById("tb2Change");
  if (tb2p) tb2p.textContent = priceStr;
  if (tb2c) {
    tb2c.textContent = changeStr;
    tb2c.className = "tb2-change " + (change >= 0 ? "up" : "down");
  }

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
  placeLogScaleBtn();
}
new ResizeObserver(resize).observe(document.querySelector(".workspace"));
// Die Statusleiste kann bei langem Text auf zwei oder mehr Zeilen wachsen.
// Der Chart darüber muss dann neu vermessen werden, sonst behält seine
// Zeichenfläche die alte Höhe und die Zeitachse verschwindet hinter der
// Statusleiste.
quiet(() => {
  const sl = document.getElementById("statusline");
  if (sl) new ResizeObserver(() => resize()).observe(sl);
}, "statusline resize");

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
  // Nur auf dem Handy aufbauen. Der einzige Oeffner (#drawSheetBtn) ist
  // mobile-only, das Blatt ist auf dem Desktop also unerreichbar — trotzdem
  // wurde sein Inhalt dort bisher erzeugt. #drawSheetGrid bleibt im
  // Desktop-Modus jetzt leer, genau wie #tbRow1 und #bottomBar.
  //
  // NICHT tvIsMobile() verwenden: das ist ein const weiter unten in der
  // Datei (Zeile ~4724). Diese IIFE laeuft bereits waehrend der
  // Skriptauswertung, der Name liegt dann in der temporalen Todeszone und
  // der Zugriff wirft "Cannot access before initialization" — was die
  // Auswertung der ganzen app.js abbricht. Die Abfrage steht deshalb
  // wortgleich direkt hier.
  if (!window.matchMedia("(max-width: 720px), (pointer: coarse)").matches) return;



  // EIGENER Mobile-Katalog, absichtlich NICHT aus DRAW_CATEGORIES abgeleitet.
  // DRAW_CATEGORIES versorgt auch die Desktop-Leiste: würde man dort etwas
  // entfernen, umsortieren oder ergänzen, änderte sich die Desktop-Fassung
  // mit. Der Aufbau folgt der TradingView-Zeichnungsliste (Gruppen und
  // Reihenfolge), damit die Handbewegung dieselbe bleibt.
  //
  // Bewusst NICHT enthalten:
  //   positionTool         — sitzt als eigener Knopf in der Bottom Bar
  //   parallelStraightLine — vom Parallelkanal abgedeckt
  const MOBILE_DRAW_GROUPS = [
    { title: "Trendlinien", tools: [
      { overlay: "straightLine",           label: "Verlängerte Linie" },
      { overlay: "segment",                label: "Trendlinie" },
      { overlay: "rayLine",                label: "Strahl" },
      { overlay: "horizontalStraightLine", label: "Horizontale Linie" },
      { overlay: "verticalStraightLine",   label: "Vertikale Linie" },
      { overlay: "horizontalRayLine",      label: "Horizontaler Strahl" },
      { overlay: "priceChannelLine",       label: "Paralleler Kanal" },
    ]},
    { title: "Gann und Fibonacci", tools: [
      { overlay: "fibRetracement", label: "Fib-Retracement" },
      { overlay: "fibExtension",   label: "Fib-Extension" },
    ]},
    { title: "Prognosen und Messungen", tools: [
      { overlay: "frvp",       label: "Fixed Range Vol." },
      { overlay: "priceRange", label: "Preisspanne" },
      { overlay: "avwap",      label: "Verankerter VWAP" },
      { overlay: "dateRange",  label: "Datumsbereich" },
    ]},
    { title: "Geometrische Formen", tools: [
      { overlay: "rectangle", label: "Rechteck" },
      { overlay: "polyline",  label: "Pfad" },
    ]},
    // Vorhandene Werkzeuge, die in den TradingView-Favoriten nicht auftauchen.
    // Hier gesammelt, damit nichts stillschweigend verschwindet.
    { title: "Weitere", tools: [
      { overlay: "priceLine",        label: "Preislinie" },
      { overlay: "simpleAnnotation", label: "Textfeld" },
      { overlay: "freehand",         label: "Freihand" },
    ]},
  ];

  MOBILE_DRAW_GROUPS.forEach(group => {
    const head = document.createElement("div");
    head.className = "draw-sheet-group";
    head.textContent = group.title;
    grid.appendChild(head);

    group.tools.forEach(t => {
      const item = document.createElement("div");
      item.className = "draw-sheet-item";
      item.dataset.tool = t.overlay;
      item.innerHTML = (TOOL_ICONS[t.overlay] || "") + `<span>${t.label}</span>`;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        quiet(() => startTool(t.overlay), "draw-sheet " + t.overlay);
        closeSheet();
      });
      grid.appendChild(item);
    });
  });

  const openSheet  = () => { sheet.classList.remove("hidden"); backdrop.classList.remove("hidden"); };
  const closeSheet = () => { sheet.classList.add("hidden");    backdrop.classList.add("hidden");    };
  btn.addEventListener("click", () => sheet.classList.contains("hidden") ? openSheet() : closeSheet());
  backdrop.addEventListener("click", closeSheet);
})();

// Mobile Info-Bar
(function initMobileInfoBar() {
  const mibAsset   = document.getElementById("mibAsset");
  const mibTf      = document.getElementById("mibTf");
  const mibCompare = document.getElementById("mibCompare");
  if (!mibAsset) return;
  mibAsset.addEventListener("click", () => document.getElementById("assetTrigger")?.click());
  mibTf.addEventListener("click",   () => document.getElementById("tfTrigger")?.click());
  // K2: bisher ohne Handler — Tap auf "+" tat auf dem Handy nichts.
  mibCompare?.addEventListener("click", () => document.getElementById("compareTrigger")?.click());
})();

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
        quiet(() => {
          autoScaleY();
          // Auch der Vergleichs-Zoom gehoert zurueckgesetzt.
          state.compareScale = 1;
          if (state.compareAssets.length > 0) { try { drawCompare(); } catch (e) {} }
          setStatus("Preisachse zurückgesetzt");
        }, "axis dbltap");
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
        // Der Vergleichs-Zoom wird ebenfalls relativ zum Startwert gerechnet,
        // sonst driftet er bei jedem Frame weiter.
        const b = Object.assign({}, r);
        b.__cmpScale = state.compareScale > 0 ? state.compareScale : 1;
        yDrag = { startY: t.pageY, base: b, yAxis };
      }, "yDrag start");
      return;
    }

    // Langer Druck als Menü-Auslöser wurde verworfen — er kollidierte mit
    // dem Verschieben-Drag (siehe drag-move-init) und war redundant zum
    // Doppeltipp. lpTimer/lpStart bleiben deklariert, laufen aber nie an.
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
        // Im Vergleichsmodus haengen die Linien an einer EIGENEN
        // Prozent-Skala. Ohne diesen Schritt bewegte sich beim Ziehen nur
        // das Raster im Hintergrund, die Graphen blieben stehen.
        if (state.compareAssets.length > 0) {
          state.compareScale = (base.__cmpScale || 1) * scale;
          try { drawCompare(); } catch (e) {}
        }
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

  const endTouch = () => { cancelLP(); yDrag = null; };
  el.addEventListener("touchend",    endTouch, { passive: true });
  el.addEventListener("touchcancel", endTouch, { passive: true });
})();

// ---------- Workspace speichern ----------
function saveWorkspace() {
  try {
    localStorage.setItem("tv_workspace", JSON.stringify({
      symbol: state.symbol,
      timeframeId: state.timeframe.id,
      active: [...state.active],
      chartType: state.chartType,
      legendCollapsed: state.legendCollapsed,
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
      ewtOpts:    state.ewtOpts,
      logScale:   state.logScale,
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
  if (sym.type === "worker" || sym.type === "stooq") state.timeframe = CONFIG.TIMEFRAMES.find(t => t.id === "1d");
  // Hinweis: In m29 wurde hier der Charttyp fuer Indizes auf "area"
  // erzwungen, weil die damalige Quelle (FRED) nur Schlusskurse lieferte
  // und Kerzen deshalb koerperlose Striche gewesen waeren. Seit der Worker
  // primaer Yahoo abfragt, kommt echtes OHLC — Kerzen sind wieder sinnvoll,
  // und die Wahl bleibt beim Nutzer. Faellt Yahoo aus und FRED springt ein,
  // sind Kerzen wieder inhaltsleer; das ist der bewusst in Kauf genommene
  // Preis dafuer, dass der Chart in dem Fall ueberhaupt Daten zeigt.
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
  state.ewtOverlayIds = [];
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

  // Merkt, zu welcher Pill das Popover gerade offen ist — nur so kann ein
  // erneuter Tipp auf dieselbe Pill wieder schliessen.
  let openFor = null;

  const closePopover = () => {
    popover.classList.add("hidden");
    openFor = null;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  };

  document.querySelectorAll(".cycle-pill").forEach(pill => {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      const data = pill._cycleData;
      if (!data) return;

      // Zweiter Tipp auf dieselbe Pill schliesst wieder. Vorher liess sich
      // das Popover nur durch Antippen des Popovers selbst schliessen —
      // oder man wartete die fuenf Sekunden ab.
      if (openFor === pill && !popover.classList.contains("hidden")) {
        closePopover();
        return;
      }
      openFor = pill;

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
  document.body.classList.add("menu-open");
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
  syncMenuOpen();
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

// ---------- Elliott-Wellen-Scanner (Welle 3 / Golden Pocket) ----------
// Aufbau exakt analog zu scanPatterns()/scanSMC(): auf Knopfdruck ueber
// den sichtbaren Bereich, Ergebnis als Overlays, einzeln per Rechtsklick
// loeschbar. Die gesamte Rechnung steckt in ewt.js — hier nur das
// Einsammeln der Optionen, das Zeichnen und die Statuszeile.

function clearEWT() {
  (state.ewtOverlayIds || []).forEach(id => {
    try { chart.removeOverlay(id); } catch (e) {}
  });
  state.ewtOverlayIds = [];
  // Der Scan vergroessert den rechten Rand, damit Projektionen Platz
  // haben. Ohne Ruecksetzen bliebe die Luecke nach dem Loeschen stehen.
  if (state.ewtOffsetRaised) {
    try { chart.setOffsetRightDistance(state.ewtOffsetPrev || 80); } catch (e) {}
    state.ewtOffsetRaised = false;
  }
}

// Liest die Zahlenfelder aus dem Panel. Leere oder unsinnige Eingaben
// fallen auf die Engine-Defaults zurueck, statt NaN in die Rechnung zu
// tragen.
function ewtReadOpts() {
  const num = (id, min, max, def) => {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    if (!isFinite(v)) return def;
    return Math.max(min, Math.min(max, v));
  };
  const chk = (id, def) => {
    const el = document.getElementById(id);
    return el ? el.checked : def;
  };
  const D = (typeof EWTEngine !== "undefined" && EWTEngine.DEFAULTS) || {};
  // Wellengrade: der eingestellte Grundwert plus die beiden groeberen
  // Stufen darueber. Ohne Mehrskalen-Suche sieht man immer nur eine
  // Aufloesung — beide Referenz-Indikatoren rechnen ebenfalls mehrere
  // Laengen gleichzeitig.
  const base = Math.round(num("ewtSwing", 2, 50, 5));
  const multi = chk("ewtMultiDegree", true);
  const degrees = multi
    ? [base, Math.round(base * 1.8), Math.round(base * 3.4)]
    : [base];
  return {
    degrees,
    minPivotPercent:   num("ewtMinPivotPct", 0, 50, D.minPivotPercent),
    setupMinPercent:   num("ewtMinPct",  0, 500, D.setupMinPercent),
    timeoutBars:       num("ewtTimeout", 1, 500, D.timeoutBars),
    rsiPeriod:         num("ewtRsiPeriod", 2, 100, D.rsiPeriod),
    rsiOversold:       num("ewtRsiOs",   1,  99, D.rsiOversold),
    requireWave5NewExtreme: chk("ewtRule4", true),
    allowDiagonal:     chk("ewtDiagonal", false),
    // Skip-Tiefe: wie viele Zwischenextrema eine Teilwelle ueberspringen
    // darf. Gemessen brauchen 73 % der gefundenen Impulse einen Skip > 0 —
    // ohne diese Suche bleiben drei Viertel aller Zaehlungen unsichtbar.
    maxSkip:           Math.round(num("ewtMaxSkip", 0, 4, D.maxSkip)),
    strictness:        (document.getElementById("ewtStrict") || {}).value || D.strictness,
    maxImpulses:       Math.round(num("ewtMaxShow", 1, 60, D.maxImpulses)),
    labelMode:         (document.getElementById("ewtLabels") || {}).value || "kurz",
    // Diese drei sind bewusst standardmaessig AUS. Gemessen an 2000
    // Kerzen verwarf der RSI-Filter 76 % der Kandidaten und das Volumen
    // nochmals 53 % vom Rest — zusammen blieben 6 % uebrig. Eine
    // Wellenstruktur ist eine geometrische Aussage; Oszillatoren
    // duerfen sie bewerten, aber nicht unterdruecken.
    requireRsi:        chk("ewtUseRsi",  false),
    requireVolume:     chk("ewtUseVol",  false),
    requireEfficiency: chk("ewtUseEff",  false),
  };
}

function scanEWT() {
  if (typeof EWTEngine === "undefined") { setStatus("EWT-Modul nicht geladen"); return; }
  // Im Vergleichsmodus zeigt die Achse Prozente — Kursstrukturen waeren
  // dort falsch platziert.
  if (state.compareAssets && state.compareAssets.length > 0) {
    setStatus("EWT-Scanner ist im Vergleichsmodus nicht verfügbar");
    return;
  }
  clearEWT();

  const data = chart.getDataList();
  if (!data || data.length < 40) { setStatus("Zu wenig Daten"); return; }

  let range;
  try { range = chart.getVisibleRange(); } catch (e) { range = null; }
  const from = range ? Math.max(0, range.realFrom ?? range.from) : 0;
  const to   = range ? Math.min(data.length - 1, range.realTo ?? range.to) : data.length - 1;

  const opts = ewtReadOpts();
  state.ewtOpts = opts;
  saveWorkspace();

  let res;
  try {
    res = EWTEngine.scan(data, { from, to }, opts);
  } catch (e) {
    setStatus("EWT-Scan fehlgeschlagen: " + (e && e.message ? e.message : e));
    console.warn("[TreydView] EWT", e);
    return;
  }

  const showImp = document.getElementById("ewtShowImpulse")?.checked !== false;
  const showAbc = document.getElementById("ewtShowAbc")?.checked !== false;
  const showSet = document.getElementById("ewtShowSetup")?.checked !== false;
  const showProj = document.getElementById("ewtShowProj")?.checked !== false;
  // Etikett-Modus. Diese Zeile fehlte in m40: labelMode wurde weiter unten
  // benutzt, aber nie deklariert. Der try/catch um die Setup-Schleife
  // verschluckte den ReferenceError — sichtbar nur daran, dass gar keine
  // Projektionen mehr gezeichnet wurden.
  const labelMode = (document.getElementById("ewtLabels") || {}).value || "kurz";
  const show = {
    pending:   document.getElementById("ewtShowPending")   ?.checked !== false,
    triggered: document.getElementById("ewtShowTriggered") ?.checked !== false,
    invalid:   document.getElementById("ewtShowInvalid")   ?.checked !== false,
    timeout:   document.getElementById("ewtShowTimeout")   ?.checked !== false,
  };

  const impulses = showImp ? res.impulses : [];
  const abcs     = showAbc ? res.abcs : [];
  const setups   = showSet ? res.setups.filter(s => show[s.state]) : [];

  if (!impulses.length && !abcs.length && !setups.length) {
    // Mit Begruendung statt nur "nichts gefunden": meist liegt es an zu
    // wenig Kerzen fuer den gewaehlten Wellengrad, nicht am Kursverlauf.
    const hint = (res.degreesSkipped && res.degreesSkipped.length)
      ? ` — Grad ${res.degreesSkipped.join("/")} übersprungen, für ${data.length} Kerzen ist maximal Grad ${res.degMax} sinnvoll`
      : " — kleineren Wellengrad oder Regelstrenge „locker“ versuchen";
    setStatus("Keine EWT-Strukturen im sichtbaren Bereich" + hint);
    return;
  }

  // ACHTUNG, im Bundle verifiziert: _drawOverlay nimmt zwar
  // point.dataIndex, ueberschreibt es aber mit
  // timestampToDataIndex(point.timestamp), sobald ein timestamp gesetzt
  // ist — und diese Umrechnung KLEMMT auf den letzten Bar. Punkte mit
  // Zukunfts-Zeitstempeln fallen dadurch alle auf dieselbe x-Position
  // zusammen. Deshalb durchgehend dataIndex, OHNE timestamp.
  const lastIdx = data.length - 1;
  let maxIdxUsed = lastIdx;
  const degrees = (opts.degrees || EWTEngine.DEFAULTS.degrees);
  const rankOf = (deg) => {
    const i = degrees.indexOf(deg);
    return i < 0 ? 2 : (degrees.length - 1 - i);   // groebster Grad = Rang 0
  };

  state.ewtOverlayIds = [];
  const push = (id) => { if (id) state.ewtOverlayIds.push(Array.isArray(id) ? id[0] : id); };

  // ---------- Impulse 1-2-3-4-5 ----------
  impulses.forEach(s => {
    try {
      const id = chart.createOverlay({
        name: "ewtWave",
        points: s.points.map(p => ({ dataIndex: p.index, value: p.price })),
        lock: true,
        extendData: {
          kind: "impulse", dir: s.dir, degreeRank: rankOf(s.degree),
          labels: ["", "1", "2", "3", "4", "5"],
          label: labelMode === "aus" ? null
            : labelMode === "kurz"
              ? `${s.dir === "bull" ? "▲" : "▼"} G${s.degree} · ${Math.round(s.quality * 100)}%`
                + (s.truncated ? " · verk.5" : "")
              : `Impuls ${s.dir === "bull" ? "▲" : "▼"} Grad ${s.degree}`
                + (s.truncated ? " · verkürzte 5" : "")
                + ` · W3/W1 ${s.ratio31.toFixed(2)} · Form ${Math.round(s.quality * 100)}%`,
        },
        onMouseEnter: () => { setChartCursor("pointer"); showEWTWaveHint(s); return false; },
        onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
        onRightClick: (e) => { try { chart.removeOverlay(e.overlay.id); } catch (x) {} return true; },
      });
      push(id);
    } catch (e) { /* eine defekte Struktur darf den Rest nicht verhindern */ }
  });

  // ---------- Korrekturen A-B-C ----------
  // Zigzag, Flat und Expanded Flat unterscheiden sich im Verhalten von
  // Welle B — deshalb steht die Form im Etikett, nicht nur "A-B-C".
  const EWT_FORM = { zigzag: "Zigzag", flat: "Flat", expanded: "Expanded Flat" };
  const EWT_FORM_SHORT = { zigzag: "ZZ", flat: "FL", expanded: "EF" };
  abcs.forEach(s => {
    try {
      const id = chart.createOverlay({
        name: "ewtWave",
        points: s.points.map(p => ({ dataIndex: p.index, value: p.price })),
        lock: true,
        extendData: {
          kind: "abc", dir: s.dir, degreeRank: rankOf(s.degree),
          labels: ["", "A", "B", "C"],
          label: labelMode === "aus" ? null
            : labelMode === "kurz"
              ? `${EWT_FORM_SHORT[s.form] || "ABC"} G${s.degree}`
              : `${EWT_FORM[s.form] || "Korrektur"} · Grad ${s.degree}`
                + ` · B ${(s.ratioBA * 100).toFixed(0)}% · C ${s.ratioCA.toFixed(2)}×A`,
        },
        onRightClick: (e) => { try { chart.removeOverlay(e.overlay.id); } catch (x) {} return true; },
      });
      push(id);
    } catch (e) {}
  });

  // ---------- Welle-3-Setups (Golden Pocket) ----------
  const STATE_LABEL = { pending: "wartend", triggered: "getriggert",
                        invalid: "invalidiert", timeout: "Time-Out" };
  setups.forEach(s => {
    try {
      let endIdx;
      if (s.state === "pending") endIdx = lastIdx + 12;
      else if (s.resolvedAt != null) endIdx = s.resolvedAt + 3;
      else endIdx = lastIdx;
      if (endIdx <= s.highIndex) endIdx = s.highIndex + 6;
      maxIdxUsed = Math.max(maxIdxUsed, endIdx);

      const pts = [
        { dataIndex: s.lowIndex,  value: s.lowPrice },
        { dataIndex: s.highIndex, value: s.highPrice },
        { dataIndex: s.highIndex, value: s.boxTop },
        { dataIndex: endIdx,      value: s.boxBottom },
      ];
      // Ziel nur zeichnen, solange es erreichbar ist.
      //
      // Ein Setup, das nach dem Einstieg unter das Start-Tief gebrochen
      // ist, hat kein gueltiges Ziel mehr. Die Linie blieb trotzdem stehen
      // und schwebte weit ueber dem Kurs — sie behauptete ein Ziel, das
      // nie erreichbar war. Bei "invalidiert" entfaellt sie deshalb.
      const zielSinnvoll = s.state === "triggered" && s.outcome !== "invalidiert"
                        && s.target != null && isFinite(s.target);
      if (zielSinnvoll) {
        pts.push({ dataIndex: endIdx, value: s.target });
      }
      const outTxt = s.outcome === "ziel" ? " · Ziel erreicht"
                   : s.outcome === "invalidiert" ? " · danach gebrochen"
                   : s.outcome === "offen" ? " · offen" : "";
      push(chart.createOverlay({
        name: "ewtZone",
        points: pts,
        lock: true,
        extendData: {
          state: s.state, outcome: s.outcome,
          // "W3" stammt aus der ersten Fassung, als der Scanner nur nach
          // Welle-3-Setups suchte. Neben ausgezaehlten Impulsen mit eigenen
          // Wellen 1 bis 5 war das missverstaendlich: die Box ist die
          // Golden Pocket der Welle 2, der Einstieg zielt auf Welle 3.
          label: labelMode === "aus" ? null
            : labelMode === "kurz"
              ? `W2→W3 ${STATE_LABEL[s.state]} · ${Math.round(s.quality * 100)}%`
              : `W2→W3 ${STATE_LABEL[s.state]} · ${s.risePct.toFixed(0)}%`
                + ` · Form ${Math.round(s.quality * 100)}%${outTxt}`,
          targetLabel: zielSinnvoll
            ? "Ziel " + s.target.toLocaleString("de-CH", { maximumFractionDigits: 2 }) : null,
        },
        onMouseEnter: () => { setChartCursor("pointer"); showEWTHint(s); return false; },
        onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
        onRightClick: (e) => { try { chart.removeOverlay(e.overlay.id); } catch (x) {} return true; },
      }));

      // ---- Projektion der Folgewellen ----
      const pr = s.projection;
      if (showProj && pr) {
        const i0 = pr.startIdx != null ? pr.startIdx : lastIdx;
        const i3 = i0 + pr.barsW3, i4 = i3 + pr.barsW4, i5 = i4 + pr.barsW5;
        const iA = i5 + pr.barsA,  iB = iA + pr.barsB,  iC = iB + pr.barsC;
        maxIdxUsed = Math.max(maxIdxUsed, iC);
        const konflikt = pr.w4Conflict ? " · ⚠ W4 überlappt W1" : "";
        push(chart.createOverlay({
          name: "ewtProjection",
          points: [
            { dataIndex: i0, value: pr.anchor }, { dataIndex: i3, value: pr.w3 },
            { dataIndex: i3, value: pr.w3x },    { dataIndex: i4, value: pr.w4Bot },
            { dataIndex: i5, value: pr.w5 },     { dataIndex: iA, value: pr.waveA },
            { dataIndex: iB, value: pr.waveB },  { dataIndex: iC, value: pr.waveC },
          ],
          lock: true,
          extendData: { basis: pr.basis,
            label: labelMode === "aus" ? null
              : labelMode === "kurz" ? `Projektion?${konflikt}`
              : `Projektion? W3–W5 + A-B-C · Basis ${pr.basis}${konflikt}` },
          onMouseEnter: () => { setChartCursor("pointer"); showEWTProjHint(s, pr); return false; },
          onMouseLeave: () => { setChartCursor(""); clearPatternHint(); return false; },
          onRightClick: (e) => { try { chart.removeOverlay(e.overlay.id); } catch (x) {} return true; },
        }));
      }
    } catch (e) {}
  });

  // Rechts Platz schaffen, damit Boxen und Projektionen nicht am Rand
  // abgeschnitten werden. Nur vergroessern, nie verkleinern — sonst
  // springt die Ansicht bei jedem Scan.
  try {
    const over = maxIdxUsed - lastIdx;
    if (over > 0) {
      const need = (over + 3) * chart.getBarSpace().bar;
      const cur = chart.getOffsetRightDistance();
      if (need > cur) {
        if (!state.ewtOffsetRaised) { state.ewtOffsetPrev = cur; state.ewtOffsetRaised = true; }
        chart.setOffsetRightDistance(need);
      }
    }
  } catch (e) { /* aeltere Bundles ohne diese API */ }

  // Uebersprungene Grade ausdruecklich nennen. Sonst sucht man den
  // Fehler im Scanner, wo schlicht die Datenmenge nicht reicht: ein Grad
  // n erzeugt etwa len/(2n) Pivots, und fuer eine Fuenferzaehlung braucht
  // es sechs aufeinanderfolgende davon.
  const skipTxt = (res.degreesSkipped && res.degreesSkipped.length)
    ? ` · Grad ${res.degreesSkipped.join("/")} übersprungen (zu wenig Kerzen)` : "";
  const usedTxt = (res.degreesUsed || degrees).join("/");
  setStatus(`${impulses.length} Impulse · ${abcs.length} Korrekturen · ${setups.length} W2-Zonen`
    + ` · Grade ${usedTxt}${skipTxt} · log. Fibonacci · Rechtsklick löscht einzelne`);
}

// Kurz-Info zu einem Wellenzug: die Regelpruefung im Klartext, damit die
// Zaehlung nachvollziehbar ist statt behauptet.
function showEWTWaveHint(s) {
  if (_patHintPrev == null) _patHintPrev = document.getElementById("statusline").textContent;
  const R = s.rules;
  setStatus(
    `Impuls Grad ${s.degree} · ${s.dir === "bull" ? "bullisch" : "bärisch"}`
    + ` · W3 = ${s.ratio31.toFixed(2)}× W1 · W5 = ${s.ratio51.toFixed(2)}× W1`
    + (s.truncated ? " · verkürzte Fünfte (Erschöpfung)" : "")
    + (s.extended ? ` · Welle ${s.extended} verlängert` : "")
    + (s.equality != null ? ` · Gleichheit W1/W5 ${Math.round(s.equality * 100)}%` : "")
    + ` · Alternation ${Math.round(s.alternation * 100)}%`
    + (s.fitError != null ? ` · Anpassung ${(s.fitError * 1000).toFixed(2)}‰` : "")
    + `  ·  Regeln: W2 hält Start ${R.r1 ? "✓" : "✗"}`
    + ` · W3 nicht kürzeste ${R.r2 ? "✓" : "✗"}`
    + ` · W4 ohne Überlappung ${R.r3 ? "✓" : "✗"}`
    + ` · W5 neues Extrem ${R.r4 ? "✓" : "✗"}`
  );
}

// Kurz-Info beim Ueberfahren, wie bei Mustern und SMC-Zonen.
// Bewusst mit den Gruenden, WARUM das Setup durchkam — sonst ist die
// Box eine Behauptung ohne Beleg.
function showEWTHint(s) {
  if (_patHintPrev == null) _patHintPrev = document.getElementById("statusline").textContent;
  const nf = (v, d = 2) => v == null || !isFinite(v) ? "–"
    : v.toLocaleString("de-CH", { maximumFractionDigits: d });
  const grund = [];
  if (s.oversold)  grund.push(`RSI ${nf(s.rsiAtLow, 0)} überverkauft`);
  if (s.divergence) grund.push("bull. Divergenz");
  if (s.volRatio != null) grund.push(`Vol ${nf(s.volRatio, 1)}×`);
  grund.push(`ER ${nf(s.er, 2)}`);
  const ziel = s.target != null && isFinite(s.target) ? ` · Ziel ${nf(s.target)}` : "";
  setStatus(
    `Welle-2-Zone, Einstieg für Welle 3 · ${{ pending: "wartend", triggered: "getriggert",
                   invalid: "invalidiert", timeout: "Time-Out" }[s.state]}`
    + ` · Box ${nf(s.boxBottom)}–${nf(s.boxTop)} (log)`
    + ` · ungültig unter ${nf(s.invalidLevel)}${ziel}`
    + `  ·  ${grund.join(" · ")}`
  );
}

// Beim Ueberfahren der Projektion wird ausdruecklich gesagt, worauf sie
// beruht. Ohne diese Einordnung liest man Fibonacci-Fortschreibungen
// leicht als Prognose.
function showEWTProjHint(s, pr) {
  if (_patHintPrev == null) _patHintPrev = document.getElementById("statusline").textContent;
  const nf = (v) => v == null || !isFinite(v) ? "–"
    : v.toLocaleString("de-CH", { maximumFractionDigits: 2 });
  const basis = pr.basis === "gemessen"
    ? "gemessenes Welle-2-Tief"
    : "angenommenes Welle-2-Tief (Box-Mitte) — Setup noch nicht getriggert";
  setStatus(
    `Projektion (keine Prognose) · W3 ${nf(pr.w3)}–${nf(pr.w3x)}`
    + ` · W4 ${nf(pr.w4Bot)}–${nf(pr.w4Top)} · W5 ${nf(pr.w5)}`
    + (pr.w4Conflict ? " · ⚠ Welle 4 überlappt Welle 1 — Zählung unstimmig" : "")
    + `  ·  Basis: ${basis}`
  );
}

// ---------- Logarithmische Preisskala ----------
//
// Im Bundle verifiziert: YAxis.getType() liest getStyles().yAxis.type,
// aber NUR fuer die Kerzen-Pane (isInCandle()). Indikator-Subpanes geben
// fest YAxisType.Normal zurueck. Ein Umschalten kann RSI, MACD & Co.
// also nicht verzerren — genau das gewuenschte Verhalten.
//
// WICHTIG zum Verstaendnis: Die EWT-Rechnung ist bereits logarithmisch,
// unabhaengig von dieser Einstellung. Die Fibonacci-Niveaus haengen an
// Kurswerten, nicht an Pixeln. Der Schalter aendert nichts an der
// Mathematik — er macht sie nur SICHTBAR: auf der Log-Skala liegt das
// 0.5-Retracement optisch exakt in der Mitte der Welle, auf der linearen
// Skala erscheint dieselbe (korrekte) Box nach unten verschoben.

function applyLogScale() {
  try {
    chart.setStyles({ yAxis: { type: state.logScale ? "log" : "normal" } });
  } catch (e) {
    console.warn("[TreydView] Log-Skala nicht unterstützt", e);
    return;
  }
  const btn = document.getElementById("logScaleBtn");
  if (btn) {
    btn.classList.toggle("active", state.logScale);
    btn.title = state.logScale ? "Preisskala: logarithmisch" : "Preisskala: linear";
    btn.setAttribute("aria-pressed", state.logScale ? "true" : "false");
  }
  // VRVP und Vergleichslinien zeichnen auf ein eigenes Canvas und rechnen
  // Preise selbst in Pixel um — die muessen nach dem Achsenwechsel neu.
  try { if (state.active.has("vrvp")) requestAnimationFrame(drawVrvp); } catch (e) {}
  try { if (state.compareAssets.length > 0) drawCompare(); } catch (e) {}
}

// Sitzt am unteren Ende der Preisskala, also rechts unten ueber der
// Zeitachse. Absolut positioniert in .chart-col (position:relative);
// die Hoehe kommt aus #mainChart, damit der Knopf mitwandert, wenn sich
// die Grid-Bot-Leiste oeffnet oder schliesst.
function placeLogScaleBtn() {
  const btn = document.getElementById("logScaleBtn");
  const mc  = document.getElementById("mainChart");
  if (!btn || !mc) return;
  btn.style.top = (mc.offsetTop + mc.offsetHeight - 27) + "px";
}

(function initLogScale() {
  const btn = document.getElementById("logScaleBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    state.logScale = !state.logScale;
    applyLogScale();
    saveWorkspace();
    setStatus(state.logScale
      ? "Preisskala logarithmisch — gleiche Prozentbewegungen haben gleichen Abstand"
      : "Preisskala linear");
  });
})();

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
  // KLC merged Styles nur additiv (deep-merge) — baseStyles() kennt den
  // Vergleichsmodus nicht und setzt candle/yAxis auf ihre normalen Werte
  // zurück. Ohne diese zweite Anwendung tauchen die Original-Kerzen beim
  // Theme-Wechsel im Vergleichsmodus wieder auf.
  if (state.compareAssets.length > 0) chart.setStyles(compareHideStyles());
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
  applyLogScale();
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
// Gespeicherte Achsenwahl wiederherstellen und den Knopf positionieren.
applyLogScale();
placeLogScaleBtn();
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
// K2: wlCloseBtn (mobile-only "✕" im Watchlist-Header) hatte bisher keinen
// Handler. Explizit schliessen statt togglen — ein Schliessen-Knopf soll
// nicht wieder oeffnen koennen.
document.getElementById("wlCloseBtn")?.addEventListener("click", () => {
  state.watchlistOpen = false;
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
  const btn = document.getElementById("posToolTopBtn");
  // Zweiter Klick bricht ab — gleiche Logik wie der ESC-Handler
  if (state.activeTool === "positionTool") {
    if (state.drawingId != null) { try { chart.removeOverlay(state.drawingId); } catch (err) {} state.drawingId = null; }
    state.activeTool = null;
    btn.classList.remove("active");
    document.getElementById("lsChoice")?.classList.add("hidden");
    setStatus("Abgebrochen");
    return;
  }

  // Richtung zuerst waehlen, dann ein einziger Klick fuer den Einstieg —
  // Stop und Ziel entstehen daraus (1 % / 2 %). Ab m25 auf BEIDEN Seiten
  // gleich; der Desktop verlangte vorher drei Klicks.
  //
  // Unterschied nur in der Darstellung: auf dem Handy ein Popup ueber dem
  // Knopf, auf dem Desktop ein Dropdown darunter — dort ist Platz und der
  // Mauszeiger kommt von oben.
  const menu = document.getElementById("lsChoice");
  if (menu) {
    const r = btn.getBoundingClientRect();
    const w = 152, h = 48;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    menu.style.left = left + "px";
    menu.style.top = tvIsMobile()
      ? Math.max(6, r.top - h - 10) + "px"          // Handy: darueber
      : (r.bottom + 6) + "px";                       // Desktop: darunter
    menu.classList.remove("hidden");
    btn.classList.add("active");
    return;
  }

  startTool("positionTool");
  btn.classList.add("active");
  setStatus("Long/Short: 1. Einstieg klicken  →  2. Stop  →  3. Ziel");
});
document.getElementById("gridBotBtn").addEventListener("click", () => gbToggleBar());

  // Magnetknopf in der Bottom Bar
  quiet(() => {
    const btn = document.getElementById("magnetBbBtn");
    if (!btn) return;
    const update = () => {
      const on = state.magnetMode !== "normal";
      btn.classList.toggle("active", on);
      btn.title = on ? "Magnet: ein" : "Magnet: aus";
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.magnetMode = state.magnetMode === "normal" ? "strong_magnet" : "normal";
      update();
      renderDrawbar();
    });
    update();
  }, "magnet bb btn");
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

// ---------- EWT-Handler (Elliott Wellen) ----------
(function () {
  const scanBtn  = document.getElementById("ewtScanBtn");
  const clearBtn = document.getElementById("ewtClearBtn");
  if (scanBtn)  scanBtn.addEventListener("click", scanEWT);
  if (clearBtn) clearBtn.addEventListener("click", () => { clearEWT(); setStatus("EWT-Setups entfernt"); });

  // Gespeicherte Einstellungen in die Felder zuruecklegen
  quiet(() => {
    const o = state.ewtOpts || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.checked = !!v; };
    set("ewtSwing",   o.swingLength);
    set("ewtMinPct",  o.setupMinPercent);
    set("ewtTimeout", o.timeoutBars);
    set("ewtRsiPeriod", o.rsiPeriod);
    set("ewtRsiOs",   o.rsiOversold);
    set("ewtMinPivotPct", o.minPivotPercent);
    if (Array.isArray(o.degrees) && o.degrees.length) set("ewtSwing", o.degrees[0]);
    chk("ewtMultiDegree", o.degrees ? o.degrees.length > 1 : true);
    set("ewtMaxSkip", o.maxSkip);
    set("ewtMaxShow", o.maxImpulses);
    const st = document.getElementById("ewtStrict");
    if (st && o.strictness) st.value = o.strictness;
    const lb = document.getElementById("ewtLabels");
    if (lb && o.labelMode) lb.value = o.labelMode;
    chk("ewtRule4",   o.requireWave5NewExtreme);
    chk("ewtDiagonal", o.allowDiagonal);
    chk("ewtUseRsi",  o.requireRsi);
    chk("ewtUseVol",  o.requireVolume);
    chk("ewtUseEff",  o.requireEfficiency);
  }, "ewt opts restore");
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


// ════════════════════════════════════════════════════════════════════
// MOBILE-SCHICHT
// Läuft ausschliesslich auf Touch-/Schmalgeräten. Auf dem Desktop wird
// nichts davon ausgeführt — das DOM bleibt dort unverändert.
// ════════════════════════════════════════════════════════════════════
const TV_BUILD = "m46";
window.__tvBuild = TV_BUILD;

// Build-Abgleich: meldet sofort, wenn der Browser eine alte CSS liefert.
quiet(() => {
  const cssBuild = getComputedStyle(document.documentElement)
    .getPropertyValue("--tv-build").trim().replace(/["']/g, "");
  window.__tvCssBuild = cssBuild || "(keine)";
  if (cssBuild === TV_BUILD) {
    console.log(`%c[TreydView] Build ${TV_BUILD} — CSS und JS aktuell.`,
                "color:#3fb68b;font-weight:600");
  } else {
    console.warn(`[TreydView] VERSIONSKONFLIKT — JS "${TV_BUILD}", ` +
      `geladene CSS "${cssBuild || "unbekannt"}". Der Browser liefert eine ` +
      `alte style.css aus dem Cache.`);
  }
}, "build check");

const tvIsMobile = () =>
  window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;

// ── 1. Knöpfe in die beiden Reihen und die Bottom Bar verschieben ─────
// appendChild verschiebt den vorhandenen Knoten; alle Ereignis-Handler
// bleiben daran hängen. Auf dem Desktop läuft nichts davon.
quiet(() => {
  if (!tvIsMobile()) return;
  const $  = (id) => document.getElementById(id);
  const r1 = $("tbRow1"), r2 = $("tbRow2"), bb = $("bottomBar");
  if (!r1 || !r2 || !bb) return;

  // Zeile 1: Zyklus-Pills · Lücke · Layout Watchlist Nacht Vollbild FAQ
  if ($("cycleBar")) r1.appendChild($("cycleBar"));
  const gap = document.createElement("span");
  gap.className = "tb-gap";
  r1.appendChild(gap);
  ["layoutDropdown", "wlToggleBtn", "themeBtn", "fullscreenBtn", "faqBtn"]
    .forEach(id => { const el = $(id); if (el) r1.appendChild(el); });

  // Zeile 2: Asset Intervall Vergleich · Lücke · Preis Änderung
  const gap2 = r2.querySelector(".tb-gap");
  ["assetDropdown", "tfDropdown", "compareDropdown"]
    .forEach(id => { const el = $(id); if (el) r2.insertBefore(el, gap2); });

  // Bottom Bar
  ["indDropdown", "drawSheetBtn", "gridBotBtn",
   "patternDropdown", "smcDropdown", "ewtDropdown", "magnetBbBtn", "posToolTopBtn"]
    .forEach(id => { const el = $(id); if (el) bb.appendChild(el); });

  // Das Popover liegt fest am Bildschirm — ausserhalb des Stapelkontexts
  // der Topbar ist es zuverlässig sichtbar.
  if ($("cyclePopover")) document.body.appendChild($("cyclePopover"));
}, "mobile layout");

// ── 2. Knopf mit Aufziehen-Symbol → Auto-Zoom ─────────────────────────
// Vollbild ist auf dem iPhone nicht erreichbar: Safari und Brave stellen
// die Schnittstelle nicht bereit. Im Home-Bildschirm-Modus gibt es ohnehin
// keine Browserleiste mehr. Der Knopf leistet jetzt Auto-Zoom — das Symbol
// passt weiterhin, es zieht den Chart auf den Datenbereich auf.
quiet(() => {
  const btn = document.getElementById("fullscreenBtn");
  if (!btn) return;
  btn.title = "Auto-Zoom auf sichtbaren Bereich";
  btn.addEventListener("click", (e) => { e.stopPropagation(); autoZoom(); });
}, "autozoom btn");

// ── 3. Stil-Menü schliessen ───────────────────────────────────────────
quiet(() => {
  const x = document.getElementById("omClose");
  const m = document.getElementById("overlayMenu");
  if (!x || !m) return;
  const closeMenu = () => { m.classList.add("hidden"); syncMenuOpen(); };
  x.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); });
}, "om close");

// ── 4b. Chart feststellen, solange ein Werkzeug aktiv ist ─────────────
// Ein früherer Versuch rief nur preventDefault(). Das unterbindet aber
// bloss das native Scrollen des Browsers — KLineCharts registriert seine
// Touch-Handler auf einem Kindelement von #mainChart und verschiebt den
// Chart in seinem eigenen Handler trotzdem weiter.
// Verlässlich ist nur KLCs eigene Schnittstelle. Punkte setzen und
// bestehende Punkte ziehen bleiben möglich, weil ausschliesslich
// Verschieben und Zoomen gesperrt werden.
quiet(() => {
  let locked = false;
  // Arbeitsflaechen aus frueheren Builds koennen noch "weak_magnet" tragen.
  if (state.magnetMode === "weak_magnet") state.magnetMode = "strong_magnet";

  const lock = (on) => {
    if (on === locked) return;
    locked = on;
    quiet(() => {
      chart.setScrollEnabled(!on);
      chart.setZoomEnabled(!on);
    }, "chart lock");
  };
  window.__tvChartLock = lock;

  // Kerze zu einem Zeitstempel — overlays.js braucht sie fuer den
  // Desktop-Magneten, hat aber keinen Zugriff auf chart.
  // Kerzenbreite in Pixeln — overlays.js rechnet damit die Kastenbreite aus.
  window.__tvBarSpace = () => {
    try {
      const b = chart.getBarSpace();
      const v = (b && (b.bar ?? b.barSpace)) || 0;
      return v > 0 ? v : 8;
    } catch (e) { return 8; }
  };

  window.__tvCandleAt = (timestamp) => {
    try {
      const data = chart.getDataList();
      if (!data || !data.length || timestamp == null) return null;
      let best = null, diff = Infinity;
      for (const d of data) {
        const dd = Math.abs(d.timestamp - timestamp);
        if (dd < diff) { diff = dd; best = d; }
      }
      return best;
    } catch (e) { return null; }
  };

  // state.activeTool wird an vielen Stellen gesetzt und zurückgesetzt.
  // Statt jede einzelne anzufassen, beobachten wir das Feld selbst —
  // so kann keine Stelle vergessen werden.
  let raw = state.activeTool;
  Object.defineProperty(state, "activeTool", {
    get() { return raw; },
    set(v) { raw = v; lock(!!v); },
    configurable: true, enumerable: true,
  });
  lock(!!raw);
}, "draw lock");

// ── 4. Neue Zeichnung: Fadenkreuz sammelt die Punkte selbst ───────────
// TradingViews eigenes Modell, 1:1 übernommen: Werkzeug wählen → Fadenkreuz
// erscheint sofort. Ziehen bewegt NUR das Kreuz (kein Commit). Ein
// separater, kurzer Tap (kaum Bewegung seit dem letzten Antippen) setzt
// den Punkt GENAU im Zentrum des Kreuzes — unabhängig davon, wo dieser Tap
// stattfand. Das Overlay wird erst am Ende mit fertigen Punkten erzeugt,
// nie über KLCs eigenen interaktiven Klick-Modus — der lief auf denselben
// Touch-Ereignissen wie jede App-eigene Geste und war über mehrere Anläufe
// hinweg die Ursache aller Kollisionen.
const TOOL_POINT_COUNT = {
  segment: 2, rayLine: 2, horizontalStraightLine: 1, verticalStraightLine: 1,
  priceLine: 1, priceChannelLine: 3, parallelStraightLine: 3,
  fibRetracement: 2, fibExtension: 3, rectangle: 2, priceRange: 2,
  // positionTool: 3 = Zahl der TIPPS im Desktop-Klickfluss, nicht der Punkte.
  // Auf dem Handy genuegt ein Tipp; den vierten Punkt (rechter Rand) liefert
  // expandPoints. totalStep in overlays.js bleibt bei 4 — ein hoeherer Wert
  // wuerde den Desktop auf vier Klicks umstellen und Regel 1 verletzen.
  dateRange: 2, avwap: 1, simpleAnnotation: 1, positionTool: 3,
  // Neu auf dem Handy: beide sind KLineCharts-Bordmittel.
  // straightLine    = Gerade durch zwei Punkte, in BEIDE Richtungen unendlich
  // horizontalRayLine = Waagrechte ab einem Punkt in eine Richtung
  straightLine: 2, horizontalRayLine: 2,
  // Polylinie ist unbegrenzt — sie wird über den Bestätigungs-Balken
  // abgeschlossen, nicht über eine feste Punktzahl.
  polyline: Infinity,
};
const CROSSHAIR_LIFT = 120;   // Pixel über dem Finger

function startMobilePointTool(overlayName, overlayConfig, opts) {
  opts = opts || {};
  const host   = document.getElementById("mainChart");
  const canvas = document.getElementById("crosshairCanvas");
  if (!host || !canvas) {
    const id = chart.createOverlay(overlayConfig);
    state.drawingId = Array.isArray(id) ? id[0] : id;
    renderDrawbar();
    return;
  }
  document.getElementById("drawActionBar")?.classList.add("hidden");
  state.selectedOverlayId = null;
  const confirmBar = document.getElementById("drawConfirmBar");
  confirmBar?.classList.add("hidden");

  // Das Canvas muss IM Chart liegen, nicht daneben: es ist absolut
  // positioniert, und als Geschwister im .chart-col bezöge es sich auf
  // dessen Kasten — der die Statusleiste mit einschliesst. Das Fadenkreuz
  // wäre dann senkrecht um deren Höhe versetzt.
  host.style.position = "relative";
  if (canvas.parentElement !== host) host.appendChild(canvas);

  // needPoints erlaubt es, weniger Punkte abzufragen als das Overlay am
  // Ende bekommt — beim Long/Short wird aus einem Einstieg per
  // expandPoints ein Dreiergespann [Einstieg, Stop, Ziel].
  const need = opts.needPoints || TOOL_POINT_COUNT[overlayName] || 2;
  const AXIS_W = 80, ENGAGE = 8;
  let points = [];
  let markers = [];   // Pixel-Positionen bereits gesetzter Punkte — sichtbare Bestätigung
  let previewId = null;
  let crosshair = { x: host.clientWidth / 2, y: host.clientHeight / 2 };
  let touchStart = null, touchMoved = false;
  let offAccept = () => {}, offCancel = () => {};

  canvas.classList.remove("hidden");
  const resize = () => {
    canvas.width  = host.offsetWidth  * devicePixelRatio;
    canvas.height = host.offsetHeight * devicePixelRatio;
    draw();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  function draw() {
    const ctx = canvas.getContext("2d");
    const dpr = devicePixelRatio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Bereits gesetzte Punkte: gefüllter Kreis mit hellem Rand, damit der
    // Nutzer sieht, dass der Tap tatsächlich angekommen ist.
    markers.forEach((m) => {
      const mx = m.x * dpr, my = m.y * dpr, R = 6 * dpr;
      ctx.beginPath();
      ctx.arc(mx, my, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(232,182,76,.95)";
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.stroke();
    });

    const px = crosshair.x * dpr, py = crosshair.y * dpr;
    // Eingerastet: kräftigeres Grün und durchgezogene Linie, damit sofort
    // erkennbar ist, dass der Punkt auf einem Kursniveau der Kerze sitzt.
    const snapped = !!crosshair.snapped;
    ctx.strokeStyle = snapped ? "rgba(63,182,139,.95)" : "rgba(232,182,76,.9)";
    ctx.lineWidth = (snapped ? 1.5 : 1) * dpr;
    ctx.setLineDash(snapped ? [] : [6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, py); ctx.lineTo(canvas.width, py);
    ctx.moveTo(px, 0);  ctx.lineTo(px, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    const S = 5 * dpr;
    ctx.strokeRect(px - S, py - S, S * 2, S * 2);
  }

  // Rastet auf Wunsch an O/H/L/C der nächstgelegenen Kerze ein — dieselbe
  // Vorstellung wie KLCs eigener mode/modeSensitivity, hier aber selbst
  // nachgebaut, weil wir KLCs interaktiven Modus nicht mehr nutzen.
  // Magnet rastet AUSSCHLIESSLICH auf der Preisachse ein: auf Hoch, Tief,
  // Eröffnung oder Schluss der Kerze unter dem Fadenkreuz. Die Zeitachse
  // bleibt frei am Finger — beim Zeichnen ist die waagrechte Position
  // fast immer bewusst gewählt, die senkrechte soll dagegen sauber auf
  // einem Kursniveau sitzen.
  //
  // Gibt { x, y } der eingerasteten Bildschirmposition zurück oder null,
  // wenn kein Kursniveau in Reichweite liegt. Wird schon während der
  // Fingerbewegung aufgerufen, damit das Einrasten sichtbar ist und nicht
  // erst beim Absetzen des Punktes überrascht.
  //
  // Rastet Y auf O/H/L/C ein UND zentriert X gleichzeitig auf die Mitte
  // derselben Kerze. Beides gehört zusammen: ein Punkt, der auf dem Hoch
  // einer Kerze sitzt, soll auch waagrecht auf dieser Kerze sitzen und
  // nicht zwischen zwei Kerzen hängen. convertToPixel liefert für einen
  // Zeitstempel bereits die Kerzenmitte — dieselbe Umrechnung liefert also
  // beide Achsen in einem Schritt.
  //
  // Kein Y-Treffer bedeutet kein X-Einrasten: ohne eingerastetes Kursniveau
  // bleibt das Fadenkreuz vollständig frei am Finger.
  function magnetSnap(px, py) {
    if (state.magnetMode === "normal") return null;
    try {
      const v = chart.convertFromPixel({ x: px, y: py }, { paneId: "candle_pane" });
      if (!v || v.timestamp == null) return null;
      const data = chart.getDataList();
      if (!data || !data.length) return null;

      let closest = null, bestDiff = Infinity;
      for (const d of data) {
        const diff = Math.abs(d.timestamp - v.timestamp);
        if (diff < bestDiff) { bestDiff = diff; closest = d; }
      }
      if (!closest) return null;

      const tol = 40;   // nur noch ein Fangbereich, siehe state.magnetMode
      let best = null, bestPxDiff = tol;
      for (const val of [closest.open, closest.high, closest.low, closest.close]) {
        if (val == null) continue;
        const p = chart.convertToPixel({ timestamp: closest.timestamp, value: val }, { paneId: "candle_pane" });
        const one = Array.isArray(p) ? p[0] : p;
        if (!one || one.y == null) continue;
        const d = Math.abs(one.y - py);
        // one.x ist die Kerzenmitte des Zeitstempels. Fehlt sie aus
        // irgendeinem Grund, bleibt die waagrechte Position unverändert —
        // das Einrasten auf der Preisachse darf davon nicht abhängen.
        if (d < bestPxDiff) {
          bestPxDiff = d;
          best = { x: one.x != null ? one.x : px, y: one.y };
        }
      }
      return best;
    } catch (e) { return null; }
  }

  // Das Fadenkreuz steht bereits auf der eingerasteten Position, deshalb
  // ist hier kein weiteres Einrasten mehr nötig.
  function toDataPoint(px, py) {
    try {
      const v = chart.convertFromPixel({ x: px, y: py }, { paneId: "candle_pane" });
      if (!v || v.timestamp == null) return null;
      return { timestamp: v.timestamp, value: v.value };
    } catch (e) { return null; }
  }

  function updatePreview() {
    if (previewId != null) { try { chart.removeOverlay(previewId); } catch (e) {} previewId = null; }
    if (points.length === 0) return;
    let previewPts = points.slice();
    if (previewPts.length < need) {
      const live = toDataPoint(crosshair.x, crosshair.y);
      if (live) previewPts = previewPts.concat([live]);
    }
    if (previewPts.length < 2) return;
    try {
      previewId = chart.createOverlay({
        name: overlayName, points: previewPts, styles: overlayConfig.styles, lock: true,
      });
      if (Array.isArray(previewId)) previewId = previewId[0];
    } catch (e) {}
  }

  function cleanup() {
    canvas.classList.add("hidden");
    confirmBar?.classList.add("hidden");
    offAccept(); offCancel();
    ro.disconnect();
    if (previewId != null) { try { chart.removeOverlay(previewId); } catch (e) {} previewId = null; }
    host.removeEventListener("touchstart", onStart, true);
    host.removeEventListener("touchmove",  onMove,  true);
    host.removeEventListener("touchend",   onEnd,   true);
    host.removeEventListener("touchcancel",onCancel,true);
  }

  function commitPoint() {
    const pt = toDataPoint(crosshair.x, crosshair.y);
    if (!pt) { setStatus("Kein gültiger Punkt an dieser Stelle"); return; }
    points.push(pt);

    // Sichtbare Bestätigung: Marker an der tatsächlich gespeicherten
    // Position (nach Magnet-Snap zurück in Pixel gerechnet), nicht an der
    // rohen Fadenkreuz-Stelle — bei aktivem Magnet können die minimal
    // auseinanderliegen.
    quiet(() => {
      const r = chart.convertToPixel({ timestamp: pt.timestamp, value: pt.value }, { paneId: "candle_pane" });
      const one = Array.isArray(r) ? r[0] : r;
      markers.push(one && one.x != null ? { x: one.x, y: one.y } : { x: crosshair.x, y: crosshair.y });
    }, "marker convert");
    draw();

    if (points.length < need) {
      updatePreview();
      if (need === Infinity) {
        // Ab dem zweiten Punkt kann abgeschlossen werden — der Balken
        // erscheint erst dann, weil eine Linie mindestens zwei Punkte
        // braucht.
        if (points.length >= 2) showConfirmBar();
        setStatus(`${points.length} Punkte — weiter antippen, ✓ schliesst ab`);
      } else {
        setStatus(`Punkt ${points.length}/${need} gesetzt — nächsten Punkt positionieren und antippen`);
      }
      return;
    }

    finishDrawing();
  }

  // Abstand des Balkens ueber dem Fadenkreuz-Mittelpunkt. 16 px waren zu
  // wenig: bei der Polylinie sitzt der Balken dann fast auf dem Punkt, den
  // man gerade setzt, und verdeckt ihn.
  const CONFIRM_BAR_GAP = 44;

  function showConfirmBar() {
    if (!confirmBar) return;
    const rect = host.getBoundingClientRect();
    const barW = 84, barH = 46;
    let left = rect.left + crosshair.x - barW / 2;
    let top  = rect.top + crosshair.y - barH - CONFIRM_BAR_GAP;
    left = Math.max(6, Math.min(window.innerWidth - barW - 6, left));
    top  = Math.max(6, top);
    confirmBar.style.left = left + "px";
    confirmBar.style.top  = top + "px";
    confirmBar.classList.remove("hidden");
  }

  function abortDrawing() {
    cleanup();
    state.activeTool = null;
    state.drawingId = null;
    renderDrawbar();
    setStatus("Zeichnung verworfen");
  }

  function finishDrawing() {
    const minPts = opts.needPoints || 2;
    if (points.length < minPts) { abortDrawing(); return; }
    cleanup();
    const finalPts = opts.expandPoints ? opts.expandPoints(points) : points;
    let id;
    try { id = chart.createOverlay({ ...overlayConfig, points: finalPts }); } catch (e) { id = null; }
    id = Array.isArray(id) ? id[0] : id;
    state.drawingId = id;
    if (id) {
      // onDrawEnd bildet den gesamten Abschluss nach (captureDrawing,
      // AVWAP-Bridge, pinTool-Wiederholung) — KLC ruft es bei explizit
      // übergebenen points nicht selbst auf, weil kein interaktiver
      // Abschluss stattfand.
      quiet(() => overlayConfig.onDrawEnd({ overlay: chart.getOverlayById(id) || { id, points: finalPts } }),
            "mobile draw onDrawEnd");
      if (opts.done) quiet(() => opts.done(id), "mobile draw done");
    } else {
      state.activeTool = null;
      renderDrawbar();
    }
  }

  function onStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    const r = host.getBoundingClientRect();
    touchStart = { x: t.clientX - r.left, y: t.clientY - r.top };
    touchMoved = false;
  }
  function onMove(e) {
    if (!touchStart || e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    const r = host.getBoundingClientRect();
    const x = t.clientX - r.left, y = t.clientY - r.top;
    if (Math.hypot(x - touchStart.x, y - touchStart.y) > ENGAGE) {
      touchMoved = true;
      const rawY = Math.max(10, y - CROSSHAIR_LIFT);
      const snap = magnetSnap(x, rawY);
      crosshair = snap
        ? { x: snap.x, y: snap.y, snapped: true }
        : { x, y: rawY, snapped: false };
      draw();
      if (need === Infinity && points.length >= 2) showConfirmBar();
    }
  }
  function onEnd(e) {
    if (!touchStart) return;
    e.preventDefault(); e.stopPropagation();
    if (!touchMoved) commitPoint();
    touchStart = null; touchMoved = false;
  }
  function onCancel() { touchStart = null; touchMoved = false; }

  host.addEventListener("touchstart",  onStart,  { capture: true, passive: false });
  host.addEventListener("touchmove",   onMove,   { capture: true, passive: false });
  host.addEventListener("touchend",    onEnd,    { capture: true, passive: false });
  host.addEventListener("touchcancel", onCancel, { capture: true, passive: false });

  // Bestätigungs-Knöpfe. touchend statt click, damit ein Tap genügt —
  // sonst käme der Chart-Handler dazwischen (gleicher Grund wie beim
  // Aktionsbalken).
  const bindConfirm = (id, fn) => {
    const btn = document.getElementById(id);
    if (!btn) return () => {};
    const h = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    btn.addEventListener("touchend", h, { passive: false });
    btn.addEventListener("click", h);
    return () => {
      btn.removeEventListener("touchend", h);
      btn.removeEventListener("click", h);
    };
  };
  offAccept = bindConfirm("dcbAccept", () => finishDrawing());
  offCancel = bindConfirm("dcbCancel", () => abortDrawing());

  resize();
  setStatus(opts.hint || (need === Infinity
    ? "Punkte antippen — ab dem zweiten schliesst ✓ ab"
    : `Punkt 1/${need}: Fadenkreuz positionieren und antippen`));
}

// ── 4b2. Long/Short: Richtung wählen, dann Einstieg mit dem Fadenkreuz ─
// Statt drei einzelner Klicks (Einstieg, Stop, Ziel) genügt auf dem Handy
// ein Tap: Stop und Ziel entstehen automatisch als Prozentsatz des
// Einstiegs — Stop 1 %, Ziel 2 %, also Verhältnis 1:2.
//
// Vorher lief das über den Tages-ATR. Das ist theoretisch sauberer, war in
// der Praxis aber unbrauchbar: bei weit herausgezoomtem Chart ergab es
// Ziel +0.01 % und Stop 0.00 % — die Bereiche waren ohne starkes Hineinzoomen
// gar nicht zu sehen und die Linien nicht einzeln greifbar. Ein fester
// Prozentsatz ist grob, aber immer sichtbar und liefert nebenbei das
// gängige Verhältnis gleich mit.
quiet(() => {
  const menu    = document.getElementById("lsChoice");
  const btnLong = document.getElementById("lsLong");
  const btnShort= document.getElementById("lsShort");
  const host    = document.getElementById("mainChart");
  if (!menu || !btnLong || !btnShort || !host) return;

  // Stop 1 %, Ziel 2 % — das Verhältnis 1:2 steckt damit in den Konstanten.
  const STOP_PCT = 0.01, TARGET_PCT = 0.02;

  // Knapp über POINT_TOL (20 px) — das ist die Schwelle, ab der eine Linie
  // tatsächlich einzeln greifbar ist. Absichtlich NICHT höher: sonst würde
  // das Sicherheitsnetz die 1 % / 2 % im Normalfall überschreiben und die
  // Vorgabe wäre wieder unvorhersagbar. Es soll nur bei absurd weit
  // herausgezoomtem Chart überhaupt anspringen.
  const MIN_LEG_PX = 24;

  // Sicherheitsnetz für extreme Zoomstufen: liegt Einstieg <-> Stop unter
  // MIN_LEG_PX, lassen sich die Linien nicht einzeln greifen.
  //
  // WICHTIG — hier ist die ATR-Fassung gescheitert: Sie hat den Faktor aus
  // der Pixeldifferenz zweier Preise gebildet. Bei sehr kleinem Abstand
  // landen aber beide Preise auf DEMSELBEN Pixel, die Differenz ist 0, und
  // ein Faktor daraus ist unbrauchbar — genau der Fall, der abgefangen
  // werden sollte, fiel durch. Darum den Maßstab px-pro-Kurseinheit an einer
  // grossen Messlatte bestimmen und den nötigen Kursabstand daraus ableiten.
  function minRiskForTouch(entry, risk) {
    try {
      const toY = (value) => {
        const r = chart.convertToPixel(
          { timestamp: entry.timestamp, value },
          { paneId: "candle_pane" }
        );
        const one = Array.isArray(r) ? r[0] : r;
        return one && one.y != null ? one.y : null;
      };
      const probe = Math.abs(entry.value) * 0.1 || 1;   // 10 % als Messlatte
      const y0 = toY(entry.value);
      const yP = toY(entry.value + probe);
      if (y0 == null || yP == null) return risk;
      const pxPerUnit = Math.abs(yP - y0) / probe;
      if (!isFinite(pxPerUnit) || pxPerUnit <= 0) return risk;
      return Math.max(risk, MIN_LEG_PX / pxPerUnit);
    } catch (e) { return risk; }
  }

  // Aus dem einen gesetzten Einstieg die drei Punkte machen. Von beiden
  // Wegen genutzt — Handy (Fadenkreuz) wie Desktop (Mausklick), damit sie
  // nicht auseinanderlaufen koennen.
  function expandPositionPoints(dir, entry) {
    const risk   = minRiskForTouch(entry, Math.abs(entry.value) * STOP_PCT);
    const reward = risk * (TARGET_PCT / STOP_PCT);
    const stop   = dir === "long" ? entry.value - risk   : entry.value + risk;
    const target = dir === "long" ? entry.value + reward : entry.value - reward;
    return [
      entry,
      { timestamp: entry.timestamp, value: stop },
      { timestamp: entry.timestamp, value: target },
    ];
  }

  // Desktop: ein einzelner Mausklick setzt den Einstieg.
  // startMobilePointTool horcht ausschliesslich auf Beruehrungen — auf dem
  // Desktop kaeme dort nie ein Ereignis an und das Werkzeug bliebe haengen.
  function placePositionByClick(dir, cfg) {
    setStatus(dir === "long"
      ? "Long: Einstieg anklicken"
      : "Short: Einstieg anklicken");

    const abbrechen = () => {
      host.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      state.activeTool = null;
      renderDrawbar();
      document.getElementById("posToolTopBtn")?.classList.remove("active");
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      abbrechen();
      setStatus("Abgebrochen");
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x > rect.width - 80) return;          // Preisskala nicht bemalen
      e.preventDefault(); e.stopPropagation();
      abbrechen();
      quiet(() => {
        const v = chart.convertFromPixel({ x, y }, { paneId: "candle_pane" });
        if (!v || v.timestamp == null || v.value == null) {
          setStatus("Einstieg konnte nicht bestimmt werden");
          return;
        }
        const entry = { timestamp: v.timestamp, value: v.value };
        const id = chart.createOverlay({ ...cfg, points: expandPositionPoints(dir, entry) });
        const oid = Array.isArray(id) ? id[0] : id;
        if (oid) captureDrawing(oid);
        state.selectedOverlayId = null;
        setStatus(dir === "long"
          ? "Long gesetzt — Position anklicken, dann Stop oder Ziel ziehen"
          : "Short gesetzt — Position anklicken, dann Stop oder Ziel ziehen");
      }, "placePositionByClick");
    };
    host.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }

  function placePosition(dir) {
    menu.classList.add("hidden");
    const cfg = buildOverlayConfig("positionTool");
    // Startbreite des Kastens in Kerzen. Steckt in extendData, wird also
    // mitgespeichert und ueberlebt das Neuladen.
    cfg.extendData = { widthBars: (window.__tvPositionBars || {}).DEFAULT || 20 };
    // Zwingend: ohne aktives Werkzeug würde der Auswahl-Handler parallel
    // mitlaufen und die Chart-Sperre nicht greifen.
    state.activeTool = "positionTool";
    renderDrawbar();
    if (!tvIsMobile()) { placePositionByClick(dir, cfg); return; }
    startMobilePointTool("positionTool", cfg, {
      needPoints: 1,
      hint: dir === "long"
        ? "Long: Einstieg positionieren und antippen"
        : "Short: Einstieg positionieren und antippen",
      // Aus dem einen gesetzten Einstieg werden drei Punkte gemacht:
      // [Einstieg, Stop, Ziel] — genau die Reihenfolge, die das
      // positionTool-Overlay erwartet.
      expandPoints: (pts) => expandPositionPoints(dir, pts[0]),
      done: () => {
        // Frisch gezeichnet heisst NICHT ausgewaehlt: sonst stehen
        // Beschriftungen, Kennzahlen und Griffe sofort im Bild, obwohl noch
        // niemand die Position angetippt hat.
        state.selectedOverlayId = null;
        setStatus(dir === "long"
          ? "Long gesetzt — Position antippen, dann Stop oder Ziel ziehen"
          : "Short gesetzt — Position antippen, dann Stop oder Ziel ziehen");
      },
    });
    document.getElementById("posToolTopBtn")?.classList.add("active");
  }

  const bind = (btn, dir) => {
    const h = (e) => { e.preventDefault(); e.stopPropagation(); placePosition(dir); };
    btn.addEventListener("touchend", h, { passive: false });
    btn.addEventListener("click", h);
  };
  bind(btnLong, "long");
  bind(btnShort, "short");

  // Tap daneben schliesst die Auswahl wieder
  document.addEventListener("touchstart", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (menu.contains(e.target) || document.getElementById("posToolTopBtn")?.contains(e.target)) return;
    menu.classList.add("hidden");
  }, { passive: true });
}, "ls choice init");

// ── 4b4. Desktop: Long/Short-Griffe mit der Maus ziehen ───────────────
// Der Schwebebalken und der ganze Zug-Handler aus 4c sind mobile-only
// (tvIsMobile-Riegel). Am Desktop zog deshalb KLineCharts selbst — und
// verschob den ganzen Kasten, statt Stop, Ziel und Breite einzeln zu
// bewegen. Dieser Handler macht dasselbe wie der Finger-Zug, nur mit der
// Maus, und ausschliesslich fuer positionTool.
quiet(() => {
  const host = document.getElementById("mainChart");
  if (!host || tvIsMobile()) return;

  const AXIS_W = 80, TAP_TOL = 26, POINT_TOL = 20, ENGAGE = 4;
  let start = null, drag = null, gesperrt = false;

  const toPx = (p) => {
    try {
      const r = chart.convertToPixel({ timestamp: p.timestamp, value: p.value }, { paneId: "candle_pane" });
      return Array.isArray(r) ? r[0] : r;
    } catch (e) { return null; }
  };
  const freigeben = () => {
    if (!gesperrt) return;
    gesperrt = false;
    window.__tvChartLock && window.__tvChartLock(false);
  };

  host.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || state.activeTool) return;
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x > rect.width - AXIS_W) return;

    const hit = findOverlayNear(x, y, TAP_TOL, POINT_TOL);
    // Nur Long/Short, nur echte Griffe. Alles andere laeuft weiter ueber
    // KLineCharts, damit sich der Desktop sonst nicht veraendert.
    if (!hit || hit.overlay.name !== "positionTool" || hit.pointIndex < 1) return;

    e.preventDefault(); e.stopPropagation();
    state.selectedOverlayId = hit.overlay.id;
    const startPts = hit.overlay.points.map(p => ({ timestamp: p.timestamp, value: p.value }));
    start = { x, y };
    drag = {
      id: hit.overlay.id,
      pointIndex: hit.pointIndex,
      startPts,
      startPxPts: startPts.map(toPx),
      startWidthPx: (window.__tvPositionWidthPx
        ? window.__tvPositionWidthPx(hit.overlay) : 160),
      bewegt: false,
    };
    gesperrt = true;
    window.__tvChartLock && window.__tvChartLock(true);
  }, true);

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dx = x - start.x, dy = y - start.y;
    if (!drag.bewegt && Math.hypot(dx, dy) < ENGAGE) return;
    drag.bewegt = true;
    e.preventDefault();

    quiet(() => {
      if (drag.pointIndex === 3) {
        // Breite: nur die Kerzenanzahl, kein Punkt wird angefasst.
        const bar = (window.__tvBarSpace && window.__tvBarSpace()) || 8;
        const g = window.__tvPositionBars || { MIN: 3 };
        const bars = Math.max(g.MIN, Math.round((drag.startWidthPx + dx) / bar));
        const ov = chart.getOverlayById(drag.id);
        const ext = { ...(ov && ov.extendData ? ov.extendData : {}), widthBars: bars };
        chart.overrideOverlay({ id: drag.id, extendData: ext });
        return;
      }
      // Stop und Ziel: nur senkrecht. Der Zeitstempel bleibt, sonst reisst
      // die Zuordnung Einstieg/Stop/Ziel auseinander.
      const basePx = drag.startPxPts[drag.pointIndex];
      if (!basePx) return;
      const moved = chart.convertFromPixel({ x: basePx.x, y: basePx.y + dy }, { paneId: "candle_pane" });
      if (!moved || moved.value == null) return;
      const pts = drag.startPts.map((p, i) => i === drag.pointIndex
        ? { timestamp: p.timestamp, value: moved.value }
        : p);
      chart.overrideOverlay({ id: drag.id, points: pts });
    }, "desktop pos drag");
  }, true);

  window.addEventListener("mouseup", () => {
    if (!drag) { freigeben(); return; }
    const id = drag.id;
    freigeben();
    quiet(() => {
      const ov = chart.getOverlayById(id);
      if (!ov) return;
      const idx = (state.drawings || []).findIndex(d => d.id === id);
      if (idx >= 0) {
        state.drawings[idx].points = ov.points.map(p => ({ timestamp: p.timestamp, value: p.value }));
        state.drawings[idx].extendData = ov.extendData ?? null;
        saveWorkspace();
      }
    }, "desktop pos persist");
    drag = null; start = null;
  }, true);
}, "desktop position drag");

// ── 4c. Bestehende Zeichnung: antippen wählt aus, zweiter Griff verschiebt ─
// Genau wie in TradingView: ein Tap wählt aus und zeigt einen kleinen
// Balken mit Stil/Löschen. Verschieben ist nur möglich, wenn die
// Zeichnung bereits ausgewählt war, bevor der Finger sie erneut berührt —
// das trennt "auswählen" und "verschieben" strukturell, ohne Ambiguität
// zwischen Tap und Drag erraten zu müssen.
quiet(() => {
  const host = document.getElementById("mainChart");
  const bar  = document.getElementById("drawActionBar");
  const btnStyle  = document.getElementById("dabStyle");
  const btnDelete = document.getElementById("dabDelete");
  if (!host || !bar || !tvIsMobile()) return;

  const AXIS_W = 80, TAP_TOL = 26, POINT_TOL = 20, ENGAGE = 8;
  let touchStart = null, touchMoved = false, dragCandidate = null, drag = null;
  // Merkt, dass wir den Chart fuer einen moeglichen Zug festgestellt haben —
  // auch wenn daraus am Ende gar kein Zug wurde (blosses Antippen).
  let lockedForDrag = false;
  const releaseChart = () => {
    if (!lockedForDrag) return;
    lockedForDrag = false;
    window.__tvChartLock && window.__tvChartLock(false);
  };

  const hideBar = () => bar.classList.add("hidden");

  // Hoehe des Kennzahlen-Blocks bei Long/Short: drei Zeilen a 15 px plus
  // der Abstand von 8 px, den overlays.js ueber dem Kasten laesst.
  const POS_INFO_H = 3 * 15 + 8;

  function showBarFor(overlay) {
    let px = null, py = null;
    try {
      if (overlay.name === "frvp" && overlay.points.length >= 2) {
        // FRVP: Balken über der Mitte des Zeitfensters, nicht am ersten
        // Ankerpunkt — der liegt ohnehin nur in der Bildschirmmitte.
        const a = chart.convertToPixel({ timestamp: overlay.points[0].timestamp, value: overlay.points[0].value }, { paneId: "candle_pane" });
        const b = chart.convertToPixel({ timestamp: overlay.points[1].timestamp, value: overlay.points[1].value }, { paneId: "candle_pane" });
        const oneA = Array.isArray(a) ? a[0] : a, oneB = Array.isArray(b) ? b[0] : b;
        if (oneA && oneB) { px = (oneA.x + oneB.x) / 2; py = Math.min(oneA.y, oneB.y); }
      } else if (overlay.name === "positionTool" && overlay.points.length >= 3) {
        // Long/Short: Balken oben LINKS ueber dem Kasten. Weder die
        // Preis-Schilder (rechts) noch die Griffe (mittig und rechts) noch
        // der Kennzahlen-Block (oben links, bis zu drei Zeilen) duerfen
        // darunter geraten — sonst tippt man beim Ziehen daneben.
        const cs = overlay.points.slice(0, 3).map(p => {
          const r = chart.convertToPixel({ timestamp: p.timestamp, value: p.value }, { paneId: "candle_pane" });
          return Array.isArray(r) ? r[0] : r;
        }).filter(Boolean);
        if (cs.length) {
          px = Math.min(...cs.map(o => o.x));
          py = Math.min(...cs.map(o => o.y)) - POS_INFO_H;
        }
      } else {
        const p0 = overlay.points[0];
        const r = chart.convertToPixel({ timestamp: p0.timestamp, value: p0.value }, { paneId: "candle_pane" });
        const one = Array.isArray(r) ? r[0] : r;
        if (one) { px = one.x; py = one.y; }
      }
    } catch (e) {}
    if (px == null) { hideBar(); return; }
    const rect = host.getBoundingClientRect();
    const barW = 84, barH = 46;
    // Long/Short linksbuendig, alles andere mittig ueber dem Ankerpunkt.
    let left = rect.left + (overlay.name === "positionTool" ? px : px - barW / 2);
    let top  = rect.top + py - barH - 14;
    left = Math.max(6, Math.min(window.innerWidth - barW - 6, left));
    top  = Math.max(6, top);
    bar.style.left = left + "px";
    bar.style.top  = top + "px";
    bar.classList.remove("hidden");
  }

  const selectOverlay = (ov) => { state.selectedOverlayId = ov.id; showBarFor(ov); };
  const deselect = () => { state.selectedOverlayId = null; hideBar(); };

  const onBarButton = (btn, fn) => {
    let handled = false;
    btn.addEventListener("touchend", (e) => {
      e.preventDefault(); e.stopPropagation();
      handled = true;
      setTimeout(() => { handled = false; }, 400);
      fn();
    }, { passive: false });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (handled) return;   // Touch hat bereits ausgelöst
      fn();
    });
  };

  const doStyle = () => {
    if (!state.selectedOverlayId) return;
    const ov = chart.getOverlayById(state.selectedOverlayId);
    if (!ov) return;
    const rect = bar.getBoundingClientRect();
    const relX = rect.left - host.getBoundingClientRect().left;
    const relY = rect.bottom - host.getBoundingClientRect().top;
    if (ov.name === "fibRetracement" || ov.name === "fibExtension") {
      openFibMenu({ overlay: ov, x: rect.left, y: rect.bottom });
    } else if (ov.name === "frvp") {
      openFrvpMenu(ov, { pointerCoordinate: { x: relX, y: relY } });
    } else {
      openOverlayMenu(ov, { pointerCoordinate: { x: relX, y: relY } });
    }
  };

  const doDelete = () => {
    if (!state.selectedOverlayId) return;
    try { chart.removeOverlay(state.selectedOverlayId); } catch (e) {}
    deselect();
  };

  onBarButton(btnStyle,  doStyle);
  onBarButton(btnDelete, doDelete);

  const toPx = (p) => {
    try {
      const r = chart.convertToPixel({ timestamp: p.timestamp, value: p.value }, { paneId: "candle_pane" });
      return Array.isArray(r) ? r[0] : r;
    } catch (e) { return null; }
  };

  host.addEventListener("touchstart", (e) => {
    if (state.activeTool || e.touches.length !== 1) return;
    const t = e.touches[0];
    const rect = host.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (x > rect.width - AXIS_W) return;

    touchStart = { x, y }; touchMoved = false;
    if (state.selectedOverlayId) {
      const hit = findOverlayNear(x, y, TAP_TOL, POINT_TOL);
      dragCandidate = (hit && hit.overlay.id === state.selectedOverlayId) ? hit : null;
    } else {
      dragCandidate = null;
    }

    if (dragCandidate) {
      // KLineCharts startet bei einer Beruehrung auf einem Overlay seinen
      // EIGENEN Zug und horcht danach auf Dokumentebene weiter — ein
      // stopPropagation erst beim Bewegen kommt zu spaet, der Kasten wandert
      // dann als Ganzes mit. Deshalb schon hier abfangen.
      e.preventDefault(); e.stopPropagation();
      // Chart sofort feststellen, nicht erst nach den ersten 8 px. Sonst
      // verschieben sich X- und Y-Achse waehrend des Anfassens.
      lockedForDrag = true;
      window.__tvChartLock && window.__tvChartLock(true);
    }
  }, { capture: true, passive: false });

  host.addEventListener("touchmove", (e) => {
    if (!touchStart || e.touches.length !== 1) return;
    const t = e.touches[0];
    const rect = host.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    const dist = Math.hypot(x - touchStart.x, y - touchStart.y);

    if (!drag && dragCandidate && dist > ENGAGE) {
      e.preventDefault(); e.stopPropagation();
      // Long/Short laesst sich nicht als Ganzes verschieben: ohne Griff
      // kommt gar kein Zug zustande. Ein "mode: null" haette nicht gereicht
      // — der Zweig unten faellt sonst in die Alles-Verschieben-Behandlung.
      if (dragCandidate.pointIndex < 0 &&
          dragCandidate.overlay.name === "positionTool") {
        dragCandidate = null;
        touchMoved = true;
        return;
      }
      const startPts = dragCandidate.overlay.points.map(p => ({ timestamp: p.timestamp, value: p.value }));
      drag = {
        overlay: dragCandidate.overlay,
        mode: dragCandidate.pointIndex >= 0 ? "point" : "all",
        pointIndex: dragCandidate.pointIndex,
        startPts, startPxPts: startPts.map(toPx),
        // Ausgangsbreite in Pixeln — Grundlage fuer den Breiten-Griff.
        startWidthPx: (window.__tvPositionWidthPx
          ? window.__tvPositionWidthPx(dragCandidate.overlay) : 160),
        touchStart: { x: touchStart.x, y: touchStart.y },
      };
      hideBar();
    }
    if (dist > ENGAGE) touchMoved = true;
    if (!drag) return;

    e.preventDefault(); e.stopPropagation();
    const dx = x - drag.touchStart.x, dy = y - drag.touchStart.y;
    quiet(() => {
      let newPts;
      if (drag.mode === "point" && drag.pointIndex === 3) {
        // Breiten-Griff: veraendert NUR die Kerzenanzahl in extendData.
        // Hier wird bewusst nichts mehr in Zeitstempel zurueckgerechnet —
        // der frueher dafuer benutzte vierte Punkt lag oft ausserhalb der
        // geladenen Daten, convertToPixel gab null, und der Zug endete
        // schweigend an `if (!basePx) return`.
        const bar = (window.__tvBarSpace && window.__tvBarSpace()) || 8;
        const grenzen = window.__tvPositionBars || { MIN: 3, DEFAULT: 20 };
        const bars = Math.max(grenzen.MIN,
          Math.round((drag.startWidthPx + dx) / bar));
        const ov = chart.getOverlayById(drag.overlay.id);
        const ext = { ...(ov && ov.extendData ? ov.extendData : {}), widthBars: bars };
        chart.overrideOverlay({ id: drag.overlay.id, extendData: ext });
        return;
      }
      if (drag.mode === "point") {
        const basePx = drag.startPxPts[drag.pointIndex];
        if (!basePx) return;
        const moved = chart.convertFromPixel({ x: basePx.x + dx, y: basePx.y + dy }, { paneId: "candle_pane" });
        if (!moved || moved.timestamp == null) return;
        // Long/Short: Stop und Ziel duerfen nur SENKRECHT wandern. Alle drei
        // Punkte teilen denselben Zeitstempel; verrutscht einer zeitlich,
        // zieht overlays.js den Kasten auf (x1 = maxX + 60) und die
        // Zuordnung Einstieg/Stop/Ziel bricht auseinander.
        if (drag.overlay.name === "positionTool") {
          // Index 1 = Stop, 2 = Ziel  -> nur senkrecht (Wert aendert sich)
          // Index 3 = Breiten-Griff   -> nur waagrecht (Zeitstempel aendert sich)
          // Index 0 = Einstieg        -> unbeweglich, wird gar nicht erst
          //                              als Griff angeboten
          newPts = drag.startPts.map((p, i) => {
            if (i !== drag.pointIndex) return p;
            if (i === 3) {
              // Nicht hinter den Einstieg zurueckwandern lassen.
              const minTs = drag.startPts[0]?.timestamp;
              const ts = (minTs != null && moved.timestamp <= minTs)
                ? minTs : moved.timestamp;
              return { timestamp: ts, value: p.value };
            }
            return { timestamp: p.timestamp, value: moved.value };
          });
        } else {
          newPts = drag.startPts.map((p, i) => i === drag.pointIndex
            ? { timestamp: moved.timestamp, value: moved.value }
            : p);
        }
      } else {
        newPts = drag.startPxPts.map(basePx => {
          if (!basePx) return null;
          const moved = chart.convertFromPixel({ x: basePx.x + dx, y: basePx.y + dy }, { paneId: "candle_pane" });
          return moved && moved.timestamp != null ? { timestamp: moved.timestamp, value: moved.value } : null;
        });
        if (newPts.some(p => !p)) return;
      }
      chart.overrideOverlay({ id: drag.overlay.id, points: newPts });
    }, "drawing drag");
  }, { capture: true, passive: false });

  host.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const rect = host.getBoundingClientRect();
    const t = e.changedTouches[0];
    const x = t.clientX - rect.left, y = t.clientY - rect.top;

    if (drag) {
      e.preventDefault(); e.stopPropagation();
      const id = drag.overlay.id;
      releaseChart();
      quiet(() => {
        const ov = chart.getOverlayById(id);
        if (!ov) return;
        const idx = (state.drawings || []).findIndex(d => d.id === id);
        if (idx >= 0) {
          state.drawings[idx].points = ov.points.map(p => ({ timestamp: p.timestamp, value: p.value }));
          // Ohne das geht die gezogene Kastenbreite beim Neuladen verloren.
          state.drawings[idx].extendData = ov.extendData ?? null;
          saveWorkspace();
        }
        showBarFor(ov);
      }, "drag persist");
      drag = null; dragCandidate = null; touchStart = null; touchMoved = false;
      return;
    }

    if (!touchMoved) {
      const hit = findOverlayNear(x, y, TAP_TOL, POINT_TOL);
      if (hit) {
        e.preventDefault(); e.stopPropagation();
        selectOverlay(hit.overlay);
      } else if (state.selectedOverlayId) {
        deselect();
      }
    }
    releaseChart();
    touchStart = null; touchMoved = false; dragCandidate = null;
  }, { capture: true, passive: false });

  host.addEventListener("touchcancel", () => {
    releaseChart();
    touchStart = null; touchMoved = false; dragCandidate = null; drag = null;
  }, { capture: true, passive: false });

  // Tap ausserhalb des Charts (Topbar, Bottom Bar) hebt die Auswahl auf
  document.addEventListener("touchstart", (e) => {
    if (!state.selectedOverlayId) return;
    if (host.contains(e.target) || bar.contains(e.target)) return;
    deselect();
  }, { passive: true });
}, "drawing select init");

// ── 5. Y-Achse mit einem Finger verschieben ───────────────────────────
// KLineCharts bewegt bei einem Finger nur die Zeitachse. Hier kommt die
// senkrechte Verschiebung des Preisbereichs dazu. Auf der Preisskala
// rechts bleibt die vorhandene Bedienung unangetastet.
quiet(() => {
  const host = document.getElementById("mainChart");
  if (!host || !tvIsMobile()) return;
  const AXIS = 80;
  let last = null;

  host.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || state.activeTool) { last = null; return; }
    const t = e.touches[0];
    const rect = host.getBoundingClientRect();
    if (t.clientX - rect.left > rect.width - AXIS) { last = null; return; }
    last = t.clientY;
  }, { passive: true });

  host.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1 || last === null || state.activeTool) return;
    const y  = e.touches[0].clientY;
    const dy = y - last;
    last = y;
    if (Math.abs(dy) < 1) return;

    quiet(() => {
      const pane = chart.getDrawPaneById("candle_pane");
      if (!pane) return;
      const axis = pane.getAxisComponent();
      if (!axis || typeof axis.getRange !== "function") return;
      const r = axis.getRange();
      if (!r || r.range == null) return;

      // Der Chart folgt dem Finger: nach unten ziehen schiebt den
      // Preisbereich nach oben, es kommen höhere Kurse ins Bild.
      const shift = (r.range / host.clientHeight) * dy;
      const from = r.from + shift, to = r.to + shift;
      const rf = axis.convertToRealValue(from);
      const rt = axis.convertToRealValue(to);
      axis.setAutoCalcTickFlag(false);
      axis.setRange({ from, to, range: r.range,
                      realFrom: rf, realTo: rt, realRange: rt - rf });
      chart.adjustPaneViewport(false, true, true, true);
    }, "y-pan");
  }, { passive: true });

  const stop = () => { last = null; };
  host.addEventListener("touchend",    stop, { passive: true });
  host.addEventListener("touchcancel", stop, { passive: true });
}, "y-pan init");

// ── 6. Volumenprofil: zwei gestrichelte Grenzlinien ───────────────────
// Aufziehen scheitert auf dem Handy, weil dieselbe Geste den Chart
// verschiebt. Stattdessen: Finger aufsetzen, eine senkrechte gestrichelte
// Linie folgt ihm; beim Anheben steht die erste Grenze. Dasselbe noch
// einmal für die zweite — danach wird das Profil gezeichnet.
quiet(() => {
  const host = document.getElementById("mainChart");
  const gA   = document.getElementById("frvpGuideA");
  const gB   = document.getElementById("frvpGuideB");
  if (!host || !gA || !gB || !tvIsMobile()) return;

  let step = 0;          // 0 = keine Grenze, 1 = erste steht
  let drag = null;       // Linie, die gerade am Finger hängt
  let xA = null;

  const active = () => state.activeTool === "frvp";
  const xOf = (t) => t.clientX - host.getBoundingClientRect().left;

  const reset = () => {
    step = 0; drag = null; xA = null;
    [gA, gB].forEach(g => g.classList.remove("active", "set"));
  };
  window.__tvFrvpReset = reset;

  const put = (g, x) => { g.style.left = x + "px"; g.classList.add("active"); };

  // stopPropagation hält KLineCharts von der Geste fern — sonst würde der
  // Chart unter dem Finger mitwandern, während die Linie gezogen wird.
  host.addEventListener("touchstart", (e) => {
    if (!active() || e.touches.length !== 1) return;
    e.stopPropagation();
    drag = (step === 0) ? gA : gB;
    drag.classList.remove("set");
    put(drag, xOf(e.touches[0]));
  }, { passive: false });

  host.addEventListener("touchmove", (e) => {
    if (!active() || !drag || e.touches.length !== 1) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    put(drag, xOf(e.touches[0]));
  }, { passive: false });

  host.addEventListener("touchend", (e) => {
    if (!active() || !drag) return;
    e.stopPropagation();
    const x = parseFloat(drag.style.left) || 0;
    drag.classList.add("set");
    drag = null;

    if (step === 0) {
      xA = x; step = 1;
      setStatus("Volumenprofil: zweite Grenze ziehen und loslassen");
      return;
    }
    build(xA, x);
  }, { passive: false });

  function build(x1, x2) {
    if (Math.abs(x1 - x2) < 8) {
      setStatus("Volumenprofil: Bereich zu schmal — nochmals versuchen");
      reset();
      return;
    }
    quiet(() => {
      const y = Math.round(host.clientHeight / 2);
      const one = (p) => Array.isArray(p) ? p[0] : p;
      const a = one(chart.convertFromPixel({ x: Math.min(x1, x2), y }, { paneId: "candle_pane" }));
      const b = one(chart.convertFromPixel({ x: Math.max(x1, x2), y }, { paneId: "candle_pane" }));
      if (!a || !b || a.timestamp == null || b.timestamp == null) {
        setStatus("Volumenprofil: Bereich liegt ausserhalb der Daten");
        return;
      }
      // Ohne diese Handler ist ein per Geste gezeichnetes Volumenprofil
      // anonym: Es lässt sich nicht auswählen und hat kein Menü.
      let id = chart.createOverlay({
        name: "frvp",
        points: [{ timestamp: a.timestamp, value: a.value },
                 { timestamp: b.timestamp, value: b.value }],
        styles: currentOverlayStyles(),
        onSelected:   (ev) => { state.selectedOverlayId = ev.overlay.id; return false; },
        onDeselected: () => { state.selectedOverlayId = null; return false; },
        onMouseEnter: () => { setChartCursor("pointer"); return false; },
        onMouseLeave: () => { setChartCursor(""); return false; },
        onRightClick: (ev) => { openFrvpMenu(ev.overlay, ev); return true; },
      });
      if (Array.isArray(id)) id = id[0];
      if (id) captureDrawing(id);
      setStatus("Volumenprofil gezeichnet");
    }, "frvp build");

    reset();
    if (!state.pinTool) {
      state.activeTool = null;
      renderDrawbar();
    }
  }

  // Werkzeugwechsel räumt die Linien weg
  const orig = startTool;
  startTool = function (name) {
    reset();
    if (name === "frvp") setStatus("Volumenprofil: erste Grenze ziehen und loslassen");
    return orig.apply(this, arguments);
  };
  window.__tvStartTool = startTool;
}, "frvp gesture");

// ── 7. Abdunkler hinter offenen Blättern ──────────────────────────────
quiet(() => {
  if (!tvIsMobile()) return;
  const bd = document.getElementById("drawSheetBackdrop");
  if (!bd) return;

  const sync = () => {
    const open = document.querySelector(".dd-panel.open")
      || !document.getElementById("drawSheet")?.classList.contains("hidden");
    bd.classList.toggle("hidden", !open);
  };
  window.__tvSyncBackdrop = sync;

  // Nach jedem Klick den Zustand angleichen — deckt Öffnen wie Schliessen ab
  document.addEventListener("click", () => setTimeout(sync, 0), true);
  bd.addEventListener("click", () => {
    document.querySelectorAll(".dd-panel.open").forEach(p => p.classList.remove("open"));
    document.getElementById("drawSheet")?.classList.add("hidden");
    sync();
  });
}, "backdrop sync");

})();
