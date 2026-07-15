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


// ---------- Zusätzliche Mathe-Helfer ----------
function rmaSeries(values, period) {
  // Wilder's RMA (EMA mit alpha=1/period)
  const out = new Array(values.length).fill(null);
  let rma = null;
  const alpha = 1 / period;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    rma = rma === null ? values[i] : alpha * values[i] + (1 - alpha) * rma;
    out[i] = rma;
  }
  return out;
}

function wmaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let num = 0, den = 0;
    for (let j = 0; j < period; j++) {
      if (values[i - j] == null) { num = null; break; }
      const w = period - j; num += values[i - j] * w; den += w;
    }
    if (num != null) out[i] = num / den;
  }
  return out;
}

function vwmaSeries(dataList, period) {
  // VWMA: weighted by volume
  const out = new Array(dataList.length).fill(null);
  for (let i = period - 1; i < dataList.length; i++) {
    let sumPV = 0, sumV = 0;
    for (let j = 0; j < period; j++) {
      const d = dataList[i - j];
      if (d == null) { sumPV = null; break; }
      sumPV += d.close * (d.volume || 0);
      sumV  += (d.volume || 0);
    }
    if (sumPV != null && sumV > 0) out[i] = sumPV / sumV;
  }
  return out;
}

function smaSeries(values, period) { return emaSeries(values, period); } // alias für EMA-smoothed (SMMA = RMA in Pine)

function maByType(values, period, type, dataList) {
  switch (type) {
    case "EMA":  return emaSeries(values, period);
    case "SMA":  return smaSeries2(values, period);
    case "SMMA": return rmaSeries(values, period);
    case "WMA":  return wmaSeries(values, period);
    case "VWMA": return dataList ? vwmaSeries(dataList, period) : smaSeries2(values, period);
    case "RMA":  return rmaSeries(values, period);
    default:     return smaSeries2(values, period);
  }
}

function smaSeries2(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < period; j++) { if (values[i-j] == null) { ok = false; break; } s += values[i-j]; }
    if (ok) out[i] = s / period;
  }
  return out;
}

function trSeries(dataList) {
  return dataList.map((d, i) => {
    if (i === 0) return d.high - d.low;
    const pc = dataList[i-1].close;
    return Math.max(d.high - d.low, Math.abs(d.high - pc), Math.abs(d.low - pc));
  });
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
    const plots = indicator?.extendData?.plots || {};
    const vis = (key) => !plots[key] || plots[key].visible !== false;
    const closes = dataList.map(d => d.close);
    const emaF = emaSeries(closes, fp);
    const emaM = emaSeries(closes, mp);
    const emaS = emaSeries(closes, sp);
    const atr  = atrSeries(dataList, atrLen);
    return dataList.map((_, i) => {
      const s = emaS[i], a = atr[i];
      if (s == null || a == null) return {};
      const offset = a * mult * 40;
      const out = {};
      // Nur sichtbare Plots ausgeben — unsichtbare NICHT als transparente
      // Linie (das zersplittert KLineCharts' Merge und friert das Chart ein)
      if (vis("fast")  && emaF[i] != null) out.fast  = emaF[i];
      if (vis("med")   && emaM[i] != null) out.med   = emaM[i];
      if (vis("main"))                     out.main  = s;
      if (vis("upper"))                    out.upper = s + offset;
      if (vis("lower"))                    out.lower = s - offset;
      return out;
    });
  },

  draw: ({ ctx, kLineDataList, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const plots = indicator?.extendData?.plots || {};
    const fillPlot = plots.fill;
    if (!fillPlot || fillPlot.visible === false) return false;
    const { from, to } = visibleRange;
    ctx.save();
    for (let i = Math.max(1, from); i < to; i++) {
      const cur = result[i], prev = result[i - 1];
      if (!cur || !prev || cur.upper == null || cur.lower == null) continue;
      const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i);
      ctx.beginPath();
      ctx.moveTo(x0, yAxis.convertToPixel(prev.upper));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.upper));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.lower));
      ctx.lineTo(x0, yAxis.convertToPixel(prev.lower));
      ctx.closePath();
      ctx.fillStyle = fillPlot.color || "rgba(150,150,150,0.1)";
      ctx.fill();
    }
    ctx.restore();
    return false;
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
  draw: ({ ctx, kLineDataList, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const plots = indicator?.extendData?.plots || {};
    const fillPlot = plots.fill;
    if (!fillPlot || fillPlot.visible === false) return false;
    const { from, to } = visibleRange;
    ctx.save();
    for (let i = Math.max(1, from); i < to; i++) {
      const cur = result[i], prev = result[i - 1];
      if (!cur || !prev || cur.sma20 == null || cur.ema21 == null) continue;
      const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i);
      ctx.beginPath();
      ctx.moveTo(x0, yAxis.convertToPixel(prev.sma20));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.sma20));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.ema21));
      ctx.lineTo(x0, yAxis.convertToPixel(prev.ema21));
      ctx.closePath();
      ctx.fillStyle = fillPlot.color || "rgba(63,182,139,0.2)";
      ctx.fill();
    }
    ctx.restore();
    return false;
  },
});

// ---------- HULL SUITE (nach InSilico: MHULL + SHULL[2], Trendfarbe, Band) ----------
klinecharts.registerIndicator({
  name: "HULL",
  shortName: "Hull",
  precision: 2,
  calcParams: ["HMA", 55, 1.0],
  figures: [
    { key: "mhull", title: "MHULL: ", type: "line",
      styles: (d, ind) => {
        const up = d.current?.up;
        const base = { style: "solid", smooth: false, dashedValue: [2, 2] };
        const p = ind?.extendData?.plots?.[up ? "up" : "down"];
        if (!p) return { ...base, color: up ? "#00ff00" : "#ff0000", size: 2 };
        if (p.visible === false) return { ...base, color: "rgba(0,0,0,0)", size: 1 };
        return { ...base, color: p.color, size: p.width || 2 };
      },
    },
    { key: "shull", title: "SHULL: ", type: "line",
      styles: (d, ind) => {
        const up = d.current?.up;
        const base = { style: "solid", smooth: false, dashedValue: [2, 2] };
        const band = ind?.extendData?.plots?.band;
        // SHULL nur zeigen wenn Band aktiviert
        if (band && band.visible === false) return { ...base, color: "rgba(0,0,0,0)", size: 1 };
        const p = ind?.extendData?.plots?.[up ? "up" : "down"];
        if (!p) return { ...base, color: up ? "#00ff00" : "#ff0000", size: 2 };
        if (p.visible === false) return { ...base, color: "rgba(0,0,0,0)", size: 1 };
        return { ...base, color: p.color, size: p.width || 2 };
      },
    },
  ],
  calc: (dataList, indicator) => {
    const [mode, period, lmult] = indicator.calcParams;
    const len = Math.max(2, Math.round(period * (lmult || 1)));
    const closes = dataList.map(d => d.close);

    let hull;
    if (mode === "EHMA") {
      // EHMA(src,len) = ema(2*ema(src,len/2) - ema(src,len), round(sqrt(len)))
      const e1 = emaSeries(closes, Math.round(len / 2));
      const e2 = emaSeries(closes, len);
      const diff = e1.map((v, i) => v != null && e2[i] != null ? 2 * v - e2[i] : null);
      hull = emaSeries(diff, Math.round(Math.sqrt(len)));
    } else if (mode === "THMA") {
      // THMA(src,len/2) = wma(wma(src,len/3)*3 - wma(src,len/2) - wma(src,len), len)
      const l = Math.round(len / 2);
      const w1 = wmaSeries(closes, Math.round(l / 3));
      const w2 = wmaSeries(closes, Math.round(l / 2));
      const w3 = wmaSeries(closes, l);
      const diff = w1.map((v, i) => v != null && w2[i] != null && w3[i] != null ? 3 * v - w2[i] - w3[i] : null);
      hull = wmaSeries(diff, l);
    } else {
      // HMA(src,len) = wma(2*wma(src,len/2) - wma(src,len), round(sqrt(len)))
      const w1 = wmaSeries(closes, Math.round(len / 2));
      const w2 = wmaSeries(closes, len);
      const diff = w1.map((v, i) => v != null && w2[i] != null ? 2 * v - w2[i] : null);
      hull = wmaSeries(diff, Math.round(Math.sqrt(len)));
    }

    // MHULL = HULL[0], SHULL = HULL[2] — Trend: HULL > HULL[2]
    return dataList.map((_, i) => {
      const mh = hull[i];
      const sh = i >= 2 ? hull[i - 2] : null;
      if (mh == null) return {};
      return {
        mhull: mh,
        shull: sh ?? undefined,
        up: sh != null ? mh > sh : true,
      };
    });
  },
  // Band-Fill zwischen MHULL und SHULL in Trendfarbe
  draw: ({ ctx, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const plots = indicator?.extendData?.plots || {};
    const band = plots.band;
    if (!band || band.visible === false) return false;
    const { from, to } = visibleRange;
    ctx.save();
    for (let i = Math.max(1, from); i < to; i++) {
      const cur = result[i], prev = result[i - 1];
      if (!cur || !prev || cur.mhull == null || cur.shull == null || prev.mhull == null || prev.shull == null) continue;
      const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i);
      ctx.beginPath();
      ctx.moveTo(x0, yAxis.convertToPixel(prev.mhull));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.mhull));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.shull));
      ctx.lineTo(x0, yAxis.convertToPixel(prev.shull));
      ctx.closePath();
      // Fill in Trendfarbe mit eingestellter Deckkraft
      const trendPlot = plots[cur.up ? "up" : "down"];
      const baseColor = trendPlot?.hex || (cur.up ? "#00ff00" : "#ff0000");
      const op = band.opacity != null ? band.opacity : 40;
      ctx.fillStyle = hexToRgba(baseColor, op);
      ctx.fill();
    }
    ctx.restore();
    return false;
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

// ---------- GAUSSIAN CHANNEL (gefüllt, trendgefärbt) ----------
// Nach Donovan Wall [DW]: Fill zwischen hband/lband, Farbe grün wenn
// Filter steigt, rot wenn er fällt. Fill via draw-Callback.
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
        return plotStyle(ind, key, d.current?.gcUp ? "#0aff68" : "#ff0a5a", 3);
      } },
    { key: "gcLower", title: "Lower: ", type: "line", styles: (d, ind) => plotStyle(ind, "lower", "rgba(232,182,76,0.55)", 1) },
  ],
  // Kanal-Füllung: eigener draw-Callback, damit die Fläche zwischen
  // Upper/Lower je nach Trendrichtung grün/rot gefüllt wird.
  draw: ({ ctx, kLineDataList, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const { from, to } = visibleRange;
    ctx.save();
    for (let i = Math.max(1, from); i < to; i++) {
      const cur = result[i], prev = result[i - 1];
      if (!cur || !prev) continue;
      if (cur.gcUpper == null || cur.gcLower == null || prev.gcUpper == null || prev.gcLower == null) continue;
      const x0 = xAxis.convertToPixel(i - 1);
      const x1 = xAxis.convertToPixel(i);
      const u0 = yAxis.convertToPixel(prev.gcUpper), u1 = yAxis.convertToPixel(cur.gcUpper);
      const l0 = yAxis.convertToPixel(prev.gcLower), l1 = yAxis.convertToPixel(cur.gcLower);
      // Trapez zwischen den beiden Bar-Positionen füllen
      ctx.beginPath();
      ctx.moveTo(x0, u0);
      ctx.lineTo(x1, u1);
      ctx.lineTo(x1, l1);
      ctx.lineTo(x0, l0);
      ctx.closePath();
      ctx.fillStyle = cur.gcUp ? "rgba(10,255,104,0.12)" : "rgba(255,10,90,0.12)";
      ctx.fill();
    }
    ctx.restore();
    return false; // Standard-Linien weiterhin zeichnen lassen
  },
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

// ---------- MYSMA (4-Level SMA) ----------
klinecharts.registerIndicator({
  name: "MYSMA",
  shortName: "SMA",
  precision: 2,
  calcParams: [20, 50, 100, 200],
  figures: [
    { key: "s1", title: "SMA1: ", type: "line", styles: (d, ind) => plotStyle(ind, "s1", "#e8b64c", 1) },
    { key: "s2", title: "SMA2: ", type: "line", styles: (d, ind) => plotStyle(ind, "s2", "#5aa9e6", 1) },
    { key: "s3", title: "SMA3: ", type: "line", styles: (d, ind) => plotStyle(ind, "s3", "#c792ea", 1) },
    { key: "s4", title: "SMA4: ", type: "line", styles: (d, ind) => plotStyle(ind, "s4", "#3fb68b", 2) },
  ],
  calc: (dataList, indicator) => {
    const [p1, p2, p3, p4] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const s1 = smaSeries2(closes, p1), s2 = smaSeries2(closes, p2);
    const s3 = smaSeries2(closes, p3), s4 = smaSeries2(closes, p4);
    return dataList.map((_, i) => ({
      s1: s1[i] ?? undefined, s2: s2[i] ?? undefined,
      s3: s3[i] ?? undefined, s4: s4[i] ?? undefined,
    }));
  },
});

// ---------- COMPARE (Relative-Performance-Modus) ----------
// Alle Assets (Hauptasset + Vergleiche) als Linien, normalisiert auf den
// linken sichtbaren Rand = 0%. Reaktiv: window.__tvVisibleFrom hält den
// Index des ersten sichtbaren Bars, gesetzt von app.js bei jedem
// onVisibleRangeChange. Referenzpreis = Kurs an diesem Index.
klinecharts.registerIndicator({
  name: "COMPARE",
  shortName: "",
  precision: 2,
  calcParams: [],
  figures: [
    { key: "cMain", title: "", type: "line", styles: (d, ind) => cmpMainStyle(ind) },
    { key: "c0", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 0) },
    { key: "c1", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 1) },
    { key: "c2", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 2) },
    { key: "c3", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 3) },
    { key: "c4", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 4) },
    { key: "c5", title: "", type: "line", styles: (d, ind) => cmpStyle(ind, 5) },
  ],
  calc: (dataList, indicator) => {
    const assets = (typeof window !== "undefined" && window.__tvCompareAssets) ? window.__tvCompareAssets : [];
    if (dataList.length === 0) return dataList.map(() => ({}));

    // fromIdx: KLC übergibt calcParams[0] bei overrideIndicator (gesetzt via
    // onVisibleRangeChange). Fallback auf window.__tvVisibleFrom oder 0.
    const paramFrom = indicator && indicator.calcParams && indicator.calcParams[0];
    let fromIdx = Number.isInteger(paramFrom) ? paramFrom
      : (typeof window !== "undefined" && Number.isInteger(window.__tvVisibleFrom)
          ? window.__tvVisibleFrom : 0);
    fromIdx = Math.max(0, Math.min(fromIdx, dataList.length - 1));

    // Referenzpreis Hauptasset = Close am linken sichtbaren Rand.
    // Falls dort null, nächsten gültigen Wert nach rechts suchen.
    let mainRef = null;
    for (let i = fromIdx; i < dataList.length; i++) {
      if (dataList[i].close != null) { mainRef = dataList[i].close; break; }
    }

    // Vergleichs-Assets: Timestamp->close Maps + Referenzpreis am linken Rand
    const refTs = dataList[fromIdx]?.timestamp;
    const maps = assets.map(a => {
      const m = new Map();
      (a.data || []).forEach(p => m.set(p.timestamp, p.close));
      // Referenz = Kurs am (oder nächstgelegen nach) refTs
      let ref = null;
      for (let i = fromIdx; i < dataList.length; i++) {
        const v = m.get(dataList[i].timestamp);
        if (v != null) { ref = v; break; }
      }
      return { m, ref };
    });

    return dataList.map(d => {
      const out = {};
      // Hauptasset in %
      if (mainRef != null && d.close != null) {
        out.cMain = ((d.close - mainRef) / mainRef) * 100;
      }
      // Vergleiche in %
      maps.forEach((asset, idx) => {
        if (asset.ref == null) return;
        const close = asset.m.get(d.timestamp);
        if (close != null) out["c" + idx] = ((close - asset.ref) / asset.ref) * 100;
      });
      return out;
    });
  },
});

function cmpMainStyle(indicator) {
  // Hauptasset-Linie: weiss, etwas dicker
  return { style: "solid", smooth: false, dashedValue: [2, 2], size: 2, color: "#ffffff" };
}

function cmpStyle(indicator, idx) {
  const assets = (typeof window !== "undefined" && window.__tvCompareAssets) ? window.__tvCompareAssets : [];
  const a = assets[idx];
  const base = { style: "solid", smooth: false, dashedValue: [2, 2], size: 2 };
  if (!a) return { ...base, color: "rgba(0,0,0,0)" };
  return { ...base, color: a.color };
}

// ---------- MYEMA (EMA mit 4 Levels statt 3 — built-in EMA überschrieben) ----------
klinecharts.registerIndicator({
  name: "EMA",
  shortName: "EMA",
  precision: 2,
  calcParams: [21, 50, 100, 200],
  figures: [
    { key: "ema1", title: "EMA1: ", type: "line", styles: (d, ind) => plotStyle(ind, "e1", "#5aa9e6", 1) },
    { key: "ema2", title: "EMA2: ", type: "line", styles: (d, ind) => plotStyle(ind, "e2", "#e8b64c", 1) },
    { key: "ema3", title: "EMA3: ", type: "line", styles: (d, ind) => plotStyle(ind, "e3", "#c792ea", 1) },
    { key: "ema4", title: "EMA4: ", type: "line", styles: (d, ind) => plotStyle(ind, "e4", "#3fb68b", 2) },
  ],
  calc: (dataList, indicator) => {
    const params = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const results = params.map(p => emaSeries(closes, p));
    return dataList.map((_, i) => ({
      ema1: results[0][i] ?? undefined, ema2: results[1][i] ?? undefined,
      ema3: results[2][i] ?? undefined, ema4: results[3] ? (results[3][i] ?? undefined) : undefined,
    }));
  },
});

// ---------- BOLLINGER BANDS (erweitert: MA-Typ, Offset, Fill) ----------
klinecharts.registerIndicator({
  name: "BOLL",
  shortName: "BOLL",
  precision: 2,
  calcParams: [20, 2.0, "SMA", 0],
  figures: [
    { key: "up",  title: "Upper: ", type: "line", styles: (d, ind) => plotStyle(ind, "up",  "rgba(122,143,168,0.6)", 1) },
    { key: "mid", title: "Basis: ", type: "line", styles: (d, ind) => plotStyle(ind, "mid", "rgba(122,143,168,0.8)", 1) },
    { key: "dn",  title: "Lower: ", type: "line", styles: (d, ind) => plotStyle(ind, "dn",  "rgba(122,143,168,0.6)", 1) },
  ],
  calc: (dataList, indicator) => {
    const [period, stddev, maType, offset] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const basis = maByType(closes, period, maType || "SMA", dataList);
    return dataList.map((_, i) => {
      const b = basis[i];
      if (b == null) return {};
      let variance = 0, n = 0;
      for (let j = i - period + 1; j <= i; j++) {
        if (j >= 0 && closes[j] != null) { variance += Math.pow(closes[j] - b, 2); n++; }
      }
      if (n < period) return {};
      const sd = Math.sqrt(variance / n);
      const oi = Math.min(i + (offset || 0), dataList.length - 1);
      if (oi < 0 || oi >= dataList.length) return {};
      return { up: b + stddev * sd, mid: b, dn: b - stddev * sd };
    });
  },
  draw: ({ ctx, kLineDataList, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const plots = indicator?.extendData?.plots || {};
    const fillPlot = plots.fill;
    if (!fillPlot || fillPlot.visible === false) return false;
    const { from, to } = visibleRange;
    ctx.save();
    for (let i = Math.max(1, from); i < to; i++) {
      const cur = result[i], prev = result[i - 1];
      if (!cur || !prev || cur.up == null || cur.dn == null) continue;
      const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i);
      ctx.beginPath();
      ctx.moveTo(x0, yAxis.convertToPixel(prev.up));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.up));
      ctx.lineTo(x1, yAxis.convertToPixel(cur.dn));
      ctx.lineTo(x0, yAxis.convertToPixel(prev.dn));
      ctx.closePath();
      ctx.fillStyle = fillPlot.color || "rgba(122,143,168,0.08)";
      ctx.fill();
    }
    ctx.restore();
    return false;
  },
});

// ---------- MYRSI (nach TV-Source: RMA, Hilfslinien, Fills, Smoothing-MA) ----------
klinecharts.registerIndicator({
  name: "MYRSI",
  shortName: "RSI",
  precision: 2,
  calcParams: [14, "None", 14, 2.0],
  figures: [
    { key: "band70", title: "", type: "line", styles: (d, ind) => plotStyle(ind, "band70", "rgba(120,123,134,0.7)", 1) },
    { key: "band50", title: "", type: "line", styles: (d, ind) => plotStyle(ind, "band50", "rgba(120,123,134,0.4)", 1) },
    { key: "band30", title: "", type: "line", styles: (d, ind) => plotStyle(ind, "band30", "rgba(120,123,134,0.7)", 1) },
    { key: "bbUpper", title: "BB+: ", type: "line", styles: (d, ind) => plotStyle(ind, "bbUpper", "rgba(63,182,139,0.8)", 1) },
    { key: "bbLower", title: "BB-: ", type: "line", styles: (d, ind) => plotStyle(ind, "bbLower", "rgba(63,182,139,0.8)", 1) },
    { key: "maLine", title: "MA: ",  type: "line", styles: (d, ind) => plotStyle(ind, "maLine", "#e8b64c", 1) },
    { key: "line",   title: "RSI: ", type: "line", styles: (d, ind) => plotStyle(ind, "line", "#7e57c2", 2) },
  ],
  calc: (dataList, indicator) => {
    const [period, maType, maLength, bbMult] = indicator.calcParams;
    const plots = indicator?.extendData?.plots || {};
    const vis = (k) => !plots[k] || plots[k].visible !== false;
    const closes = dataList.map(d => d.close);

    // RSI nach Wilder (ta.rma auf up/down changes)
    const changes = closes.map((c, i) => i === 0 ? 0 : c - closes[i-1]);
    const ups   = changes.map(ch => Math.max(ch, 0));
    const downs = changes.map(ch => Math.max(-ch, 0));
    const upRma   = rmaSeries(ups, period);
    const downRma = rmaSeries(downs, period);
    const rsi = closes.map((_, i) => {
      if (i < period || upRma[i] == null || downRma[i] == null) return null;
      if (downRma[i] === 0) return 100;
      if (upRma[i] === 0) return 0;
      return 100 - (100 / (1 + upRma[i] / downRma[i]));
    });

    // Smoothing-MA auf dem RSI
    let maArr = null, bbUp = null, bbLo = null;
    const isBB = maType === "SMA + BB";
    if (maType && maType !== "None") {
      const t = isBB ? "SMA" : maType;
      maArr = maByType(rsi, maLength, t === "SMMA" ? "RMA" : t, dataList);
      if (isBB) {
        // StdDev auf RSI
        bbUp = new Array(rsi.length).fill(null);
        bbLo = new Array(rsi.length).fill(null);
        for (let i = maLength - 1; i < rsi.length; i++) {
          if (maArr[i] == null) continue;
          let variance = 0, n = 0;
          for (let j = i - maLength + 1; j <= i; j++) {
            if (rsi[j] == null) { n = 0; break; }
            variance += Math.pow(rsi[j] - maArr[i], 2); n++;
          }
          if (n === maLength) {
            const sd = Math.sqrt(variance / n) * bbMult;
            bbUp[i] = maArr[i] + sd;
            bbLo[i] = maArr[i] - sd;
          }
        }
      }
    }

    return dataList.map((_, i) => {
      const out = { line: rsi[i] ?? undefined };
      if (vis("band70")) out.band70 = 70;
      if (vis("band50")) out.band50 = 50;
      if (vis("band30")) out.band30 = 30;
      if (maArr && vis("maLine") && maArr[i] != null) out.maLine = maArr[i];
      if (isBB && bbUp && vis("bbUpper") && bbUp[i] != null) out.bbUpper = bbUp[i];
      if (isBB && bbLo && vis("bbLower") && bbLo[i] != null) out.bbLower = bbLo[i];
      return out;
    });
  },
  // Fills: Hintergrund 30-70, Overbought >70 (grün), Oversold <30 (rot)
  draw: ({ ctx, visibleRange, indicator, xAxis, yAxis }) => {
    const result = indicator.result;
    if (!result || result.length === 0) return false;
    const plots = indicator?.extendData?.plots || {};
    const { from, to } = visibleRange;

    // 1. Hintergrund-Fill zwischen 30 und 70
    const bg = plots.bgFill;
    if (bg && bg.visible !== false) {
      const x0 = xAxis.convertToPixel(Math.max(0, from));
      const x1 = xAxis.convertToPixel(to - 1);
      const y70 = yAxis.convertToPixel(70), y30 = yAxis.convertToPixel(30);
      ctx.save();
      ctx.fillStyle = bg.color || "rgba(126,87,194,0.08)";
      ctx.fillRect(x0, Math.min(y70, y30), x1 - x0, Math.abs(y30 - y70));
      ctx.restore();
    }

    // 2. Overbought/Oversold Gradient-Fills
    const drawZoneFill = (plotKey, threshold, above) => {
      const p = plots[plotKey];
      if (!p || p.visible === false) return;
      const yThr = yAxis.convertToPixel(threshold);
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = Math.max(0, from); i < to; i++) {
        const r = result[i];
        if (!r || r.line == null) continue;
        const inZone = above ? r.line > threshold : r.line < threshold;
        const x = xAxis.convertToPixel(i);
        const y = yAxis.convertToPixel(r.line);
        if (inZone) {
          if (!started) { ctx.moveTo(x, yThr); started = true; }
          ctx.lineTo(x, y);
        } else if (started) {
          ctx.lineTo(xAxis.convertToPixel(i - 1), yThr);
          ctx.closePath();
          ctx.fillStyle = p.color || (above ? "rgba(63,182,139,0.25)" : "rgba(208,94,94,0.25)");
          ctx.fill();
          ctx.beginPath();
          started = false;
        }
      }
      if (started) {
        ctx.lineTo(xAxis.convertToPixel(to - 1), yThr);
        ctx.closePath();
        ctx.fillStyle = p.color || (above ? "rgba(63,182,139,0.25)" : "rgba(208,94,94,0.25)");
        ctx.fill();
      }
      ctx.restore();
    };
    drawZoneFill("obFill", 70, true);
    drawZoneFill("osFill", 30, false);

    return false;
  },
});

// ---------- MYVOL (Volumen mit konfigurierbaren MAs) ----------
klinecharts.registerIndicator({
  name: "MYVOL",
  shortName: "VOL",
  precision: 0,
  shouldOhlc: false,
  calcParams: [5, 10, 20],
  figures: [
    { key: "vol",  title: "VOL: ", type: "bar",
      styles: (d, ind) => {
        const isUp = d.current?.isUp;
        const key  = isUp ? "up" : "dn";
        return plotStyle(ind, key, isUp ? "rgba(63,182,139,0.65)" : "rgba(208,94,94,0.65)", 1);
      }
    },
    { key: "ma1", title: "MA1: ", type: "line", styles: (d, ind) => plotStyle(ind, "ma1", "#e8b64c", 1) },
    { key: "ma2", title: "MA2: ", type: "line", styles: (d, ind) => plotStyle(ind, "ma2", "#5aa9e6", 1) },
    { key: "ma3", title: "MA3: ", type: "line", styles: (d, ind) => plotStyle(ind, "ma3", "#c792ea", 1) },
  ],
  calc: (dataList, indicator) => {
    const [p1, p2, p3] = indicator.calcParams;
    const vols = dataList.map(d => d.volume || 0);
    const ma1s = smaSeries2(vols, p1), ma2s = smaSeries2(vols, p2), ma3s = smaSeries2(vols, p3);
    return dataList.map((d, i) => ({
      vol:  d.volume || 0,
      ma1:  ma1s[i] ?? undefined,
      ma2:  ma2s[i] ?? undefined,
      ma3:  ma3s[i] ?? undefined,
      isUp: d.close >= d.open,
    }));
  },
});

// ---------- MACD ----------
klinecharts.registerIndicator({
  name: "MACD",
  shortName: "MACD",
  precision: 2,
  calcParams: [12, 26, 9, "EMA", "EMA"],
  figures: [
    { key: "hist", title: "Hist: ", type: "bar", baseValue: 0,
      styles: (d, ind) => {
        const h = d.current?.hist;
        const hp = d.prev?.hist;
        if (h == null) return { style: "fill", color: "rgba(0,0,0,0)" };
        const plots = ind?.extendData?.plots || {};
        const rising = hp != null ? h > hp : true;
        // 4 Farben wie TradingView:
        // hist>=0 && steigend  -> kräftiges Grün
        // hist>=0 && fallend   -> helles Grün
        // hist<0  && steigend  -> helles Rot
        // hist<0  && fallend   -> kräftiges Rot
        let color;
        if (h >= 0) {
          color = rising ? (plots.histUp?.color || "#26a69a") : "#b2dfdb";
        } else {
          color = rising ? "#ffcdd2" : (plots.histDn?.color || "#ff5252");
        }
        return { style: "fill", color };
      }
    },
    { key: "zero",   title: "", type: "line", styles: () => ({ style: "dashed", color: "rgba(120,123,134,0.5)", size: 1, smooth: false, dashedValue: [4, 4] }) },
    { key: "macd",   title: "MACD: ",   type: "line", styles: (d, ind) => plotStyle(ind, "macd",   "#2962ff", 2) },
    { key: "signal", title: "Signal: ", type: "line", styles: (d, ind) => plotStyle(ind, "signal", "#ff6d00", 2) },
  ],
  calc: (dataList, indicator) => {
    const [fast, slow, sigLen, oscType, sigType] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const maFast = maByType(closes, fast, oscType || "EMA", dataList);
    const maSlow = maByType(closes, slow, oscType || "EMA", dataList);
    const macdLine = maFast.map((v, i) => v != null && maSlow[i] != null ? v - maSlow[i] : null);
    const signalLine = maByType(macdLine, sigLen, sigType || "EMA", dataList);
    const hist = macdLine.map((v, i) => v != null && signalLine[i] != null ? v - signalLine[i] : null);
    return dataList.map((_, i) => ({
      hist:   hist[i]       ?? undefined,
      zero:   hist[i] != null ? 0 : undefined,
      macd:   macdLine[i]   ?? undefined,
      signal: signalLine[i] ?? undefined,
    }));
  },
});

// ---------- ATR ----------
klinecharts.registerIndicator({
  name: "ATR",
  shortName: "ATR",
  precision: 2,
  calcParams: [14, "RMA"],
  figures: [
    { key: "atr", title: "ATR: ", type: "line", styles: (d, ind) => plotStyle(ind, "atr", "#b71c1c", 2) },
  ],
  calc: (dataList, indicator) => {
    const [period, smoothing] = indicator.calcParams;
    const tr = trSeries(dataList);
    const atr = maByType(tr, period, smoothing || "RMA");
    return dataList.map((_, i) => ({ atr: atr[i] ?? undefined }));
  },
});

})();
