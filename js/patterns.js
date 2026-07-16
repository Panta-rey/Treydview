// ============================================================
// TreydView — Pattern-Erkennung
// Etappe 1: Pivot-Engine + Double Top / Double Bottom
//
// Aufbau in Schichten:
//   1. findPivots()      — ZigZag-Pivots aus OHLC
//   2. detectDoubleTop()  — Muster auf der Pivot-Sequenz
//   3. PatternEngine.scan() — läuft über den sichtbaren Bereich
//
// Bewusst konservativ eingestellt: lieber ein Muster verpassen
// als zehn Fehlalarme zeichnen.
// ============================================================

(function () {
  "use strict";

  // ---------- 1. Pivot-Engine ----------
  // Ein Pivot-Hoch ist eine Kerze, deren High höher ist als das aller
  // Kerzen im Fenster links UND rechts davon. Analog Pivot-Tief.
  //
  // lookback = Fenstergrösse je Seite. Grösser = weniger, aber
  // signifikantere Pivots.
  function findPivots(data, lookback = 5) {
    const pivots = [];
    for (let i = lookback; i < data.length - lookback; i++) {
      const h = data[i].high, l = data[i].low;
      let isHigh = true, isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (data[j].high >= h) isHigh = false;
        if (data[j].low  <= l) isLow  = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) pivots.push({ index: i, price: h, type: "high", timestamp: data[i].timestamp });
      if (isLow)  pivots.push({ index: i, price: l, type: "low",  timestamp: data[i].timestamp });
    }
    return pivots;
  }

  // Alternierende Pivot-Kette: H-L-H-L-…
  // Zwei gleichartige Pivots hintereinander -> der extremere gewinnt.
  // Ohne das entstehen aus Rauschen Fehlmuster.
  function alternate(pivots) {
    const out = [];
    for (const p of pivots) {
      const last = out[out.length - 1];
      if (!last || last.type !== p.type) { out.push(p); continue; }
      const replace = p.type === "high" ? p.price > last.price : p.price < last.price;
      if (replace) out[out.length - 1] = p;
    }
    return out;
  }

  // ---------- 2. Double Top / Double Bottom ----------
  //
  // Struktur Double Top:      P1(H)   P2(L)   P3(H)
  //                            /\      \/      /\
  //   - P1 und P3 auf ähnlicher Höhe (tolerance)
  //   - P2 dazwischen deutlich tiefer (minDepth)
  //   - Neckline = P2. Bestätigung erst bei Bruch darunter.
  //
  // Parameter (Defaults konservativ):
  //   tolerance  — max. Abweichung zwischen den beiden Tops, in % (2.0)
  //   minDepth   — Mindest-Einbruch zwischen den Tops, in % (3.0)
  //   maxSpan    — max. Bars zwischen P1 und P3 (120)
  //   minSpan    — min. Bars zwischen P1 und P3 (10)
  function detectDoubleTop(pivots, data, opts = {}) {
    const { tolerance = 2.0, minDepth = 3.0, maxSpan = 120, minSpan = 10 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 2; i++) {
      const p1 = pivots[i], p2 = pivots[i + 1], p3 = pivots[i + 2];
      if (p1.type !== "high" || p2.type !== "low" || p3.type !== "high") continue;

      const span = p3.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      // Die beiden Tops müssen auf ähnlicher Höhe liegen
      const diffPct = Math.abs(p3.price - p1.price) / p1.price * 100;
      if (diffPct > tolerance) continue;

      // Das Tal dazwischen muss tief genug sein
      const depthPct = (Math.min(p1.price, p3.price) - p2.price) / p2.price * 100;
      if (depthPct < minDepth) continue;

      // Bestätigung: schliesst der Kurs nach P3 unter der Neckline?
      const neckline = p2.price;
      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p3.index + maxSpan);
      for (let k = p3.index + 1; k <= searchEnd; k++) {
        if (data[k].close < neckline) { confirmedAt = k; break; }
      }

      found.push({
        type: "doubleTop",
        label: "Double Top",
        direction: "bearish",
        points: [p1, p2, p3],
        neckline,
        confirmedAt,
        // Kursziel: Höhe des Musters nach unten projiziert
        target: confirmedAt != null ? neckline - (Math.max(p1.price, p3.price) - neckline) : null,
        quality: scoreQuality(diffPct, depthPct, tolerance, minDepth),
      });
    }
    return found;
  }

  function detectDoubleBottom(pivots, data, opts = {}) {
    const { tolerance = 2.0, minDepth = 3.0, maxSpan = 120, minSpan = 10 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 2; i++) {
      const p1 = pivots[i], p2 = pivots[i + 1], p3 = pivots[i + 2];
      if (p1.type !== "low" || p2.type !== "high" || p3.type !== "low") continue;

      const span = p3.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      const diffPct = Math.abs(p3.price - p1.price) / p1.price * 100;
      if (diffPct > tolerance) continue;

      const depthPct = (p2.price - Math.max(p1.price, p3.price)) / p2.price * 100;
      if (depthPct < minDepth) continue;

      const neckline = p2.price;
      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p3.index + maxSpan);
      for (let k = p3.index + 1; k <= searchEnd; k++) {
        if (data[k].close > neckline) { confirmedAt = k; break; }
      }

      found.push({
        type: "doubleBottom",
        label: "Double Bottom",
        direction: "bullish",
        points: [p1, p2, p3],
        neckline,
        confirmedAt,
        target: confirmedAt != null ? neckline + (neckline - Math.min(p1.price, p3.price)) : null,
        quality: scoreQuality(diffPct, depthPct, tolerance, minDepth),
      });
    }
    return found;
  }

  // Qualität 0..1: je symmetrischer die Tops und je tiefer das Tal,
  // desto sauberer das Muster.
  function scoreQuality(diffPct, depthPct, tolerance, minDepth) {
    const symmetry = 1 - Math.min(1, diffPct / tolerance);
    const depth    = Math.min(1, depthPct / (minDepth * 2.5));
    return Math.round((symmetry * 0.6 + depth * 0.4) * 100) / 100;
  }

  // Überlappende Muster ausdünnen: bei Überschneidung gewinnt die
  // höhere Qualität. Sonst zeichnet die Engine drei Varianten
  // desselben Musters übereinander.
  function dedupe(patterns) {
    const sorted = [...patterns].sort((a, b) => b.quality - a.quality);
    const kept = [];
    for (const p of sorted) {
      const from = p.points[0].index, to = p.points[2].index;
      const overlaps = kept.some(k => {
        const kf = k.points[0].index, kt = k.points[2].index;
        return !(to < kf || from > kt);
      });
      if (!overlaps) kept.push(p);
    }
    return kept.sort((a, b) => a.points[0].index - b.points[0].index);
  }

  // ---------- 3. Öffentliche Engine ----------

  // Defaults aus einer Nullmodell-Analyse abgeleitet (20 Läufe à 500 Bars
  // Zufallsrauschen mit BTC-artiger Volatilität):
  //
  //   lookback 4, tol 3.0, depth 2.0  -> 11.3 Fehlalarme / 500 Bars
  //   lookback 5, tol 2.0, depth 3.0  ->  8.3
  //   lookback 7, tol 1.5, depth 5.0  ->  4.5
  //   lookback 9, tol 1.0, depth 7.0  ->  0.5   <- Default
  //
  // Die lockeren Einstellungen finden im reinen Rauschen Muster mit
  // Qualität 1.00. Wer sie benutzt, sieht Struktur wo keine ist.
  const DEFAULTS = {
    lookback:   9,
    tolerance:  1.0,
    minDepth:   7.0,
    maxSpan:    120,
    minSpan:    10,
    minQuality: 0.7,
  };

  const PatternEngine = {
    findPivots,
    alternate,
    detectDoubleTop,
    detectDoubleBottom,
    dedupe,
    DEFAULTS,

    // Scannt einen Datenbereich und liefert gefundene Muster.
    // range: { from, to } — normalerweise der sichtbare Bereich.
    scan(data, range, userOpts = {}) {
      const opts = { ...DEFAULTS, ...userOpts };
      if (!data || data.length < 30) return [];
      const from = Math.max(0, range?.from ?? 0);
      const to   = Math.min(data.length, range?.to ?? data.length);
      const slice = data.slice(from, to);
      if (slice.length < 30) return [];

      const raw = findPivots(slice, opts.lookback);
      const pivots = alternate(raw);

      let found = [];
      if (opts.doubleTop !== false)    found = found.concat(detectDoubleTop(pivots, slice, opts));
      if (opts.doubleBottom !== false) found = found.concat(detectDoubleBottom(pivots, slice, opts));

      found = dedupe(found);
      if (opts.minQuality) found = found.filter(p => p.quality >= opts.minQuality);

      // Indizes auf den vollen Datensatz zurückrechnen
      found.forEach(p => {
        p.points = p.points.map(pt => ({ ...pt, index: pt.index + from }));
        if (p.confirmedAt != null) p.confirmedAt += from;
      });
      return found;
    },
  };

  // Export: Browser (global) und Node (Tests)
  if (typeof window !== "undefined") window.PatternEngine = PatternEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = PatternEngine;
})();
