// ============================================================
// TreydView — Derivate- und Sentiment-Daten
//
// Liefert exakt die Felder, die das Excel-Cockpit im Blatt "Daten"
// per Power Query zieht. Alle Endpoints sind öffentlich und senden
// Access-Control-Allow-Origin: * — kein Worker nötig.
//
//   Funding    fapi.binance.com/fapi/v1/fundingRate
//   OI-Historie fapi.binance.com/futures/data/openInterestHist
//   L/S Ratio   fapi.binance.com/futures/data/globalLongShortAccountRatio
//   Fear&Greed  api.alternative.me/fng
//
// Caching: Diese Werte ändern sich stündlich bis täglich, nicht
// sekündlich. Ohne Cache würde jeder Panel-Redraw vier Requests
// auslösen und irgendwann ins Rate Limit laufen.
// ============================================================

/* global tvFetch */
const Derivatives = (function () {
  "use strict";

  const FAPI = "https://fapi.binance.com";
  const FNG  = "https://api.alternative.me/fng";

  const CACHE_MS = 5 * 60 * 1000;   // 5 Minuten

  // Abruf mit Zeitlimit (tvFetch aus data.js); in Node-Tests faellt es auf fetch zurueck.
  const get = (url) => (typeof tvFetch === "function" ? tvFetch(url) : fetch(url));
  const _cache = {};                // { key: { t, data } }

  async function cached(key, fn) {
    const hit = _cache[key];
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
    const data = await fn();
    _cache[key] = { t: Date.now(), data };
    return data;
  }

  function mean(arr) {
    const v = arr.filter(x => x != null && !isNaN(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }

  // ---------- Funding ----------
  // Standard bei Binance: alle 8 Stunden -> 3 Zahlungen/Tag, ~90/Monat.
  // ABER: viele Alt-Perpetuals rechnen alle 4 h ab, und seit 2025-05 stellt
  // Binance jedes Paar auf 1 h um, sobald Cap/Floor erreicht wird
  // (Gesamtpruefung A20). Das Intervall wird deshalb aus den tatsaechlichen
  // Abstaenden der letzten Zahlungen bestimmt, nicht fest angenommen.
  //
  // Rueckgabe-Felder bleiben in "je Zahlung" bzw. hochgerechnet; zusaetzlich
  // perDay = Zahlungen pro Tag. fundingAvg30 bleibt "auf den Monat
  // hochgerechnet", jetzt mit dem echten Takt.
  function paymentsPerDay(raw) {
    const ts = raw.map(r => +r.fundingTime).filter(t => isFinite(t) && t > 0);
    const d = [];
    for (let i = Math.max(1, ts.length - 12); i < ts.length; i++) {
      const x = ts[i] - ts[i - 1];
      if (x > 0) d.push(x);
    }
    if (!d.length) return 3;
    d.sort((a, b) => a - b);
    const hours = Math.round(d[Math.floor(d.length / 2)] / 3600000);
    return [1, 2, 4, 8].includes(hours) ? 24 / hours : 3;
  }

  async function fetchFunding(symbol) {
    return cached("funding:" + symbol, async () => {
      // Bis zu 1000 Eintraege: deckt 90 Tage auch bei 4h-Takt (540) ab.
      const res = await get(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`);
      if (!res.ok) throw new Error(`Funding HTTP ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw) || !raw.length) throw new Error("Funding leer");
      const perDay = paymentsPerDay(raw);
      const rates = raw.map(r => parseFloat(r.fundingRate) * 100);   // in %
      const now = rates.at(-1);
      const last30d = rates.slice(-Math.round(30 * perDay));
      const last90d = rates.slice(-Math.round(90 * perDay));
      return {
        fundingNow:     now,
        perDay,
        intervalHours:  24 / perDay,
        fundingDaily:   now * perDay,
        fundingMonthly: now * perDay * 30,
        fundingAvg30:   mean(last30d) * perDay * 30,   // auf Monat hochgerechnet
        fundingAvg90:   mean(last90d) * perDay * 30,
        history: raw.map(r => ({ t: r.fundingTime, rate: parseFloat(r.fundingRate) * 100 })),
      };
    });
  }

  // ---------- Open Interest ----------
  async function fetchOpenInterest(symbol) {
    return cached("oi:" + symbol, async () => {
      // Binance liefert hier laut Doku nur den letzten Monat (~30 Tageswerte).
      // Eine 90-Tage-Aenderung ist damit NICHT berechenbar (Gesamtpruefung
      // A19) — oiChange90 bleibt deshalb leer statt eine 30-Tage-Zahl
      // unter falschem Namen zu zeigen.
      const res = await get(`${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=30`);
      if (!res.ok) throw new Error(`OI HTTP ${res.status}`);
      const raw = await res.json();
      if (!raw.length) throw new Error("OI leer");
      const series = raw.map(r => ({
        t: r.timestamp,
        oi: parseFloat(r.sumOpenInterest),          // in Basiswaehrung (BTC, ETH …)
        oiValue: parseFloat(r.sumOpenInterestValue) // in USDT
      }));
      const cur  = series.at(-1).oi;
      const d30  = series[0].oi;                       // aeltester verfuegbarer Wert (~30 T)
      const days = Math.round((series.at(-1).t - series[0].t) / 86400000);
      return {
        oiNow: cur,
        oiChange30: d30 ? ((cur - d30) / d30) * 100 : null,
        oiChange90: null,
        oiDays: days,
        history: series,
      };
    });
  }

  // ---------- Long/Short Account Ratio ----------
  // Anteil der Konten mit Long-Position. 0.61 = 61% der Konten long.
  // Das Cockpit nutzt Schwellen 0.45 / 0.55.
  async function fetchLongShort(symbol) {
    return cached("ls:" + symbol, async () => {
      const res = await get(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1d&limit=30`);
      if (!res.ok) throw new Error(`L/S HTTP ${res.status}`);
      const raw = await res.json();
      if (!raw.length) throw new Error("L/S leer");
      // longAccount ist bereits der Anteil (0..1)
      const series = raw.map(r => ({ t: r.timestamp, ratio: parseFloat(r.longAccount) }));
      return { lsRatio: series.at(-1).ratio, history: series };
    });
  }

  // ---------- Fear & Greed ----------
  // Nicht BTC-spezifisch — gilt für den Gesamtmarkt.
  async function fetchFearGreed() {
    return cached("fng", async () => {
      const res = await get(`${FNG}/?limit=90`);
      if (!res.ok) throw new Error(`F&G HTTP ${res.status}`);
      const json = await res.json();
      const arr = (json.data || []).map(d => ({
        t: parseInt(d.timestamp, 10) * 1000,
        value: parseInt(d.value, 10),
        label: d.value_classification,
      }));
      if (!arr.length) throw new Error("F&G leer");
      // alternative.me liefert neueste zuerst
      const now = arr[0];
      return {
        fngNow:   now.value,
        fngLabel: now.label,
        fngAvg30: mean(arr.slice(0, 30).map(x => x.value)),
        fngAvg90: mean(arr.map(x => x.value)),
        history: arr.slice().reverse(),
      };
    });
  }

  // ---------- Alles auf einmal ----------
  // Einzelne Ausfälle dürfen den Rest nicht mitreissen: Promise.allSettled
  // statt all. Fehlende Blöcke werden als null gemeldet, das Panel zeigt
  // dann "–" statt gar nichts.
  // symbol === null: Asset ohne Perpetual (Gold, Indizes) — dann nur
  // Fear & Greed holen, statt drei Anfragen mit "symbol=null" (HTTP 400).
  async function fetchAll(symbol = "BTCUSDT") {
    const none = Promise.reject(new Error("kein Perpetual für dieses Asset"));
    none.catch(() => {});
    const [f, oi, ls, fng] = await Promise.allSettled([
      symbol ? fetchFunding(symbol) : none,
      symbol ? fetchOpenInterest(symbol) : none,
      symbol ? fetchLongShort(symbol) : none,
      fetchFearGreed(),
    ]);
    const val = (r) => r.status === "fulfilled" ? r.value : null;
    const err = (r) => r.status === "rejected" ? String(r.reason?.message || r.reason) : null;
    return {
      funding: val(f),
      oi:      val(oi),
      ls:      val(ls),
      fng:     val(fng),
      errors: symbol
        ? [err(f), err(oi), err(ls), err(fng)].filter(Boolean)
        : [err(fng)].filter(Boolean),
      noPerp: !symbol,
      fetchedAt: Date.now(),
    };
  }

  function clearCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

  return { fetchFunding, fetchOpenInterest, fetchLongShort, fetchFearGreed, fetchAll, clearCache };
})();

if (typeof window !== "undefined") window.Derivatives = Derivatives;
if (typeof module !== "undefined" && module.exports) module.exports = Derivatives;
