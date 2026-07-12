// ============================================================
// TreydView v0.3 — Konfiguration
// ============================================================
const CONFIG = {

  WORKER_BASE_URL: "https://DEIN-WORKER.workers.dev",
  GOLD_ENDPOINT:   "/goldhistory",
  BINANCE_REST:    "https://api.binance.com/api/v3",
  BINANCE_WS:      "wss://stream.binance.com:9443/ws",

  // Fixe Symbole (Worker-Quellen + Binance-Defaults)
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

  // Indikator-Registry
  // pane: "main" = Overlay | "sub" = eigenes Sub-Chart
  // settings: wird im Einstellungs-Panel angezeigt
  INDICATORS: [
    {
      key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle",
      settings: [
        { key: "fastPeriod",   label: "Fast EMA",       type: "number", default: 12    },
        { key: "medPeriod",    label: "Medium EMA",     type: "number", default: 21    },
        { key: "slowPeriod",   label: "Main EMA",       type: "number", default: 35    },
        { key: "atrLength",    label: "ATR Länge",      type: "number", default: 20    },
        { key: "bandMult",     label: "Band Multiplier",type: "number", default: 0.0125, step: 0.001 },
        { key: "colorMed",     label: "Medium EMA",     type: "color",  default: "#00ff88" },
        { key: "colorMain",    label: "Main EMA",       type: "color",  default: "#ffffff" },
        { key: "colorBand",    label: "Band Fill",      type: "color",  default: "rgba(150,150,150,0.15)" },
      ],
    },
    {
      key: "bmsb", name: "BMSB", pane: "main", label: "Bull Market Support Band",
      settings: [
        { key: "colorSma", label: "20 SMA Farbe", type: "color", default: "#3fb68b" },
        { key: "colorEma", label: "21 EMA Farbe", type: "color", default: "#d05e5e" },
      ],
    },
    {
      key: "ema",  name: "EMA",  pane: "main", label: "EMA 21 / 100 / 200",
      calcParams: [21, 100, 200],
      settings: [
        { key: "p1", label: "Periode 1", type: "number", default: 21  },
        { key: "p2", label: "Periode 2", type: "number", default: 100 },
        { key: "p3", label: "Periode 3", type: "number", default: 200 },
      ],
    },
    {
      key: "boll", name: "BOLL", pane: "main", label: "Bollinger 20/2",
      calcParams: [20, 2],
      settings: [
        { key: "period", label: "Periode", type: "number", default: 20 },
        { key: "stddev", label: "StdDev",  type: "number", default: 2  },
      ],
    },
    {
      key: "gc",   name: "GC",   pane: "main", label: "Gaussian Channel",
      calcParams: [144, 1.414, 4],
      settings: [
        { key: "period", label: "Periode",    type: "number", default: 144   },
        { key: "mult",   label: "Multiplier", type: "number", default: 1.414, step: 0.001 },
        { key: "poles",  label: "Pole",       type: "number", default: 4     },
      ],
    },
    {
      key: "hull", name: "HULL", pane: "main", label: "Hull Suite",
      calcParams: [55],
      settings: [
        { key: "period", label: "Periode", type: "number", default: 55 },
      ],
    },
    {
      key: "rvwap", name: "RVWAP", pane: "main", label: "Rolling VWAP 365d",
      calcParams: [365],
      settings: [
        { key: "days", label: "Tage", type: "number", default: 365 },
      ],
    },
    {
      key: "vrvp", name: "VRVP", pane: "main", label: "VRVP",
      settings: [
        { key: "rows",      label: "Rows",        type: "number", default: 500  },
        { key: "valueArea", label: "Value Area %", type: "number", default: 70   },
        { key: "width",     label: "Breite %",    type: "number", default: 15   },
        { key: "colorUp",   label: "Up-Farbe",    type: "color",  default: "rgba(63,182,139,0.6)"  },
        { key: "colorDown", label: "Down-Farbe",  type: "color",  default: "rgba(208,94,94,0.6)"   },
        { key: "colorVA",   label: "Value Area",  type: "color",  default: "rgba(232,182,76,0.35)" },
      ],
    },
    {
      key: "rsi",  name: "RSI",  pane: "sub",  label: "RSI 14",
      calcParams: [14],
      settings: [
        { key: "period", label: "Periode", type: "number", default: 14 },
      ],
    },
    {
      key: "vol",  name: "VOL",  pane: "sub",  label: "Volumen",
      settings: [],
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
    { overlay: "rectangle",             icon: "▭",  title: "Rechteck" },
    { overlay: "priceRange",             icon: "↕",  title: "Price Range" },
    { overlay: "dateRange",              icon: "↔",  title: "Date Range" },
  ],

  THEME: {
    up:     "#3fb68b",
    down:   "#d05e5e",
    accent: "#e8b64c",
    text:   "#8fa3b8",
    grid:   "rgba(143,163,184,0.07)",
  },
};
