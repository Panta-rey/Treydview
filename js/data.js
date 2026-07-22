// ============================================================
// TreydView v0.2 — Datenlayer
// Binance: REST-Historie + WebSocket-Live-Updates
// Gold:    Cloudflare Worker /goldhistory (Daily)
// KLineCharts erwartet Timestamps in MILLISEKUNDEN.
// ============================================================

const DataLayer = {

  // ---------- Binance ----------

  // Binance liefert max. 1000 Kerzen pro Request. Für mehr paginieren wir
  // rückwärts über endTime: neueste zuerst holen, dann ältere nachladen.
  async fetchBinanceKlines(symbol, interval, limit) {
    const MAX_PER_REQ = 1000;
    if (limit <= MAX_PER_REQ) {
      return this._fetchKlineChunk(symbol, interval, MAX_PER_REQ, null);
    }
    const all = [];
    let endTime = null;
    let remaining = limit;
    // Schutz gegen Endlosschleifen bei API-Problemen
    let guard = Math.ceil(limit / MAX_PER_REQ) + 2;
    while (remaining > 0 && guard-- > 0) {
      const take = Math.min(MAX_PER_REQ, remaining);
      const chunk = await this._fetchKlineChunk(symbol, interval, take, endTime);
      if (!chunk.length) break;
      all.unshift(...chunk);
      remaining -= chunk.length;
      // Nächster Request endet 1ms vor der ältesten Kerze dieses Chunks
      endTime = chunk[0].timestamp - 1;
      // Weniger als angefragt = Historie erschöpft
      if (chunk.length < take) break;
    }
    return this._dedupe(all);
  },

  // Ältere Kerzen VOR einem Timestamp nachladen (Lazy Loading beim Zurückscrollen)
  async fetchBinanceKlinesBefore(symbol, interval, beforeTimestamp, limit = 1000) {
    const chunk = await this._fetchKlineChunk(symbol, interval, Math.min(1000, limit), beforeTimestamp - 1);
    return this._dedupe(chunk);
  },

  async _fetchKlineChunk(symbol, interval, limit, endTime) {
    let url = `${CONFIG.BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const raw = await res.json();
    return raw.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  },

  _dedupe(rows) {
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows.filter((r, i) => i === 0 || r.timestamp !== rows[i - 1].timestamp);
  },

  // 24h-Ticker für alle Symbole (Watchlist)
  async fetchTicker24h(symbols) {
    const url = `${CONFIG.BINANCE_REST}/ticker/24hr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const all = await res.json();
    const wanted = new Set(symbols);
    return all
      .filter(t => wanted.has(t.symbol))
      .map(t => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        changePct: parseFloat(t.priceChangePercent),
      }));
  },

  // Live-Stream für ALLE Symbole (Watchlist) — ein Socket für alles
  openMiniTickerStream(onTick, onStatus) {
    // retryTimer MUSS hier deklariert sein: der Cleanup unten liest ihn.
    // Fehlte die Deklaration, warf `if (retryTimer)` beim ersten close()
    // einen ReferenceError — der applyNamedLayout mitten im Ablauf
    // abbrechen liess (Preis blieb beim alten Asset, Zeichnungen fehlten).
    let ws = null, closed = false, retryTimer = null;
    const connect = () => {
      ws = new WebSocket(`${CONFIG.BINANCE_WS}/!miniTicker@arr`);
      ws.onopen = () => onStatus && onStatus("live");
      ws.onmessage = (ev) => {
        try {
          const arr = JSON.parse(ev.data);
          if (!Array.isArray(arr)) return;
          onTick(arr.map(t => ({
            symbol: t.s,
            price: parseFloat(t.c),
            open: parseFloat(t.o),
          })));
        } catch (_) {}
      };
      ws.onclose = () => { if (!closed) retryTimer = setTimeout(() => { if (!closed) connect(); }, 5000); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (ws) ws.close();
    };
  },

  openBinanceStream(symbol, interval, onCandle, onStatus) {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    let ws = null;
    let closed = false;
    let retryTimer = null;   // muss beim Schliessen abgebrochen werden

    const connect = () => {
      ws = new WebSocket(`${CONFIG.BINANCE_WS}/${stream}`);
      ws.onopen = () => onStatus && onStatus("live");
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const k = msg.k;
          if (!k) return;
          onCandle({
            timestamp: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          });
        } catch (_) { /* kaputte Einzelmessage ignorieren */ }
      };
      ws.onclose = () => {
        onStatus && onStatus("offline");
        // closed hier UND im Callback prüfen: zwischen dem Setzen des Timers
        // und seinem Feuern kann der Stream geschlossen worden sein (z.B.
        // Asset-Wechsel). Sonst verbindet sich das alte Symbol 3 s später
        // klammheimlich neu — beim Wechsel auf Gold tauchte so ein
        // ethusdt-Stream wieder auf.
        if (!closed) retryTimer = setTimeout(() => { if (!closed) connect(); }, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (ws) ws.close();
    };
  },

  // ---------- Kraken ----------
  // Kraken OHLC-Endpoint liefert max. 720 Kerzen pro Request. Für mehr
  // paginieren wir rückwärts via since-Parameter (Unix-Sekunden).
  // API: GET /0/public/OHLC?pair=XBTUSD&interval=1440&since=<unix_s>
  // Antwort: { result: { XBTUSD: [[time,o,h,l,c,vwap,vol,count], ...], last: <unix_s> } }

  async fetchKrakenKlines(pair, intervalMin, limit) {
    const MAX_PER_REQ = 720;
    const all = [];
    // Kraken liefert IMMER die letzten 720 Kerzen wenn kein since angegeben.
    // Für mehr Kerzen: since = ältester Timestamp des letzten Chunks - 1.
    let since = null;
    let guard = Math.ceil(limit / MAX_PER_REQ) + 2;
    while (all.length < limit && guard-- > 0) {
      const chunk = await this._fetchKrakenChunk(pair, intervalMin, since);
      if (!chunk.length) break;
      // Neueste Kerze ist oft unfertig — nur beim letzten Request behalten
      const isFirst = all.length === 0;
      const rows = isFirst ? chunk : chunk.filter(r => r.timestamp < chunk.at(-1).timestamp);
      all.unshift(...rows);
      if (chunk.length < MAX_PER_REQ) break;   // keine weiteren Daten
      since = Math.floor(chunk[0].timestamp / 1000) - 1;
    }
    return this._dedupe(all).slice(-limit);
  },

  async fetchKrakenKlinesBefore(pair, intervalMin, beforeTimestamp, limit = 720) {
    const since = Math.floor(beforeTimestamp / 1000) - Math.ceil(limit * intervalMin * 60);
    const chunk = await this._fetchKrakenChunk(pair, intervalMin, since);
    return this._dedupe(chunk.filter(r => r.timestamp < beforeTimestamp));
  },

  async _fetchKrakenChunk(pair, intervalMin, since) {
    let url = `${CONFIG.KRAKEN_REST}/OHLC?pair=${pair}&interval=${intervalMin}`;
    if (since) url += `&since=${since}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
    const json = await res.json();
    if (json.error && json.error.length) throw new Error(`Kraken: ${json.error[0]}`);
    // Antwort-Key = Paar-Name (manchmal mit X/Z-Prefix normalisiert)
    const resultKey = Object.keys(json.result || {}).find(k => k !== "last");
    if (!resultKey) return [];
    return (json.result[resultKey] || []).map(k => ({
      timestamp: k[0] * 1000,          // Sekunden → Millisekunden
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[6]),
    }));
  },

  // ---------- Gold via Worker ----------
  // Toleranter Parser — Details siehe README. Bei abweichendem
  // Worker-Format NUR normalizeGoldRow() anpassen.

  async fetchGoldHistory() {
    const url = CONFIG.WORKER_BASE_URL.replace(/\/$/, "") + CONFIG.GOLD_ENDPOINT;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Worker HTTP ${res.status}`);
    const text = await res.text();

    let rows;
    try {
      const json = JSON.parse(text);
      rows = Array.isArray(json) ? json
           : Array.isArray(json.data) ? json.data
           : Array.isArray(json.history) ? json.history
           : null;
      if (!rows) throw new Error("Unbekannte JSON-Struktur");
      rows = rows.map(r => this.normalizeGoldRow(r)).filter(Boolean);
    } catch (_) {
      rows = this.parseStooqCsv(text);
    }

    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows.filter((r, i) => i === 0 || r.timestamp !== rows[i - 1].timestamp);
  },

  normalizeGoldRow(r) {
    const dateVal = r.date ?? r.time ?? r.t ?? r.Date;
    const close   = parseFloat(r.close ?? r.c ?? r.Close);
    if (dateVal === undefined || !isFinite(close)) return null;

    let ts;
    if (typeof dateVal === "number") {
      ts = dateVal > 1e12 ? dateVal : dateVal * 1000; // Sekunden -> ms
    } else {
      ts = new Date(dateVal + "T00:00:00Z").getTime();
    }
    if (!isFinite(ts)) return null;

    const open = parseFloat(r.open ?? r.o ?? r.Open ?? close);
    const high = parseFloat(r.high ?? r.h ?? r.High ?? Math.max(open, close));
    const low  = parseFloat(r.low  ?? r.l ?? r.Low  ?? Math.min(open, close));
    const volume = parseFloat(r.volume ?? r.v ?? r.Volume ?? 0);
    return { timestamp: ts, open, high, low, close, volume: isFinite(volume) ? volume : 0 };
  },

  parseStooqCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length < 5 || parts[0].toLowerCase() === "date") continue;
      const row = this.normalizeGoldRow({
        date: parts[0], open: parts[1], high: parts[2],
        low: parts[3], close: parts[4], volume: parts[5],
      });
      if (row) out.push(row);
    }
    return out;
  },
};
