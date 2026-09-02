// ============================================================
// TreydView v0.4 — Konfiguration
// ============================================================
const CONFIG = {

  // >>> HIER deine Cloudflare-Worker-Basis-URL eintragen <<<
  WORKER_BASE_URL: "https://pantarey.rey-gafner.workers.dev",
  GOLD_ENDPOINT:   "/goldhistory",
  SILVER_ENDPOINT: "/silverhistory",
  BITSTAMP_ENDPOINT: "/bitstamp",

  // ---- Historie-Momentaufnahmen ----------------------------------
  // Statische Dateien im Repo mit der kompletten Altdatenhistorie.
  // Der Browser laedt sie vom GitHub-Pages-CDN und fragt den Worker nur
  // noch nach dem Zuwachs seit der letzten gespeicherten Kerze.
  //
  // Vorteile gegenueber dem vollen Abruf bei jedem Laden:
  //   • gzip-Groesse ~62 KB (BTC) bzw. ~109 KB (Gold), vom Browser
  //     zwischengespeichert — statt 233 bzw. 529 KB roh je Aufruf
  //   • der Chart zeigt Historie auch dann, wenn Worker oder Quelle
  //     gerade nicht erreichbar sind
  //   • weniger Worker-Aufrufe und kein Durchblaettern von 12 Seiten
  //
  // Fehlt eine Datei, faellt der Ladeweg automatisch auf den vollen
  // Worker-Abruf zurueck — nichts geht kaputt, es wird nur langsamer.
  // Erzeugen: siehe tools/snapshot.sh
  // Nur Tageskerzen — fuer 1h/4h waeren es Hunderttausende Kerzen, die
  // gehoeren nicht ins Repo. Dort laeuft weiter der volle Abruf.
  HISTORY_SNAPSHOTS: {
    BTCUSD_BS: "data/btcusd-bitstamp.json",
    ETHUSD_BS: "data/ethusd-bitstamp.json",
    // BTCUSDT/ETHUSDT-Snapshots liegen bewusst nicht im Repo -> der fetch gab 404
    // in der Konsole. Entfernt; diese Paare laufen über den vollen Binance-Abruf.
    XAUUSD:    "data/gold-lbma.json",
  },
  // Allgemeine Stooq-Zeitreihe ueber denselben Worker. Erwartet
  //   GET <WORKER_BASE_URL>/stooq?s=<symbol>
  // und liefert entweder Stooq-CSV (date,open,high,low,close,volume) oder
  // JSON in derselben Form. Stooq selbst erlaubt keinen Direktabruf aus dem
  // Browser (CORS) — deshalb der Umweg, genau wie beim Gold.
  STOOQ_ENDPOINT:  "/stooq",
  // Globale M2-Geldmenge, aggregiert. Erwartet
  //   GET <WORKER_BASE_URL>/m2
  // und liefert [{ date, value }, ...] oder CSV date,value.
  M2_ENDPOINT:     "/m2",
  BINANCE_REST:    "https://api.binance.com/api/v3",
  BINANCE_WS:      "wss://stream.binance.com:9443/ws",

  // Kuratierte Vorschlagsliste (Punkt 6): diese IDs stehen bei leerem
  // Suchfeld ganz oben, in genau dieser Reihenfolge. Alles andere folgt
  // darunter, sortiert nach 24h-USD-Volumen (loadAllExchangeSymbols).
  // XAGUSD (Silber) wird von Punkt 5 ergaenzt.
  CURATED_IDS: [
    "BTCUSDT", "BTCUSD_BS", "ETHUSDT", "ETHUSD_BS", "SOLUSDT", "BTCD", "USDTD",
    "XAUUSD", "XAGUSD", "^SPX", "^NDQ", "^DJI", "QQQ", "VTSAX",
  ],

  DEFAULT_SYMBOLS: [
    // ── Kuratierte Vorschlagsliste (Punkt 6): diese zuerst, in dieser
    //    Reihenfolge, wenn das Suchfeld leer ist. Der Rest folgt darunter
    //    (nach 24h-Volumen sortiert, siehe loadAllExchangeSymbols).
    { id: "BTCUSDT",  label: "BTC/USDT (Binance)",  type: "binance" },
    // Binance beginnt bei BTC/USDT im August 2017. Bitstamp handelt
    // BTC/USD seit 2011 — eine durchgehende Reihe ohne Nahtstellen.
    // Bewusst ein EIGENES Symbol statt einer zusammengeklebten Historie:
    // USD und USDT sind verschiedene Maerkte mit eigenen Preisen.
    { id: "BTCUSD_BS", label: "BTC/USD (Bitstamp, ab 2011)", type: "bitstamp", bitstampPair: "btcusd" },
    { id: "ETHUSDT",  label: "ETH/USDT (Binance)",  type: "binance" },
    // ETH/USD ueber Bitstamp (Herbst 2015, frueher als Kraken). Der Worker
    // liefert das tatsaechliche Startdatum im Feld "from" mit.
    { id: "ETHUSD_BS", label: "ETH/USD (Bitstamp)", type: "bitstamp", bitstampPair: "ethusd" },
    { id: "SOLUSDT",  label: "SOL/USDT (Binance)",  type: "binance" },
    { id: "BTCD",     label: "BTC.D (Dominanz)",    type: "dominance", domCoin: "btcd"  },
    { id: "USDTD",    label: "USDT.D (Dominanz)",   type: "dominance", domCoin: "usdtd" },
    { id: "XAUUSD",   label: "Gold XAU/USD (ab 1968)", type: "worker" },
    // Silber XAG/USD (Punkt 5): LBMA-Fixing, ein Preis je Tag -> als Linie.
    // Eigener Worker-Endpunkt /silverhistory (Dispatch in app.js loadData).
    { id: "XAGUSD",   label: "Silber XAG/USD (ab 1968)", type: "worker" },
    // Aktienindizes ueber den Worker (Stooq). Nur Tageskerzen.
    { id: "^SPX", label: "S&P 500",   type: "stooq", stooqSymbol: "^spx" },
    // FRED fuehrt fuer Nasdaq nur den Composite (Serie NASDAQCOM).
    { id: "^NDQ", label: "Nasdaq Composite", type: "stooq", stooqSymbol: "^ndq" },
    { id: "^DJI", label: "Dow Jones",  type: "stooq", stooqSymbol: "^dji" },
    // Fonds. Gleicher Worker-Weg wie die Indizes, ohne FRED-Rueckfall.
    { id: "QQQ",   label: "Invesco QQQ Trust",     type: "stooq", stooqSymbol: "qqq"   },
    { id: "VTSAX", label: "Vanguard VTSAX",        type: "stooq", stooqSymbol: "vtsax" },

    // ── Rest (nicht in der kuratierten Liste) ──
    { id: "AEROUSDT", label: "AERO/USDT (Binance)", type: "binance" },
    // SOL/USD via Kraken (fuer SOL gibt es keine bessere Alternative).
    { id: "SOLUSD_KR",  label: "SOL/USD (Kraken)",  type: "kraken", krakenPair: "SOLUSD"   },
    // Coinbase: AERO seit 2024 gelistet (mehr Historie als Binance Dez 2024).
    { id: "AERO-USD", label: "AERO/USD (Coinbase)", type: "coinbase", coinbaseProduct: "AERO-USD" },
    // Bybit: listet AERO/USDT (Spot).
    { id: "AEROUSDT_BY", label: "AERO/USDT (Bybit)", type: "bybit", bybitSymbol: "AEROUSDT" },
  ],

  TIMEFRAMES: [
    { id: "15m", label: "15m", binanceInterval: "15m", krakenInterval: "15",    coinbaseInterval: 900,   bybitInterval: "15"  },
    { id: "1h",  label: "1h",  binanceInterval: "1h",  krakenInterval: "60",    coinbaseInterval: 3600,  bybitInterval: "60"  },
    { id: "4h",  label: "4h",  binanceInterval: "4h",  krakenInterval: "240",   coinbaseInterval: 21600, bybitInterval: "240" },
    { id: "1d",  label: "1D",  binanceInterval: "1d",  krakenInterval: "1440",  coinbaseInterval: 86400, bybitInterval: "D"   },
    { id: "1w",  label: "1W",  binanceInterval: "1w",  krakenInterval: "10080",                          bybitInterval: "W"   },
    { id: "1M",  label: "1M",  binanceInterval: "1M",  krakenInterval: "21600",                          bybitInterval: "M"   },
  ],

  KRAKEN_REST:   "https://api.kraken.com/0/public",
  COINBASE_REST: "https://api.exchange.coinbase.com",
  BYBIT_REST:    "https://api.bybit.com",

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
      key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle", noTags: true,   // Preis-Tags komplett aus (User-Wunsch)
      inputs: [
        { key: "fastPeriod", label: "Fast EMA",         default: 12 },
        { key: "medPeriod",  label: "Medium EMA",       default: 21 },
        { key: "slowPeriod", label: "Main EMA",         default: 35 },
        { key: "atrLength",  label: "ATR Länge",        default: 20 },
        { key: "bandMult",   label: "Band Multiplier",  default: 0.0125, step: 0.001 },
      ],
      plots: [
        { key: "fast",  label: "Fast EMA",   color: "#00c8dc", opacity: 100, width: 1, visible: false },
        { key: "med",   label: "Medium EMA (21)", color: "#00ff88", opacity: 100, width: 2, visible: true },
        { key: "main",  label: "Main EMA",   color: "#ffffff", opacity: 100, width: 3, visible: true },
        { key: "upper", label: "Upper Band", color: "#969696", opacity: 50,  width: 1, visible: true },
        { key: "lower", label: "Lower Band", color: "#969696", opacity: 50,  width: 1, visible: true },
        { key: "fill",  label: "Band-Fill",  color: "#969696", opacity: 10,  width: 1, visible: false, noWidth: true },
      ],
    },
    {
      key: "bmsb", name: "BMSB", pane: "main", label: "Bull Market Support Band",
      inputs: [
        // Eigenes Intervall fuer das Band (20 SMA / 21 EMA). "auto" rechnet auf
        // den Chartkerzen; ein groeberes Intervall aggregiert die Kerzen dorthin
        // und rechnet das Band auf DIESEN Schlusskursen — unabhaengig vom
        // Chart-Intervall des Assets.
        { key: "tf", label: "Intervall", type: "select", default: "auto",
          options: [
            { value: "auto", label: "Chart-Intervall" },
            { value: "15m",  label: "15 Minuten" },
            { value: "1h",   label: "1 Stunde" },
            { value: "4h",   label: "4 Stunden" },
            { value: "1d",   label: "1 Tag" },
            { value: "1w",   label: "1 Woche" },
            { value: "1M",   label: "1 Monat" },
          ] },
      ],
      plots: [
        { key: "sma20", label: "20 SMA", color: "#3fb68b", opacity: 100, width: 2, visible: true },
        { key: "ema21", label: "21 EMA (= EMA p1)", color: "#d05e5e", opacity: 100, width: 2, visible: true },
        { key: "fill",  label: "Band-Fill", color: "#3fb68b", opacity: 20,  width: 1, visible: false, noWidth: true },
      ],
    },
    {
      key: "sma", name: "MYSMA", pane: "main", label: "SMA 20 / 50 / 100 / 200",
      inputs: [
        // Eigenes Intervall fuer den Durchschnitt.
        //
        // "auto" rechnet auf den Kerzen des Charts. Waehlt man ein
        // groeberes Intervall, werden die Chartkerzen dorthin aggregiert
        // und der Durchschnitt auf DIESEN Schlusskursen gerechnet — so
        // sieht man z. B. den 200-Wochen-SMA im Tageschart.
        //
        // Nicht dasselbe wie eine umgerechnete Periode: SMA(1400) auf
        // Tagesbasis mittelt 1400 Tagesschluesse, SMA(200) auf Wochenbasis
        // mittelt 200 Wochenschluesse. Aehnlich, aber nicht gleich.
        { key: "tf", label: "Intervall", type: "select", default: "auto",
          options: [
            { value: "auto", label: "Chart-Intervall" },
            { value: "15m",  label: "15 Minuten" },
            { value: "1h",   label: "1 Stunde" },
            { value: "4h",   label: "4 Stunden" },
            { value: "1d",   label: "1 Tag" },
            { value: "1w",   label: "1 Woche" },
            { value: "1M",   label: "1 Monat" },
          ] },
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
        // Eigenes Intervall fuer den Durchschnitt.
        //
        // "auto" rechnet auf den Kerzen des Charts. Waehlt man ein
        // groeberes Intervall, werden die Chartkerzen dorthin aggregiert
        // und der Durchschnitt auf DIESEN Schlusskursen gerechnet — so
        // sieht man z. B. den 200-Wochen-SMA im Tageschart.
        //
        // Nicht dasselbe wie eine umgerechnete Periode: SMA(1400) auf
        // Tagesbasis mittelt 1400 Tagesschluesse, SMA(200) auf Wochenbasis
        // mittelt 200 Wochenschluesse. Aehnlich, aber nicht gleich.
        { key: "tf", label: "Intervall", type: "select", default: "auto",
          options: [
            { value: "auto", label: "Chart-Intervall" },
            { value: "15m",  label: "15 Minuten" },
            { value: "1h",   label: "1 Stunde" },
            { value: "4h",   label: "4 Stunden" },
            { value: "1d",   label: "1 Tag" },
            { value: "1w",   label: "1 Woche" },
            { value: "1M",   label: "1 Monat" },
          ] },
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
      key: "boll", name: "BOLL", pane: "main", label: "Bollinger Band",
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
        { key: "line",    label: "RSI-Linie",   color: "#a98fdb", opacity: 100, width: 2, visible: true },
        { key: "band70",  label: "Linie 70",    color: "#9aa3b0", opacity: 70,  width: 1, visible: true },
        { key: "band50",  label: "Linie 50",    color: "#9aa3b0", opacity: 40,  width: 1, visible: true },
        { key: "band30",  label: "Linie 30",    color: "#9aa3b0", opacity: 70,  width: 1, visible: true },
        { key: "bgFill",  label: "Fill 30–70",  color: "#a98fdb", opacity: 8,   width: 1, visible: true, noWidth: true },
        { key: "obFill",  label: "Overbought",  color: "#3fb68b", opacity: 25,  width: 1, visible: true, noWidth: true },
        { key: "osFill",  label: "Oversold",    color: "#d05e5e", opacity: 25,  width: 1, visible: true, noWidth: true },
        { key: "maLine",  label: "RSI-MA",      color: "#e8b64c", opacity: 100, width: 1, visible: true },
        { key: "bbUpper", label: "BB Oben",     color: "#3fb68b", opacity: 80,  width: 1, visible: true },
        { key: "bbLower", label: "BB Unten",    color: "#3fb68b", opacity: 80,  width: 1, visible: true },
      ],
    },
    {
      // Globale M2-Geldmenge. Eigenes Fenster unterhalb, wie StochRSI.
      // Die Zeitreihe kommt ueber den Worker (CONFIG.M2_ENDPOINT), nicht
      // aus den Kerzen — siehe indicators.js.
      key: "globalm2", name: "GLOBALM2", pane: "sub", label: "Global M2",
      inputs: [],
      plots: [
        { key: "m2", label: "M2", color: "#e8b64c", opacity: 100, width: 2, visible: true },
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
        { key: "k", label: "K", color: "#5a8dff", opacity: 100, width: 2, visible: true },
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
        { key: "macd",   label: "MACD-Linie",   color: "#5a8dff", opacity: 100, width: 2, visible: true },
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
        { key: "atr", label: "ATR-Linie", color: "#e05555", opacity: 100, width: 2, visible: true },
      ],
    },
    {
      // Bollinger Band Width: relative Bandbreite (oberes−unteres)/Basis,
      // eigenes Fenster unterhalb. Squeeze = die Bandbreite ist das Minimum
      // ueber das Vergleichsfenster (Volatilitaets-Kompression). Rechenweg
      // in indicators.js.
      key: "bbw", name: "BBW", pane: "sub", label: "Bollinger Band Width",
      inputs: [
        { key: "length",  label: "Länge",           default: 20 },
        { key: "mult",    label: "StdDev",          default: 2.0, step: 0.1 },
        { key: "compLen", label: "Squeeze-Fenster", default: 125 },
      ],
      plots: [
        { key: "bbw", label: "Bandbreite",         color: "#138484", opacity: 100, width: 2, visible: true },
        { key: "sq",  label: "Squeeze-Markierung", color: "#c026d3", opacity: 40, width: 1, visible: true, noWidth: true },
      ],
    },
  ],

  // Erstbesuch (kein gespeicherter Workspace): bewusst KEINE Indikatoren
  // vorausgewaehlt — der Chart startet leer. Rueckkehrer behalten ihre
  // gespeicherte Auswahl (state.active liest _ws.active, das auch als
  // leeres Array truthy bleibt und diese Vorgabe nicht ueberschreibt).
  DEFAULT_ACTIVE: [],

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

// HINWEIS zur Preis-Beschriftung an der Achse:
// KLineCharts rendert sie mit dem Linien-Hintergrund, aber EINER globalen
// Textfarbe — siehe app.js applyTheme(). Die Textfarbe pro Indikator zu
// setzen ist konstruktionsbedingt unmöglich (der Renderer liest nur
// chartStore.getStyles().indicator.lastValueMark.text und überschreibt
// gezielt nur backgroundColor).
// Deshalb gilt umgekehrt: JEDE Linienfarbe hier muss gegen den dunklen
// Text #0d1117 mindestens Kontrast 4.5 haben. Vor dem Hinzufügen prüfen.
//
// Relative Luminanz nach WCAG. Grundlage für die Frage: dunkler oder
// heller Text auf diesem Hintergrund?
function luminance(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return 0.5;
  const ch = (i) => {
    const c = parseInt(h.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

// Lesbare Textfarbe für einen farbigen Hintergrund. KLineCharts färbt den
// Balken der Preis-Beschriftung automatisch in der Linienfarbe und lässt
// den Text per Default weiss — bei hellen Linien (Money Noodles Hauptlinie
// ist #ffffff) ist das unlesbar.
function textOn(bgHex) {
  return luminance(bgHex) > 0.42 ? "#0d1117" : "#ffffff";
}

// Kontrastverhältnis zweier Farben nach WCAG (1 = identisch, 21 = max).
function contrastRatio(hexA, hexB) {
  const a = luminance(hexA), b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Für einen Indikator mit mehreren Linien: KLineCharts erlaubt nur EINE
// Textfarbe je Indikator, der Balken übernimmt aber je Linie deren Farbe.
//
// Die Mehrheit zu fragen ("sind die meisten Linien hell?") ist das falsche
// Kriterium: setzt man bei vier Linien nur EINE auf Weiss, ist die Mehrheit
// dunkel, die Wahl fällt auf weissen Text — und genau die weisse Linie wird
// unlesbar. Ein unlesbares Label ist schlimmer als vier mittelmässige.
//
// Deshalb: die Farbe wählen, deren SCHLECHTESTER Kontrast über alle Linien
// am höchsten ist. Minimax statt Mehrheit.
function textForLines(colors) {
  if (!colors || !colors.length) return "#ffffff";
  let best = "#ffffff", bestWorst = -1;
  for (const cand of ["#0d1117", "#ffffff"]) {
    const worst = Math.min(...colors.map(c => contrastRatio(c, cand)));
    if (worst > bestWorst) { bestWorst = worst; best = cand; }
  }
  return best;
}
