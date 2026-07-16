// ============================================================
// TreydView v0.4 — Konfiguration
// ============================================================
const CONFIG = {

  // >>> HIER deine Cloudflare-Worker-Basis-URL eintragen <<<
  WORKER_BASE_URL: "https://DEIN-WORKER.workers.dev",
  GOLD_ENDPOINT:   "/goldhistory",
  BINANCE_REST:    "https://api.binance.com/api/v3",
  BINANCE_WS:      "wss://stream.binance.com:9443/ws",

  DEFAULT_SYMBOLS: [
    { id: "BTCUSDT",  label: "BTC/USDT",  type: "binance" },
    { id: "ETHUSDT",  label: "ETH/USDT",  type: "binance" },
    { id: "SOLUSDT",  label: "SOL/USDT",  type: "binance" },
    { id: "XAUUSD",   label: "Gold XAU/USD", type: "worker" },
  ],

  TIMEFRAMES: [
    { id: "15m", label: "15m", binanceInterval: "15m" },
    { id: "1h",  label: "1h",  binanceInterval: "1h"  },
    { id: "4h",  label: "4h",  binanceInterval: "4h"  },
    { id: "1d",  label: "1D",  binanceInterval: "1d"  },
    { id: "1w",  label: "1W",  binanceInterval: "1w"  },
    { id: "1M",  label: "1M",  binanceInterval: "1M"  },
  ],

  CANDLE_LIMIT: 5000,        // per Pagination (Binance max 1000/Request)
  LAZY_LOAD_CHUNK: 1000,     // Nachladen beim Zurückscrollen
  WATCHLIST_DEFAULT: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],

  // ------------------------------------------------------------
  // Indikator-Registry mit zweistufigem Settings-Schema:
  //   inputs: Berechnungs-Parameter (Tab "Inputs")
  //   plots:  Darstellung pro Linie (Tab "Style"):
  //           visible, Farbe, Deckkraft (0–100), Linienstärke
  //   Plot-Flags: noVisible / noWidth blenden die Controls aus.
  // ------------------------------------------------------------
  INDICATORS: [
    {
      key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle",
      inputs: [
        { key: "fastPeriod", label: "Fast EMA",         default: 12 },
        { key: "medPeriod",  label: "Medium EMA",       default: 21 },
        { key: "slowPeriod", label: "Main EMA",         default: 35 },
        { key: "atrLength",  label: "ATR Länge",        default: 20 },
        { key: "bandMult",   label: "Band Multiplier",  default: 0.0125, step: 0.001 },
      ],
      plots: [
        { key: "fast",  label: "Fast EMA",   color: "#00c8dc", opacity: 100, width: 1, visible: false },
        { key: "med",   label: "Medium EMA", color: "#00ff88", opacity: 100, width: 2, visible: true },
        { key: "main",  label: "Main EMA",   color: "#ffffff", opacity: 100, width: 3, visible: true },
        { key: "upper", label: "Upper Band", color: "#969696", opacity: 50,  width: 1, visible: true },
        { key: "lower", label: "Lower Band", color: "#969696", opacity: 50,  width: 1, visible: true },
        { key: "fill",  label: "Band-Fill",  color: "#969696", opacity: 10,  width: 1, visible: false, noWidth: true },
      ],
    },
    {
      key: "bmsb", name: "BMSB", pane: "main", label: "Bull Market Support Band",
      inputs: [],
      plots: [
        { key: "sma20", label: "20 SMA", color: "#3fb68b", opacity: 100, width: 2, visible: true },
        { key: "ema21", label: "21 EMA", color: "#d05e5e", opacity: 100, width: 2, visible: true },
        { key: "fill",  label: "Band-Fill", color: "#3fb68b", opacity: 20,  width: 1, visible: false, noWidth: true },
      ],
    },
    {
      key: "sma", name: "MYSMA", pane: "main", label: "SMA 20 / 50 / 100 / 200",
      inputs: [
        { key: "p1", label: "Periode 1", default: 20  },
        { key: "p2", label: "Periode 2", default: 50  },
        { key: "p3", label: "Periode 3", default: 100 },
        { key: "p4", label: "Periode 4", default: 200 },
      ],
      plots: [
        { key: "s1", label: "SMA 1", color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "s2", label: "SMA 2", color: "#5aa9e6", opacity: 100, width: 1, visible: true },
        { key: "s3", label: "SMA 3", color: "#c792ea", opacity: 100, width: 1, visible: true },
        { key: "s4", label: "SMA 4", color: "#3fb68b", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "ema", name: "EMA", pane: "main", label: "EMA 21 / 50 / 100 / 200",
      inputs: [
        { key: "p1", label: "Periode 1", default: 21  },
        { key: "p2", label: "Periode 2", default: 50  },
        { key: "p3", label: "Periode 3", default: 100 },
        { key: "p4", label: "Periode 4", default: 200 },
      ],
      plots: [
        { key: "e1", label: "EMA 21",  color: "#5aa9e6", opacity: 100, width: 1, visible: true },
        { key: "e2", label: "EMA 50",  color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "e3", label: "EMA 100", color: "#c792ea", opacity: 100, width: 1, visible: true },
        { key: "e4", label: "EMA 200", color: "#3fb68b", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "boll", name: "BOLL", pane: "main", label: "Bollinger",
      inputs: [
        { key: "period", label: "Length",  default: 20 },
        { key: "stddev", label: "StdDev",  default: 2.0, step: 0.1 },
        { key: "maType", label: "MA-Typ",  default: "SMA", type: "select", options: ["SMA","EMA","SMMA","WMA","VWMA"] },
        { key: "offset", label: "Offset",  default: 0 },
      ],
      plots: [
        { key: "up",   label: "Oberes Band",  color: "#7a8fa8", opacity: 60, width: 1, visible: true },
        { key: "mid",  label: "Basis (MA)",   color: "#7a8fa8", opacity: 80, width: 1, visible: true },
        { key: "dn",   label: "Unteres Band", color: "#7a8fa8", opacity: 60, width: 1, visible: true },
        { key: "fill", label: "Band-Fill",    color: "#7a8fa8", opacity: 10, width: 1, visible: true, noWidth: true },
      ],
    },
    {
      key: "gc", name: "GC", pane: "main", label: "Gaussian Channel",
      inputs: [
        { key: "period", label: "Periode",    default: 144 },
        { key: "mult",   label: "Multiplier", default: 1.414, step: 0.001 },
        { key: "poles",  label: "Pole",       default: 4 },
      ],
      plots: [
        { key: "upper",   label: "Oberes Band",     color: "#e8b64c", opacity: 55, width: 1, visible: true },
        { key: "midUp",   label: "Mitte (steigend)", color: "#3fb68b", opacity: 100, width: 2, visible: true, noVisible: true },
        { key: "midDown", label: "Mitte (fallend)",  color: "#d05e5e", opacity: 100, width: 2, visible: true, noVisible: true, noWidth: true },
        { key: "lower",   label: "Unteres Band",    color: "#e8b64c", opacity: 55, width: 1, visible: true },
      ],
    },
    {
      key: "hull", name: "HULL", pane: "main", label: "Hull Suite",
      inputs: [
        { key: "mode",       label: "Variation",         default: "HMA",  type: "select", options: ["HMA","EHMA","THMA"] },
        { key: "period",     label: "Length",             default: 55 },
        { key: "lengthMult", label: "Length Multiplier", default: 1.0, step: 0.1 },
      ],
      plots: [
        { key: "up",   label: "Trend aufwärts", color: "#00ff00", opacity: 80, width: 2, visible: true, noVisible: true },
        { key: "down", label: "Trend abwärts",  color: "#ff0000", opacity: 80, width: 2, visible: true, noVisible: true, noWidth: true },
        { key: "band", label: "Band-Fill",       color: "#888888", opacity: 40, width: 1, visible: true, noWidth: true },
      ],
    },
    {
      key: "rvwap", name: "RVWAP", pane: "main", label: "Rolling VWAP 365d",
      inputs: [
        { key: "days", label: "Tage", default: 365 },
      ],
      plots: [
        { key: "line", label: "VWAP-Linie", color: "#e8b64c", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "vrvp", name: "VRVP", pane: "main", label: "VRVP",
      inputs: [
        { key: "rows",      label: "Rows",         default: 500 },
        { key: "valueArea", label: "Value Area %", default: 70  },
        { key: "width",     label: "Breite %",     default: 15  },
      ],
      plots: [
        { key: "up",   label: "Up-Volumen",   color: "#3fb68b", opacity: 60, width: 1, visible: true, noWidth: true },
        { key: "down", label: "Down-Volumen", color: "#d05e5e", opacity: 60, width: 1, visible: true, noWidth: true },
        { key: "va",   label: "Value Area",   color: "#e8b64c", opacity: 12, width: 1, visible: true, noWidth: true },
      ],
    },
    {
      key: "myrsi", name: "MYRSI", pane: "sub", label: "RSI",
      inputs: [
        { key: "period",   label: "RSI Length", default: 14 },
        { key: "maType",   label: "Smoothing",  default: "None", type: "select", options: ["None","SMA","SMA + BB","EMA","SMMA","WMA","VWMA"] },
        { key: "maLength", label: "MA Length",  default: 14 },
        { key: "bbMult",   label: "BB StdDev",  default: 2.0, step: 0.5 },
      ],
      plots: [
        { key: "line",    label: "RSI-Linie",   color: "#7e57c2", opacity: 100, width: 2, visible: true },
        { key: "band70",  label: "Linie 70",    color: "#787b86", opacity: 70,  width: 1, visible: true },
        { key: "band50",  label: "Linie 50",    color: "#787b86", opacity: 40,  width: 1, visible: true },
        { key: "band30",  label: "Linie 30",    color: "#787b86", opacity: 70,  width: 1, visible: true },
        { key: "bgFill",  label: "Fill 30–70",  color: "#7e57c2", opacity: 8,   width: 1, visible: true, noWidth: true },
        { key: "obFill",  label: "Overbought",  color: "#3fb68b", opacity: 25,  width: 1, visible: true, noWidth: true },
        { key: "osFill",  label: "Oversold",    color: "#d05e5e", opacity: 25,  width: 1, visible: true, noWidth: true },
        { key: "maLine",  label: "RSI-MA",      color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "bbUpper", label: "BB Oben",     color: "#3fb68b", opacity: 80,  width: 1, visible: true },
        { key: "bbLower", label: "BB Unten",    color: "#3fb68b", opacity: 80,  width: 1, visible: true },
      ],
    },
    {
      key: "stochrsi", name: "STOCHRSI", pane: "sub", label: "Stochastic RSI",
      inputs: [
        { key: "smoothK",     label: "K",          default: 3  },
        { key: "smoothD",     label: "D",          default: 3  },
        { key: "lengthRSI",   label: "RSI Länge",  default: 14 },
        { key: "lengthStoch", label: "Stoch Länge", default: 14 },
      ],
      plots: [
        { key: "k", label: "K", color: "#2962ff", opacity: 100, width: 2, visible: true },
        { key: "d", label: "D", color: "#ff6d00", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "myvol", name: "MYVOL", pane: "sub", label: "Volumen",
      inputs: [
        { key: "ma1", label: "MA 1 Länge", default: 5  },
        { key: "ma2", label: "MA 2 Länge", default: 10 },
        { key: "ma3", label: "MA 3 Länge", default: 20 },
      ],
      plots: [
        { key: "up",  label: "Up-Balken",   color: "#3fb68b", opacity: 65,  width: 1, visible: true, noWidth: true },
        { key: "dn",  label: "Down-Balken", color: "#d05e5e", opacity: 65,  width: 1, visible: true, noWidth: true },
        { key: "ma1", label: "MA 1",        color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "ma2", label: "MA 2",        color: "#5aa9e6", opacity: 100, width: 1, visible: true },
        { key: "ma3", label: "MA 3",        color: "#c792ea", opacity: 100, width: 1, visible: true },
      ],
    },
    {
      key: "macd", name: "MACD", pane: "sub", label: "MACD",
      inputs: [
        { key: "fast",    label: "Fast Length",   default: 12 },
        { key: "slow",    label: "Slow Length",   default: 26 },
        { key: "signal",  label: "Signal Length", default: 9  },
        { key: "oscType", label: "Oscillator MA", default: "EMA", type: "select", options: ["EMA","SMA"] },
        { key: "sigType", label: "Signal MA",     default: "EMA", type: "select", options: ["EMA","SMA"] },
      ],
      plots: [
        { key: "macd",   label: "MACD-Linie",   color: "#2962ff", opacity: 100, width: 2, visible: true },
        { key: "signal", label: "Signal-Linie",  color: "#ff6d00", opacity: 100, width: 2, visible: true },
        { key: "histUp", label: "Hist. steigend (pos)", color: "#26a69a", opacity: 100, width: 1, visible: true, noWidth: true },
        { key: "histDn", label: "Hist. fallend (neg)",  color: "#ff5252", opacity: 100, width: 1, visible: true, noWidth: true },
      ],
    },
    {
      key: "atr", name: "ATR", pane: "sub", label: "ATR",
      inputs: [
        { key: "period",    label: "Length",    default: 14 },
        { key: "smoothing", label: "Smoothing", default: "RMA", type: "select", options: ["RMA","SMA","EMA","WMA"] },
      ],
      plots: [
        { key: "atr", label: "ATR-Linie", color: "#b71c1c", opacity: 100, width: 2, visible: true },
      ],
    },
  ],

  DEFAULT_ACTIVE: ["mnoodle", "bmsb", "ema", "myrsi", "myvol"],

  DRAW_TOOLS: [
    { overlay: "segment",                icon: "╱",  title: "Trendlinie" },
    { overlay: "rayLine",                icon: "⟋",  title: "Strahl" },
    { overlay: "horizontalStraightLine", icon: "─",  title: "Horizontale Linie" },
    { overlay: "verticalStraightLine",   icon: "│",  title: "Vertikale Linie" },
    { overlay: "priceLine",              icon: "₊─", title: "Preislinie" },
    { overlay: "priceChannelLine",       icon: "⫽",  title: "Preiskanal" },
    { overlay: "parallelStraightLine",   icon: "∥",  title: "Parallele Linien" },
    { overlay: "fibRetracement",        icon: "𝑓",  title: "Fib Retracement" },
    { overlay: "fibExtension",          icon: "𝑓",  title: "Fib Extension" },
    { overlay: "rectangle",              icon: "▭",  title: "Rechteck" },
    { overlay: "priceRange",             icon: "↕",  title: "Price Range" },
    { overlay: "dateRange",              icon: "↔",  title: "Date Range" },
    { overlay: "frvp",                   icon: "▤",  title: "Fixed Range Volume Profile" },
  ],

  // Standard-Stil für neue Zeichnungen (im Draw-Stil-Popover änderbar)
  DRAW_STYLE_DEFAULT: {
    color:   "#e8b64c",
    opacity: 100,
    width:   2,
    style:   "solid",   // solid | dashed
  },

  THEME: {
    up: "#3fb68b", down: "#d05e5e", accent: "#e8b64c",
    text: "#8fa3b8", grid: "rgba(143,163,184,0.07)",
  },
};


// ---------- Fibonacci-Levels (einzige Quelle) ----------
// Wird von overlays.js (Zeichnen) UND app.js (Einstellungsmenü) gelesen.
// Vorher lagen zwei Kopien in beiden Dateien — Änderungen an einer Stelle
// liefen ins Leere.
const FIB_LEVEL_SETS = {
  fibRetracement: [
    { v: 0,     color: "#9aa5b1" },
    { v: 0.236, color: "#c96868" },
    { v: 0.382, color: "#c9973f" },
    { v: 0.5,   color: "#6fae7a" },
    { v: 0.618, color: "#5aa06b" },
    { v: 0.786, color: "#4a9ba8" },
    { v: 1,     color: "#9aa5b1" },
    { v: 1.618, color: "#5a7fa8" },
    { v: 2.618, color: "#a85f6f" },
    { v: 3.618, color: "#8a5fa8" },
    { v: 4.236, color: "#a85f7a" },
  ],
  fibExtension: [
    { v: 0,     color: "#9aa5b1" },
    { v: 0.236, color: "#c96868" },
    { v: 0.382, color: "#c9973f" },
    { v: 0.5,   color: "#6fae7a" },
    { v: 0.618, color: "#5aa06b" },
    { v: 1,     color: "#9aa5b1" },
    { v: 1.272, color: "#4a9ba8" },
    { v: 1.618, color: "#5a7fa8" },
    { v: 2,     color: "#a85f6f" },
    { v: 2.618, color: "#8a5fa8" },
    { v: 3.618, color: "#a85f7a" },
    { v: 4.236, color: "#a8735f" },
  ],
};

// ---------- Farb-Helfer (global) ----------
function hexToRgba(hex, opacityPct) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  return `rgba(${r},${g},${b},${a})`;
}
