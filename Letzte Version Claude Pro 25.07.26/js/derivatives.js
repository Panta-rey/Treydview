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

const Derivatives = (function () {
  "use strict";

  const FAPI = "https://fapi.binance.com";
  const FNG  = "https://api.alternative.me/fng";

  const CACHE_MS = 5 * 60 * 1000;   // 5 Minuten
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
  // Binance zahlt alle 8 Stunden -> 3 Zahlungen/Tag, ~90/Monat.
  // Das Cockpit rechnet: täglich = 8h × 3, monatlich = 8h × 90.
  async function fetchFunding(symbol) {
    return cached("funding:" + symbol, async () => {
      // 270 Einträge ≈ 90 Tage à 3 Zahlungen
      const res = await fetch(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=270`);
      if (!res.ok) throw new Error(`Funding HTTP ${res.status}`);
      const raw = await res.json();
      const rates = raw.map(r => parseFloat(r.fundingRate) * 100);   // in %
      const now = rates.at(-1);
      const last30d = rates.slice(-90);    // 30 Tage × 3
      const last90d = rates;
      return {
        fundingNow:     now,
        fundingDaily:   now * 3,
        fundingMonthly: now * 90,
        fundingAvg30:   mean(last30d) * 90,   // auf Monat hochgerechnet
        fundingAvg90:   mean(last90d) * 90,
        history: raw.map(r => ({ t: r.fundingTime, rate: parseFloat(r.fundingRate) * 100 })),
      };
    });
  }

  // ---------- Open Interest ----------
  async function fetchOpenInterest(symbol) {
    return cached("oi:" + symbol, async () => {
      const res = await fetch(`${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=90`);
      if (!res.ok) throw new Error(`OI HTTP ${res.status}`);
      const raw = await res.json();
      if (!raw.length) throw new Error("OI leer");
      const series = raw.map(r => ({
        t: r.timestamp,
        oi: parseFloat(r.sumOpenInterest),          // in BTC
        oiValue: parseFloat(r.sumOpenInterestValue) // in USDT
      }));
      const cur  = series.at(-1).oi;
      const d30  = series.length >= 30 ? series.at(-30).oi : series[0].oi;
      const d90  = series[0].oi;
      return {
        oiNow: cur,
        oiChange30: ((cur - d30) / d30) * 100,
        oiChange90: ((cur - d90) / d90) * 100,
        history: series,
      };
    });
  }

  // ---------- Long/Short Account Ratio ----------
  // Anteil der Konten mit Long-Position. 0.61 = 61% der Konten long.
  // Das Cockpit nutzt Schwellen 0.45 / 0.55.
  async function fetchLongShort(symbol) {
    return cached("ls:" + symbol, async () => {
      const res = await fetch(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1d&limit=30`);
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
      const res = await fetch(`${FNG}/?limit=90`);
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
  async function fetchAll(symbol = "BTCUSDT") {
    const [f, oi, ls, fng] = await Promise.allSettled([
      fetchFunding(symbol),
      fetchOpenInterest(symbol),
      fetchLongShort(symbol),
      fetchFearGreed(),
    ]);
    const val = (r) => r.status === "fulfilled" ? r.value : null;
    const err = (r) => r.status === "rejected" ? String(r.reason?.message || r.reason) : null;
    return {
      funding: val(f),
      oi:      val(oi),
      ls:      val(ls),
      fng:     val(fng),
      errors: [err(f), err(oi), err(ls), err(fng)].filter(Boolean),
      fetchedAt: Date.now(),
    };
  }

  function clearCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

  return { fetchFunding, fetchOpenInterest, fetchLongShort, fetchFearGreed, fetchAll, clearCache };
})();

if (typeof window !== "undefined") window.Derivatives = Derivatives;
if (typeof module !== "undefined" && module.exports) module.exports = Derivatives;
