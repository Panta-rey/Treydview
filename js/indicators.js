// ============================================================
// TreydView v0.4 — Custom-Indikatoren
// Darstellung (Farbe/Deckkraft/Stärke/Sichtbarkeit) kommt aus
// indicator.extendData.plots — gesetzt von app.js aus Settings.
// ============================================================
(function () {
"use strict";

// Plot-Style aus extendData holen; unsichtbar → transparent.
// WICHTIG: immer VOLLSTÄNDIGES Style-Objekt zurückgeben (style, color,
// size, smooth, dashedValue). Unvollständige Objekte bringen KLineCharts'
// internen Linien-Merge zum Absturz (coordinates[1] undefined) → Chart friert ein.
function plotStyle(indicator, key, fallbackColor, fallbackWidth) {
  const base = { style: "solid", smooth: false, dashedValue: [2, 2] };
  const p = indicator?.extendData?.plots?.[key];
  if (!p) return { ...base, color: fallbackColor, size: fallbackWidth || 1 };
  if (p.visible === false) return { ...base, color: "rgba(0,0,0,0)", size: fallbackWidth || 1 };
  return { ...base, color: p.color, size: p.width || fallbackWidth || 1 };
}

// ---------- Mathe-Helfer ----------
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema = null, n = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (ema === null) { n++; ema = values[i]; if (n >= period) out[i] = ema; }
    else { ema = values[i] * k + ema * (1 - k); n++; if (n >= period) out[i] = ema; }
  }
  return out;
}

function wmaAt(values, period, i) {
  if (i < period - 1) return null;
  let num = 0, den = 0;
  for (let j = 0; j < period; j++) {
    const w = period - j, v = values[i - j];
    if (v == null) return null;
    num += v * w; den += w;
  }
  return num / den;
}

function atrSeries(dataList, period) {
  const tr = dataList.map((d, i) => {
    if (i === 0) return d.high - d.low;
    const pc = dataList[i - 1].close;
    return Math.max(d.high - d.low, Math.abs(d.high - pc), Math.abs(d.low - pc));
  });
  return emaSeries(tr, period);
}

// ---------- MONEY NOODLE ----------
klinecharts.registerIndicator({
  name: "MNOODLE",
  shortName: "MNoodle",
  precision: 2,
  calcParams: [12, 21, 35, 20, 0.0125],
  figures: [
    { key: "fast",  title: "Fast: ",  type: "line", styles: (d, ind) => plotStyle(ind, "fast",  "#00c8dc", 1) },
    { key: "med",   title: "Med: ",   type: "line", styles: (d, ind) => plotStyle(ind, "med",   "#00ff88", 2) },
    { key: "main",  title: "Main: ",  type: "line", styles: (d, ind) => plotStyle(ind, "main",  "#ffffff", 3) },
    { key: "upper", title: "Upper: ", type: "line", styles: (d, ind) => plotStyle(ind, "upper", "rgba(150,150,150,0.5)", 1) },
    { key: "lower", title: "Lower: ", type: "line", styles: (d, ind) => plotStyle(ind, "lower", "rgba(150,150,150,0.5)", 1) },
  ],
  calc: (dataList, indicator) => {
    const [fp, mp, sp, atrLen, mult] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const emaF = emaSeries(closes, fp);
    const emaM = emaSeries(closes, mp);
    const emaS = emaSeries(closes, sp);
    const atr  = atrSeries(dataList, atrLen);
    return dataList.map((_, i) => {
      const s = emaS[i], a = atr[i];
      if (s == null || a == null) return {};
      const offset = a * mult * 40;
      return {
        fast: emaF[i] ?? undefined,
        med:  emaM[i] ?? undefined,
        main: s, upper: s + offset, lower: s - offset,
      };
    });
  },
});

// ---------- BULL MARKET SUPPORT BAND ----------
klinecharts.registerIndicator({
  name: "BMSB",
  shortName: "BMSB",
  precision: 2,
  calcParams: [20, 21],
  figures: [
    { key: "sma20", title: "20 SMA: ", type: "line", styles: (d, ind) => plotStyle(ind, "sma20", "#3fb68b", 2) },
    { key: "ema21", title: "21 EMA: ", type: "line", styles: (d, ind) => plotStyle(ind, "ema21", "#d05e5e", 2) },
  ],
  calc: (dataList, indicator) => {
    const [smaP, emaP] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const emaArr = emaSeries(closes, emaP);
    return dataList.map((_, i) => {
      let sma = null;
      if (i >= smaP - 1) {
        let s = 0;
        for (let j = i - smaP + 1; j <= i; j++) s += closes[j];
        sma = s / smaP;
      }
      return { sma20: sma ?? undefined, ema21: emaArr[i] ?? undefined };
    });
  },
});

// ---------- HULL SUITE ----------
klinecharts.registerIndicator({
  name: "HULL",
  shortName: "Hull",
  precision: 2,
  calcParams: [55],
  figures: [{
    key: "hull", title: "Hull: ", type: "line",
    styles: (d, ind) => {
      const key = d.current?.up ? "up" : "down";
      return plotStyle(ind, key, d.current?.up ? "#3fb68b" : "#d05e5e", 2);
    },
  }],
  calc: (dataList, indicator) => {
    const n = indicator.calcParams[0];
    const half = Math.round(n / 2), sq = Math.round(Math.sqrt(n));
    const closes = dataList.map(d => d.close);
    const diff = closes.map((_, i) => {
      const wH = wmaAt(closes, half, i), wF = wmaAt(closes, n, i);
      return (wH != null && wF != null) ? 2 * wH - wF : null;
    });
    const hull = diff.map((_, i) => wmaAt(diff, sq, i));
    return dataList.map((_, i) => ({
      hull: hull[i] ?? undefined,
      up: hull[i] != null && hull[i - 2] != null ? hull[i] > hull[i - 2] : true,
    }));
  },
});

// ---------- ROLLING VWAP ----------
klinecharts.registerIndicator({
  name: "RVWAP",
  shortName: "RVWAP",
  precision: 2,
  calcParams: [365],
  figures: [{ key: "rvwap", title: "RVWAP: ", type: "line", styles: (d, ind) => plotStyle(ind, "line", "#e8b64c", 2) }],
  calc: (dataList, indicator) => {
    const days = indicator.calcParams[0];
    if (dataList.length < 2) return dataList.map(() => ({}));
    const deltas = [];
    for (let i = 1; i < Math.min(dataList.length, 50); i++)
      deltas.push(dataList[i].timestamp - dataList[i-1].timestamp);
    deltas.sort((a, b) => a - b);
    const barMs = deltas[Math.floor(deltas.length / 2)];
    const win = Math.max(1, Math.round(days * 86400000 / barMs));
    const pv = dataList.map(d => ((d.high + d.low + d.close) / 3) * (d.volume || 0));
    const v  = dataList.map(d => d.volume || 0);
    let sPV = 0, sV = 0;
    return dataList.map((_, i) => {
      sPV += pv[i]; sV += v[i];
      if (i >= win) { sPV -= pv[i - win]; sV -= v[i - win]; }
      if (i < win - 1 || sV === 0) return {};
      return { rvwap: sPV / sV };
    });
  },
});

// ---------- GAUSSIAN CHANNEL ----------
klinecharts.registerIndicator({
  name: "GC",
  shortName: "Gauss",
  precision: 2,
  calcParams: [144, 1.414, 4],
  figures: [
    { key: "gcUpper", title: "Upper: ", type: "line", styles: (d, ind) => plotStyle(ind, "upper", "rgba(232,182,76,0.55)", 1) },
    { key: "gcMid",   title: "Mid: ",   type: "line",
      styles: (d, ind) => {
        const key = d.current?.gcUp ? "midUp" : "midDown";
        return plotStyle(ind, key, d.current?.gcUp ? "#3fb68b" : "#d05e5e", 2);
      } },
    { key: "gcLower", title: "Lower: ", type: "line", styles: (d, ind) => plotStyle(ind, "lower", "rgba(232,182,76,0.55)", 1) },
  ],
  calc: (dataList, indicator) => {
    const [period, mult, poles] = indicator.calcParams;
    const beta  = (1 - Math.cos(2 * Math.PI / period)) / (Math.pow(2, 1/poles) - 1);
    const alpha = -beta + Math.sqrt(beta * beta + 2 * beta);
    const cascade = (src) => {
      let st = new Array(poles).fill(null);
      return src.map(x => {
        if (x == null) return null;
        let inp = x;
        for (let p = 0; p < poles; p++) {
          st[p] = st[p] === null ? inp : alpha * inp + (1 - alpha) * st[p];
          inp = st[p];
        }
        return inp;
      });
    };
    const hlc3 = dataList.map(d => (d.high + d.low + d.close) / 3);
    const tr   = dataList.map((d, i) => {
      if (i === 0) return d.high - d.low;
      const pc = dataList[i-1].close;
      return Math.max(d.high - d.low, Math.abs(d.high - pc), Math.abs(d.low - pc));
    });
    const mid = cascade(hlc3), band = cascade(tr);
    const wu = Math.min(period, dataList.length);
    return dataList.map((_, i) => {
      if (i < wu || mid[i] == null || band[i] == null) return {};
      return {
        gcMid: mid[i],
        gcUpper: mid[i] + band[i] * mult,
        gcLower: mid[i] - band[i] * mult,
        gcUp: i > 0 && mid[i-1] != null ? mid[i] > mid[i-1] : true,
      };
    });
  },
});

// ---------- STOCHASTIC RSI ----------
// Pine-Referenz: rsi -> stoch(rsi) -> SMA(K) -> SMA(D)
klinecharts.registerIndicator({
  name: "STOCHRSI",
  shortName: "StochRSI",
  precision: 2,
  calcParams: [3, 3, 14, 14],
  // 20/50/80-Bänder als horizontale Referenzlinien (gestrichelt)
  figures: [
    { key: "band80", title: "", type: "line", styles: () => ({ style: "dashed", color: "rgba(120,123,134,0.7)", size: 1, smooth: false, dashedValue: [4, 4] }) },
    { key: "band50", title: "", type: "line", styles: () => ({ style: "dashed", color: "rgba(120,123,134,0.35)", size: 1, smooth: false, dashedValue: [4, 4] }) },
    { key: "band20", title: "", type: "line", styles: () => ({ style: "dashed", color: "rgba(120,123,134,0.7)", size: 1, smooth: false, dashedValue: [4, 4] }) },
    { key: "k", title: "K: ", type: "line", styles: (d, ind) => plotStyle(ind, "k", "#2962ff", 2) },
    { key: "d", title: "D: ", type: "line", styles: (d, ind) => plotStyle(ind, "d", "#ff6d00", 2) },
  ],
  // Feste Skala 0-100 mit Referenzlinien bei 20/50/80
  minValue: 0,
  maxValue: 100,
  calc: (dataList, indicator) => {
    const [smoothK, smoothD, lenRSI, lenStoch] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    // 1) RSI
    const rsi = new Array(closes.length).fill(null);
    if (closes.length > lenRSI) {
      let ag = 0, al = 0;
      for (let i = 1; i <= lenRSI; i++) {
        const ch = closes[i] - closes[i-1];
        if (ch >= 0) ag += ch; else al -= ch;
      }
      ag /= lenRSI; al /= lenRSI;
      rsi[lenRSI] = al === 0 ? 100 : 100 - 100/(1 + ag/al);
      for (let i = lenRSI+1; i < closes.length; i++) {
        const ch = closes[i] - closes[i-1];
        const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
        ag = (ag*(lenRSI-1) + g)/lenRSI;
        al = (al*(lenRSI-1) + l)/lenRSI;
        rsi[i] = al === 0 ? 100 : 100 - 100/(1 + ag/al);
      }
    }
    // 2) Stochastik auf RSI: (rsi - min) / (max - min) * 100
    const stoch = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (rsi[i] == null || i < lenRSI + lenStoch - 1) continue;
      let mn = Infinity, mx = -Infinity;
      for (let j = i - lenStoch + 1; j <= i; j++) {
        if (rsi[j] == null) { mn = null; break; }
        if (rsi[j] < mn) mn = rsi[j];
        if (rsi[j] > mx) mx = rsi[j];
      }
      if (mn == null) continue;
      stoch[i] = mx === mn ? 0 : ((rsi[i] - mn) / (mx - mn)) * 100;
    }
    // 3) K = SMA(stoch, smoothK), D = SMA(K, smoothD)
    const smaOf = (arr, period, idx) => {
      if (idx < period - 1) return null;
      let s = 0, n = 0;
      for (let j = idx - period + 1; j <= idx; j++) {
        if (arr[j] == null) return null;
        s += arr[j]; n++;
      }
      return n === period ? s / period : null;
    };
    const kArr = stoch.map((_, i) => smaOf(stoch, smoothK, i));
    const dArr = kArr.map((_, i) => smaOf(kArr, smoothD, i));
    return dataList.map((_, i) => ({
      band80: 80, band50: 50, band20: 20,
      k: kArr[i] ?? undefined,
      d: dArr[i] ?? undefined,
    }));
  },
});

})();
