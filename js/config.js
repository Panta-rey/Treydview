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

  CANDLE_LIMIT: 1000,

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
      ],
    },
    {
      key: "bmsb", name: "BMSB", pane: "main", label: "Bull Market Support Band",
      inputs: [],
      plots: [
        { key: "sma20", label: "20 SMA", color: "#3fb68b", opacity: 100, width: 2, visible: true },
        { key: "ema21", label: "21 EMA", color: "#d05e5e", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "ema", name: "EMA", pane: "main", label: "EMA 21 / 100 / 200",
      inputs: [
        { key: "p1", label: "Periode 1", default: 21  },
        { key: "p2", label: "Periode 2", default: 100 },
        { key: "p3", label: "Periode 3", default: 200 },
      ],
      plots: [
        { key: "e1", label: "EMA 1", color: "#5aa9e6", opacity: 100, width: 1, visible: true },
        { key: "e2", label: "EMA 2", color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "e3", label: "EMA 3", color: "#c792ea", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      key: "boll", name: "BOLL", pane: "main", label: "Bollinger",
      inputs: [
        { key: "period", label: "Periode", default: 20 },
        { key: "stddev", label: "StdDev",  default: 2  },
      ],
      plots: [
        { key: "up",  label: "Oberes Band",  color: "#7a8fa8", opacity: 60, width: 1, visible: true },
        { key: "mid", label: "Mittellinie",  color: "#7a8fa8", opacity: 80, width: 1, visible: true },
        { key: "dn",  label: "Unteres Band", color: "#7a8fa8", opacity: 60, width: 1, visible: true },
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
        { key: "period", label: "Periode", default: 55 },
      ],
      plots: [
        { key: "up",   label: "Trend aufwärts", color: "#3fb68b", opacity: 100, width: 2, visible: true, noVisible: true },
        { key: "down", label: "Trend abwärts",  color: "#d05e5e", opacity: 100, width: 2, visible: true, noVisible: true, noWidth: true },
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
      key: "rsi", name: "RSI", pane: "sub", label: "RSI 14",
      inputs: [
        { key: "period", label: "Periode", default: 14 },
      ],
      plots: [
        { key: "line", label: "RSI-Linie", color: "#c792ea", opacity: 100, width: 2, visible: true },
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
      key: "vol", name: "VOL", pane: "sub", label: "Volumen",
      inputs: [], plots: [],
    },
  ],

  DEFAULT_ACTIVE: ["mnoodle", "bmsb", "ema", "rsi", "vol"],

  DRAW_TOOLS: [
    { overlay: "segment",                icon: "╱",  title: "Trendlinie" },
    { overlay: "rayLine",                icon: "⟋",  title: "Strahl" },
    { overlay: "horizontalStraightLine", icon: "─",  title: "Horizontale Linie" },
    { overlay: "verticalStraightLine",   icon: "│",  title: "Vertikale Linie" },
    { overlay: "priceLine",              icon: "₊─", title: "Preislinie" },
    { overlay: "priceChannelLine",       icon: "⫽",  title: "Preiskanal" },
    { overlay: "parallelStraightLine",   icon: "∥",  title: "Parallele Linien" },
    { overlay: "fibonacciLine",          icon: "𝑓",  title: "Fibonacci" },
    { overlay: "rectangle",              icon: "▭",  title: "Rechteck" },
    { overlay: "priceRange",             icon: "↕",  title: "Price Range" },
    { overlay: "dateRange",              icon: "↔",  title: "Date Range" },
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

// ---------- Farb-Helfer (global) ----------
function hexToRgba(hex, opacityPct) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  return `rgba(${r},${g},${b},${a})`;
}
