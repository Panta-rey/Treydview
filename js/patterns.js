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

  // ---------- Triple Top / Bottom ----------
  //
  // P1(H) P2(L) P3(H) P4(L) P5(H) — drei Tops auf ähnlicher Höhe,
  // zwei Täler dazwischen. Neckline = das höhere der beiden Täler
  // (konservativ: Bruch muss unter BEIDE Täler).
  function detectTripleTop(pivots, data, opts = {}) {
    const { tolerance = 1.0, minDepth = 7.0, maxSpan = 200, minSpan = 20 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 4; i++) {
      const [p1, p2, p3, p4, p5] = pivots.slice(i, i + 5);
      if (p1.type !== "high" || p2.type !== "low" || p3.type !== "high" ||
          p4.type !== "low"  || p5.type !== "high") continue;

      const span = p5.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      // Alle drei Tops auf ähnlicher Höhe
      const tops = [p1.price, p3.price, p5.price];
      const maxTop = Math.max(...tops), minTop = Math.min(...tops);
      const diffPct = (maxTop - minTop) / minTop * 100;
      if (diffPct > tolerance) continue;

      // Beide Täler tief genug
      const neckline = Math.max(p2.price, p4.price);
      const depthPct = (minTop - neckline) / neckline * 100;
      if (depthPct < minDepth) continue;

      // Täler sollten sich ähneln (sonst ist es eher ein anderes Muster)
      const valleyDiff = Math.abs(p4.price - p2.price) / p2.price * 100;
      if (valleyDiff > tolerance * 2.5) continue;

      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p5.index + maxSpan);
      for (let k = p5.index + 1; k <= searchEnd; k++) {
        if (data[k].close < Math.min(p2.price, p4.price)) { confirmedAt = k; break; }
      }

      found.push({
        type: "tripleTop",
        label: "Triple Top",
        direction: "bearish",
        points: [p1, p2, p3, p4, p5],
        neckline,
        confirmedAt,
        target: confirmedAt != null ? neckline - (maxTop - neckline) : null,
        quality: scoreQuality(diffPct, depthPct, tolerance, minDepth),
      });
    }
    return found;
  }

  function detectTripleBottom(pivots, data, opts = {}) {
    const { tolerance = 1.0, minDepth = 7.0, maxSpan = 200, minSpan = 20 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 4; i++) {
      const [p1, p2, p3, p4, p5] = pivots.slice(i, i + 5);
      if (p1.type !== "low"  || p2.type !== "high" || p3.type !== "low" ||
          p4.type !== "high" || p5.type !== "low") continue;

      const span = p5.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      const bottoms = [p1.price, p3.price, p5.price];
      const maxB = Math.max(...bottoms), minB = Math.min(...bottoms);
      const diffPct = (maxB - minB) / minB * 100;
      if (diffPct > tolerance) continue;

      const neckline = Math.min(p2.price, p4.price);
      const depthPct = (neckline - maxB) / maxB * 100;
      if (depthPct < minDepth) continue;

      const peakDiff = Math.abs(p4.price - p2.price) / p2.price * 100;
      if (peakDiff > tolerance * 2.5) continue;

      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p5.index + maxSpan);
      for (let k = p5.index + 1; k <= searchEnd; k++) {
        if (data[k].close > Math.max(p2.price, p4.price)) { confirmedAt = k; break; }
      }

      found.push({
        type: "tripleBottom",
        label: "Triple Bottom",
        direction: "bullish",
        points: [p1, p2, p3, p4, p5],
        neckline,
        confirmedAt,
        target: confirmedAt != null ? neckline + (neckline - minB) : null,
        quality: scoreQuality(diffPct, depthPct, tolerance, minDepth),
      });
    }
    return found;
  }

  // ---------- Head & Shoulders ----------
  //
  // P1(H)=linke Schulter, P2(L), P3(H)=Kopf, P4(L), P5(H)=rechte Schulter
  //   - Kopf höher als beide Schultern (minHeadPct)
  //   - Schultern auf ähnlicher Höhe (shoulderTol)
  //   - Neckline durch P2/P4 (kann schräg sein)
  function detectHeadShoulders(pivots, data, opts = {}) {
    const { shoulderTol = 3.0, minHeadPct = 3.0, maxSpan = 200, minSpan = 20 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 4; i++) {
      const [p1, p2, p3, p4, p5] = pivots.slice(i, i + 5);
      if (p1.type !== "high" || p2.type !== "low" || p3.type !== "high" ||
          p4.type !== "low"  || p5.type !== "high") continue;

      const span = p5.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      // Kopf muss beide Schultern deutlich überragen
      const headOverL = (p3.price - p1.price) / p1.price * 100;
      const headOverR = (p3.price - p5.price) / p5.price * 100;
      if (headOverL < minHeadPct || headOverR < minHeadPct) continue;

      // Schultern ähnlich hoch
      const shoulderDiff = Math.abs(p5.price - p1.price) / p1.price * 100;
      if (shoulderDiff > shoulderTol) continue;

      // Neckline als Gerade durch P2 und P4
      const slope = (p4.price - p2.price) / (p4.index - p2.index);
      const necklineAt = (idx) => p2.price + slope * (idx - p2.index);

      // Neckline darf nicht zu steil sein — sonst ist das Muster verzerrt
      const necklineRise = Math.abs(p4.price - p2.price) / p2.price * 100;
      if (necklineRise > shoulderTol * 2) continue;

      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p5.index + maxSpan);
      for (let k = p5.index + 1; k <= searchEnd; k++) {
        if (data[k].close < necklineAt(k)) { confirmedAt = k; break; }
      }

      const neckAtHead = necklineAt(p3.index);
      const symmetry = 1 - Math.min(1, shoulderDiff / shoulderTol);
      const prominence = Math.min(1, Math.min(headOverL, headOverR) / (minHeadPct * 3));

      found.push({
        type: "headShoulders",
        label: "Head & Shoulders",
        direction: "bearish",
        points: [p1, p2, p3, p4, p5],
        neckline: neckAtHead,
        necklineSlope: slope,
        confirmedAt,
        target: confirmedAt != null ? necklineAt(confirmedAt) - (p3.price - neckAtHead) : null,
        quality: Math.round((symmetry * 0.6 + prominence * 0.4) * 100) / 100,
      });
    }
    return found;
  }

  function detectInverseHeadShoulders(pivots, data, opts = {}) {
    const { shoulderTol = 3.0, minHeadPct = 3.0, maxSpan = 200, minSpan = 20 } = opts;
    const found = [];

    for (let i = 0; i < pivots.length - 4; i++) {
      const [p1, p2, p3, p4, p5] = pivots.slice(i, i + 5);
      if (p1.type !== "low"  || p2.type !== "high" || p3.type !== "low" ||
          p4.type !== "high" || p5.type !== "low") continue;

      const span = p5.index - p1.index;
      if (span < minSpan || span > maxSpan) continue;

      const headUnderL = (p1.price - p3.price) / p1.price * 100;
      const headUnderR = (p5.price - p3.price) / p5.price * 100;
      if (headUnderL < minHeadPct || headUnderR < minHeadPct) continue;

      const shoulderDiff = Math.abs(p5.price - p1.price) / p1.price * 100;
      if (shoulderDiff > shoulderTol) continue;

      const slope = (p4.price - p2.price) / (p4.index - p2.index);
      const necklineAt = (idx) => p2.price + slope * (idx - p2.index);

      const necklineRise = Math.abs(p4.price - p2.price) / p2.price * 100;
      if (necklineRise > shoulderTol * 2) continue;

      let confirmedAt = null;
      const searchEnd = Math.min(data.length - 1, p5.index + maxSpan);
      for (let k = p5.index + 1; k <= searchEnd; k++) {
        if (data[k].close > necklineAt(k)) { confirmedAt = k; break; }
      }

      const neckAtHead = necklineAt(p3.index);
      const symmetry = 1 - Math.min(1, shoulderDiff / shoulderTol);
      const prominence = Math.min(1, Math.min(headUnderL, headUnderR) / (minHeadPct * 3));

      found.push({
        type: "invHeadShoulders",
        label: "Inv. Head & Shoulders",
        direction: "bullish",
        points: [p1, p2, p3, p4, p5],
        neckline: neckAtHead,
        necklineSlope: slope,
        confirmedAt,
        target: confirmedAt != null ? necklineAt(confirmedAt) + (neckAtHead - p3.price) : null,
        quality: Math.round((symmetry * 0.6 + prominence * 0.4) * 100) / 100,
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
    // Komplexere Muster zuerst: ein Head & Shoulders enthält oft ein
    // Double Top. Bei Überlappung soll das aussagekräftigere gewinnen.
    const rank = { headShoulders: 3, invHeadShoulders: 3, tripleTop: 2, tripleBottom: 2, doubleTop: 1, doubleBottom: 1 };
    const sorted = [...patterns].sort((a, b) => {
      const r = (rank[b.type] || 0) - (rank[a.type] || 0);
      return r !== 0 ? r : b.quality - a.quality;
    });
    const kept = [];
    const span = (p) => [p.points[0].index, p.points[p.points.length - 1].index];
    for (const p of sorted) {
      const [from, to] = span(p);
      const overlaps = kept.some(k => {
        const [kf, kt] = span(k);
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
    lookback:    9,
    tolerance:   1.0,    // Double/Triple: max. Abweichung der Tops in %
    minDepth:    7.0,    // Double/Triple: Mindest-Einbruch in %
    shoulderTol: 3.0,    // H&S: max. Abweichung der Schultern in %
    minHeadPct:  3.0,    // H&S: Kopf muss Schultern um X % überragen
    maxSpan:     200,
    minSpan:     10,
    minQuality:  0.7,
  };

  const PatternEngine = {
    findPivots,
    alternate,
    detectDoubleTop,
    detectDoubleBottom,
    detectTripleTop,
    detectTripleBottom,
    detectHeadShoulders,
    detectInverseHeadShoulders,
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
      const on = (k) => opts[k] !== false;
      if (on("doubleTop"))       found = found.concat(detectDoubleTop(pivots, slice, opts));
      if (on("doubleBottom"))    found = found.concat(detectDoubleBottom(pivots, slice, opts));
      if (on("tripleTop"))       found = found.concat(detectTripleTop(pivots, slice, opts));
      if (on("tripleBottom"))    found = found.concat(detectTripleBottom(pivots, slice, opts));
      if (on("headShoulders"))   found = found.concat(detectHeadShoulders(pivots, slice, opts));
      if (on("invHeadShoulders"))found = found.concat(detectInverseHeadShoulders(pivots, slice, opts));

      found = dedupe(found);
      if (opts.minQuality) found = found.filter(p => p.quality >= opts.minQuality);

      // Indizes auf den vollen Datensatz zurückrechnen
      found.forEach(p => {
        p.points = p.points.map(pt => ({ ...pt, index: pt.index + from }));
        if (p.confirmedAt != null) p.confirmedAt += from;
      });
      return found;
    },

    // Misst, was nach jedem bestätigten Muster tatsächlich passierte.
    //
    // Beantwortet die Frage, die der Nullmodell-Test NICHT beantwortet:
    // Ein Muster kann statistisch von Rauschen unterscheidbar und trotzdem
    // nicht handelbar sein. Signifikanz ist nicht Edge.
    //
    // Regel je Muster: Einstieg am Bestätigungs-Bar (Neckline-Bruch),
    // Stop jenseits des letzten Extrempunkts, Ziel = Neckline ∓ Musterhöhe.
    // Ergebnis in R-Vielfachen des Anfangsrisikos.
    backtest(data, userOpts = {}) {
      const found = this.scan(data, { from: 0, to: data.length }, userOpts);
      const done = found.filter(p => p.confirmedAt != null && p.target != null);
      if (done.length === 0) return { n: 0, note: "Keine bestätigten Muster" };

      const rows = [];
      for (const p of done) {
        const entryIdx = p.confirmedAt;
        const entry = data[entryIdx].close;
        const bear = p.direction === "bearish";
        const extremes = p.points.filter((_, i) => i % 2 === 0).map(pt => pt.price);
        const stop = bear ? Math.max(...extremes) : Math.min(...extremes);
        const risk = Math.abs(entry - stop);
        if (risk <= 0) continue;

        const target = p.target;
        let outcome = "offen", exitIdx = null, r = null;
        const horizon = Math.min(data.length - 1, entryIdx + (userOpts.maxSpan || DEFAULTS.maxSpan));

        for (let k = entryIdx + 1; k <= horizon; k++) {
          const hitStop   = bear ? data[k].high >= stop   : data[k].low  <= stop;
          const hitTarget = bear ? data[k].low  <= target : data[k].high >= target;
          // Konservativ: trifft eine Kerze beides, zählt der Stop
          if (hitStop)   { outcome = "Stop"; exitIdx = k; r = -1; break; }
          if (hitTarget) { outcome = "Ziel"; exitIdx = k; r = Math.abs(target - entry) / risk; break; }
        }
        if (outcome === "offen") {
          const last = data[horizon].close;
          r = (bear ? entry - last : last - entry) / risk;
          exitIdx = horizon;
        }
        rows.push({ label: p.label, quality: p.quality, entryIdx, exitIdx, outcome,
                    r: Math.round(r * 100) / 100, bars: exitIdx - entryIdx });
      }
      if (!rows.length) return { n: 0, note: "Keine auswertbaren Muster" };

      const wins = rows.filter(x => x.r > 0).length;
      const sumR = rows.reduce((s, x) => s + x.r, 0);
      const byType = {};
      rows.forEach(x => {
        const t = byType[x.label] = byType[x.label] || { n: 0, wins: 0, sumR: 0 };
        t.n++; if (x.r > 0) t.wins++; t.sumR += x.r;
      });
      Object.values(byType).forEach(t => {
        t.hitRate = Math.round(t.wins / t.n * 100);
        t.avgR = Math.round(t.sumR / t.n * 100) / 100;
      });

      return {
        n: rows.length,
        hitRate: Math.round(wins / rows.length * 100),
        avgR: Math.round(sumR / rows.length * 100) / 100,   // Expectancy in R
        totalR: Math.round(sumR * 100) / 100,
        byType, rows,
      };
    },

    // Vergleich gegen Zufall: dieselbe Auswertung auf block-permutierten
    // Daten. Block-Permutation zerstört die Musterstruktur, behält aber
    // Volatilitäts-Clustering — der faire Vergleichsmassstab.
    // pValue = Anteil der Zufallsläufe, die mindestens so gut waren.
    backtestVsNull(data, userOpts = {}, runs = 20, blockLen = 20) {
      const real = this.backtest(data, userOpts);
      if (!real.n) return { real, note: "Keine bestätigten Muster auf echten Daten" };

      const rets = [];
      for (let i = 1; i < data.length; i++) rets.push(Math.log(data[i].close / data[i - 1].close));

      const nullRuns = [];
      for (let run = 0; run < runs; run++) {
        const shuffled = [];
        while (shuffled.length < rets.length) {
          const start = Math.floor(Math.random() * Math.max(1, rets.length - blockLen));
          shuffled.push(...rets.slice(start, start + blockLen));
        }
        shuffled.length = rets.length;

        let p = data[0].close;
        const synth = [{ ...data[0] }];
        for (let i = 0; i < shuffled.length; i++) {
          const prev = p;
          p *= Math.exp(shuffled[i]);
          synth.push({ timestamp: data[i + 1].timestamp, open: prev,
                       high: Math.max(prev, p) * 1.004, low: Math.min(prev, p) * 0.996,
                       close: p, volume: 1 });
        }
        const r = this.backtest(synth, userOpts);
        if (r.n) nullRuns.push({ hitRate: r.hitRate, avgR: r.avgR, n: r.n });
      }
      if (!nullRuns.length) return { real, note: "Nullmodell erzeugte keine Muster" };

      const avg = (k) => nullRuns.reduce((s, x) => s + x[k], 0) / nullRuns.length;
      const better = nullRuns.filter(x => x.avgR >= real.avgR).length;
      return {
        real,
        nullModel: {
          runs: nullRuns.length,
          avgHitRate: Math.round(avg("hitRate")),
          avgR: Math.round(avg("avgR") * 100) / 100,
          avgCount: Math.round(avg("n")),
        },
        pValue: Math.round(better / nullRuns.length * 1000) / 1000,
      };
    },

    // Wie oft feuert eine Schwelle? Beschreibt die Verteilung, ohne zu
    // optimieren. RSI<=25 an 3% der Tage = echtes Extrem. Bei 18% =
    // Normalbetrieb, und der Filter blockiert grundlos.
    thresholdFrequency(series, threshold, direction = "below") {
      const valid = series.filter(v => v != null && !isNaN(v));
      if (!valid.length) return null;
      const hits = valid.filter(v => direction === "below" ? v <= threshold : v >= threshold).length;
      const sorted = [...valid].sort((a, b) => a - b);
      const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
      return {
        n: valid.length, hits,
        pct: Math.round(hits / valid.length * 1000) / 10,
        quantiles: { p1: q(0.01), p5: q(0.05), p10: q(0.10), p50: q(0.50), p90: q(0.90), p95: q(0.95), p99: q(0.99) },
      };
    },
  };

  // Export: Browser (global) und Node (Tests)
  if (typeof window !== "undefined") window.PatternEngine = PatternEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = PatternEngine;
})();
