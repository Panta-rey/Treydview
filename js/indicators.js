// ============================================================
// TreydView v0.3 — Custom-Indikatoren
// MNOODLE, BMSB (fix), HULL, RVWAP, GC, VRVP
// ============================================================
(function () {
"use strict";

// ---------- Mathe-Helfer ----------
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema = null, n = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (ema === null) {
      n++;
      if (n === 1) ema = values[i];
      else ema = values[i] * k + ema * (1 - k);
      if (n >= period) out[i] = ema;
    } else {
      ema = values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
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
  return emaSeries(tr, period); // Wilder: EMA mit period=atrLen
}

// ---------- MONEY NOODLE ----------
klinecharts.registerIndicator({
  name: "MNOODLE",
  shortName: "MNoodle",
  precision: 2,
  calcParams: [12, 21, 35, 20, 0.0125],
  figures: [
    { key: "med",   title: "EMA Med: ",  type: "line", styles: () => ({ color: "#00ff88", size: 2 }) },
    { key: "main",  title: "EMA Main: ", type: "line", styles: () => ({ color: "#ffffff", size: 3 }) },
    { key: "upper", title: "Upper: ",    type: "line", styles: () => ({ color: "rgba(150,150,150,0.5)", size: 1 }) },
    { key: "lower", title: "Lower: ",    type: "line", styles: () => ({ color: "rgba(150,150,150,0.5)", size: 1 }) },
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
        med:   emaM[i] ?? undefined,
        main:  s,
        upper: s + offset,
        lower: s - offset,
      };
    });
  },
});

// ---------- BULL MARKET SUPPORT BAND (Chart-TF, Close) ----------
klinecharts.registerIndicator({
  name: "BMSB",
  shortName: "BMSB",
  precision: 2,
  calcParams: [20, 21],
  figures: [
    { key: "sma20", title: "20 SMA: ", type: "line", styles: () => ({ color: "#3fb68b", size: 2 }) },
    { key: "ema21", title: "21 EMA: ", type: "line", styles: () => ({ color: "#d05e5e", size: 2 }) },
  ],
  calc: (dataList, indicator) => {
    const [smaPeriod, emaPeriod] = indicator.calcParams;
    const closes = dataList.map(d => d.close);
    const emaArr = emaSeries(closes, emaPeriod);
    return dataList.map((_, i) => {
      // SMA20
      let sma = null;
      if (i >= smaPeriod - 1) {
        let s = 0;
        for (let j = i - smaPeriod + 1; j <= i; j++) s += closes[j];
        sma = s / smaPeriod;
      }
      return {
        sma20: sma ?? undefined,
        ema21: emaArr[i] ?? undefined,
      };
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
    styles: (data) => ({ color: data.current?.up ? "#3fb68b" : "#d05e5e", size: 2 }),
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
  figures: [{ key: "rvwap", title: "RVWAP: ", type: "line", styles: () => ({ color: "#e8b64c", size: 2 }) }],
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
    { key: "gcUpper", title: "Upper: ", type: "line", styles: () => ({ color: "rgba(232,182,76,0.55)", size: 1 }) },
    { key: "gcMid",   title: "Mid: ",   type: "line",
      styles: (d) => ({ color: d.current?.gcUp ? "#3fb68b" : "#d05e5e", size: 2 }) },
    { key: "gcLower", title: "Lower: ", type: "line", styles: () => ({ color: "rgba(232,182,76,0.55)", size: 1 }) },
  ],
  calc: (dataList, indicator) => {
    const [period, mult, poles] = indicator.calcParams;
    const beta  = (1 - Math.cos(2 * Math.PI / period)) / (Math.pow(2, 1/poles) - 1);
    const alpha = -beta + Math.sqrt(beta * beta + 2 * beta);
    const gaussCascade = (src) => {
      let stages = new Array(poles).fill(null);
      return src.map(x => {
        if (x == null) return null;
        let inp = x;
        for (let p = 0; p < poles; p++) {
          stages[p] = stages[p] === null ? inp : alpha * inp + (1 - alpha) * stages[p];
          inp = stages[p];
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
    const mid  = gaussCascade(hlc3);
    const band = gaussCascade(tr);
    const wu   = Math.min(period, dataList.length);
    return dataList.map((_, i) => {
      if (i < wu || mid[i] == null || band[i] == null) return {};
      return {
        gcMid:   mid[i],
        gcUpper: mid[i] + band[i] * mult,
        gcLower: mid[i] - band[i] * mult,
        gcUp: i > 0 && mid[i-1] != null ? mid[i] > mid[i-1] : true,
      };
    });
  },
});

// ---------- VRVP (Volume-at-Price Histogramm als Overlay) ----------
// KLineCharts hat kein natives VRVP — wir implementieren es als
// custom Indicator mit type="bar" auf der Preisachse (rechts).
// Die Bars werden als horizontale Rechtecke via createPointFigures
// gerendert. Wir nutzen den "figure"-Trick: ein einzelner
// unsichtbarer Datenpunkt, der in attrs die Box-Daten trägt.
klinecharts.registerIndicator({
  name: "VRVP",
  shortName: "VRVP",
  precision: 0,
  shouldOhlc: false,
  calcParams: [500, 70, 15], // rows, valueAreaPct, widthPct
  figures: [],  // Keine Standard-Figures — Rendering via createTooltipDataSource
  calc: (dataList, indicator) => {
    const [rows, vaPct] = indicator.calcParams;
    if (dataList.length < 2) return dataList.map(() => ({}));

    const prices = dataList.flatMap(d => [d.high, d.low]);
    const pMin = Math.min(...prices), pMax = Math.max(...prices);
    const rowH = (pMax - pMin) / rows;
    if (rowH === 0) return dataList.map(() => ({}));

    // Volumen pro Row akkumulieren
    const upVol   = new Float64Array(rows);
    const downVol = new Float64Array(rows);

    for (const d of dataList) {
      const vol = d.volume || 0;
      const isUp = d.close >= d.open;
      // Preis-Range der Candle über die betroffenen Rows verteilen
      const rLow  = Math.max(0, Math.floor((d.low  - pMin) / rowH));
      const rHigh = Math.min(rows - 1, Math.floor((d.high - pMin) / rowH));
      const n = rHigh - rLow + 1;
      for (let r = rLow; r <= rHigh; r++) {
        if (isUp) upVol[r]   += vol / n;
        else      downVol[r] += vol / n;
      }
    }

    // POC = Row mit höchstem Gesamtvolumen
    const totalVol = upVol.map((u, i) => u + downVol[i]);
    const pocRow = totalVol.indexOf(Math.max(...totalVol));
    const pocPrice = pMin + (pocRow + 0.5) * rowH;

    // Value Area: 70% des Gesamtvolumens um POC
    const totalAll = totalVol.reduce((s, v) => s + v, 0);
    const vaTarget = totalAll * (vaPct / 100);
    let vaVol = totalVol[pocRow], vaLow = pocRow, vaHigh = pocRow;
    while (vaVol < vaTarget && (vaLow > 0 || vaHigh < rows - 1)) {
      const addHigh = vaHigh < rows - 1 ? totalVol[vaHigh + 1] : 0;
      const addLow  = vaLow  > 0        ? totalVol[vaLow  - 1] : 0;
      if (addHigh >= addLow) { vaHigh++; vaVol += addHigh; }
      else                   { vaLow--;  vaVol += addLow;  }
    }
    const vahPrice = pMin + (vaHigh + 1) * rowH;
    const valPrice = pMin + vaLow * rowH;
    const maxVol = Math.max(...totalVol.filter(v => v > 0));

    // Metadaten im letzten Bar speichern — app.js liest sie für das Rendering
    const result = dataList.map(() => ({}));
    result[dataList.length - 1].__vrvp = {
      rows, pMin, pMax, rowH, upVol, downVol, totalVol, maxVol,
      pocPrice, vahPrice, valPrice,
    };
    return result;
  },
});

})();
