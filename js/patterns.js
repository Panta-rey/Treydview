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

  // ============================================================
  // TRENDLINIEN-MUSTER
  //
  // Double/Triple/H&S vergleichen einzelne Pivots miteinander. Dreiecke,
  // Keile und Rechtecke funktionieren anders: sie brauchen eine Gerade
  // durch MEHRERE Hochs und eine durch mehrere Tiefs. Erst deren
  // Verhältnis (konvergent, parallel, divergent) definiert das Muster.
  // ============================================================

  // Lineare Regression über {index, price}. Liefert Steigung, Achsen-
  // abschnitt und R² als Mass für die Güte der Anpassung.
  function fitLine(pts) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of pts) { sx += p.index; sy += p.price; sxy += p.index * p.price; sxx += p.index * p.index; }
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-10) return null;
    const slope = (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;

    // R²: wie gut liegen die Punkte auf der Geraden?
    const mean = sy / n;
    let ssTot = 0, ssRes = 0;
    for (const p of pts) {
      const pred = slope * p.index + intercept;
      ssTot += (p.price - mean) ** 2;
      ssRes += (p.price - pred) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    return { slope, intercept, r2, at: (i) => slope * i + intercept };
  }

  // Steigung in % pro Bar, normiert auf das Preisniveau — sonst wäre
  // dieselbe Steigung bei BTC 60'000 und bei 6'000 nicht vergleichbar.
  function slopePct(line, refPrice, span) {
    if (!line || !refPrice) return 0;
    return (line.slope * span) / refPrice * 100;
  }

  // Sucht in einem Pivot-Fenster nach zwei Trendlinien und klassifiziert
  // sie. Gemeinsame Basis für Dreieck, Keil und Rechteck.
  function analyzeChannel(window, opts) {
    const highs = window.filter(p => p.type === "high");
    const lows  = window.filter(p => p.type === "low");
    if (highs.length < 2 || lows.length < 2) return null;

    const upper = fitLine(highs);
    const lower = fitLine(lows);
    if (!upper || !lower) return null;
    if (upper.r2 < opts.minR2 || lower.r2 < opts.minR2) return null;

    const from = window[0].index, to = window[window.length - 1].index;
    const span = to - from;
    if (span < 1) return null;

    // Die Linien dürfen sich im Musterbereich nicht kreuzen
    const wStart = upper.at(from) - lower.at(from);
    const wEnd   = upper.at(to)   - lower.at(to);
    if (wStart <= 0 || wEnd <= 0) return null;

    const refPrice = (upper.at(to) + lower.at(to)) / 2;
    const convergence = (wStart - wEnd) / wStart;   // >0 = läuft zusammen

    return {
      upper, lower, from, to, span, refPrice,
      widthStart: wStart, widthEnd: wEnd, convergence,
      upperSlope: slopePct(upper, refPrice, span),
      lowerSlope: slopePct(lower, refPrice, span),
      highs, lows,
    };
  }

  // Gemeinsamer Bestätigungs-Check: Bruch durch die obere oder untere
  // Linie, jeweils fortgeschrieben über das Musterende hinaus.
  function findBreakout(data, ch, maxSpan) {
    const end = Math.min(data.length - 1, ch.to + maxSpan);
    for (let k = ch.to + 1; k <= end; k++) {
      if (data[k].close > ch.upper.at(k)) return { at: k, dir: "up" };
      if (data[k].close < ch.lower.at(k)) return { at: k, dir: "down" };
    }
    return null;
  }

  // ---------- Dreiecke ----------
  //
  // Aufsteigend: obere Linie flach, untere steigt   -> Ausbruch meist oben
  // Absteigend:  untere Linie flach, obere fällt    -> Ausbruch meist unten
  // Symmetrisch: beide laufen aufeinander zu
  function detectTriangles(pivots, data, opts) {
    const found = [];
    const { minPivots = 6, maxSpan = 200, minSpan = 20, flatTol = 1.5,
            minConvergence = 0.5, minR2 = 0.9 } = opts;

    for (let i = 0; i + minPivots <= pivots.length; i++) {
      for (let len = minPivots; len <= Math.min(9, pivots.length - i); len++) {
        const win = pivots.slice(i, i + len);
        const span = win[len - 1].index - win[0].index;
        if (span < minSpan || span > maxSpan) continue;

        const ch = analyzeChannel(win, { minR2 });
        if (!ch || ch.convergence < minConvergence) continue;

        const upFlat = Math.abs(ch.upperSlope) < flatTol;
        const loFlat = Math.abs(ch.lowerSlope) < flatTol;

        let type, label, direction;
        if (upFlat && ch.lowerSlope > flatTol) {
          type = "ascTriangle"; label = "Aufsteigendes Dreieck"; direction = "bullish";
        } else if (loFlat && ch.upperSlope < -flatTol) {
          type = "descTriangle"; label = "Absteigendes Dreieck"; direction = "bearish";
        } else if (ch.upperSlope < -flatTol && ch.lowerSlope > flatTol) {
          type = "symTriangle"; label = "Symmetrisches Dreieck"; direction = "neutral";
        } else continue;

        const bo = findBreakout(data, ch, maxSpan);
        // Ziel: Musterhöhe am Anfang, ab Ausbruch projiziert
        const target = bo
          ? (bo.dir === "up" ? ch.upper.at(bo.at) + ch.widthStart : ch.lower.at(bo.at) - ch.widthStart)
          : null;

        found.push({
          type, label, direction,
          points: win, channel: ch,
          confirmedAt: bo ? bo.at : null,
          breakoutDir: bo ? bo.dir : null,
          neckline: bo ? (bo.dir === "up" ? ch.upper.at(bo.at) : ch.lower.at(bo.at)) : null,
          target,
          quality: Math.round(((ch.upper.r2 + ch.lower.r2) / 2 * 0.6 + Math.min(1, ch.convergence) * 0.4) * 100) / 100,
        });
      }
    }
    return found;
  }

  // ---------- Keile ----------
  //
  // Beide Linien zeigen in dieselbe Richtung und konvergieren.
  // Steigender Keil = bärisch, fallender Keil = bullisch. Das ist der
  // wichtigste Unterschied zum Dreieck: die Richtung des Keils sagt
  // das Gegenteil des Ausbruchs voraus.
  function detectWedges(pivots, data, opts) {
    const found = [];
    const { minPivots = 6, maxSpan = 200, minSpan = 20, minSlope = 2.0,
            minConvergence = 0.5, minR2 = 0.9 } = opts;

    for (let i = 0; i + minPivots <= pivots.length; i++) {
      for (let len = minPivots; len <= Math.min(9, pivots.length - i); len++) {
        const win = pivots.slice(i, i + len);
        const span = win[len - 1].index - win[0].index;
        if (span < minSpan || span > maxSpan) continue;

        const ch = analyzeChannel(win, { minR2 });
        if (!ch || ch.convergence < minConvergence) continue;

        const bothUp   = ch.upperSlope >  minSlope && ch.lowerSlope >  minSlope;
        const bothDown = ch.upperSlope < -minSlope && ch.lowerSlope < -minSlope;
        if (!bothUp && !bothDown) continue;

        const type = bothUp ? "risingWedge" : "fallingWedge";
        const label = bothUp ? "Steigender Keil" : "Fallender Keil";
        const direction = bothUp ? "bearish" : "bullish";

        const bo = findBreakout(data, ch, maxSpan);
        const target = bo
          ? (bo.dir === "up" ? ch.upper.at(bo.at) + ch.widthStart : ch.lower.at(bo.at) - ch.widthStart)
          : null;

        found.push({
          type, label, direction,
          points: win, channel: ch,
          confirmedAt: bo ? bo.at : null,
          breakoutDir: bo ? bo.dir : null,
          neckline: bo ? (bo.dir === "up" ? ch.upper.at(bo.at) : ch.lower.at(bo.at)) : null,
          target,
          quality: Math.round(((ch.upper.r2 + ch.lower.r2) / 2 * 0.6 + Math.min(1, ch.convergence) * 0.4) * 100) / 100,
        });
      }
    }
    return found;
  }

  // ---------- Rechteck / Range ----------
  // Beide Linien flach und parallel. Für einen Zyklus-Trader die
  // relevanteste Formation: hier laufen Grid-Bots.
  function detectRectangles(pivots, data, opts) {
    const found = [];
    const { minPivots = 5, maxSpan = 250, minSpan = 25, flatTol = 1.2,
            maxConvergence = 0.2, minR2 = 0.85, minHeightPct = 3 } = opts;

    for (let i = 0; i + minPivots <= pivots.length; i++) {
      for (let len = minPivots; len <= Math.min(10, pivots.length - i); len++) {
        const win = pivots.slice(i, i + len);
        const span = win[len - 1].index - win[0].index;
        if (span < minSpan || span > maxSpan) continue;

        const ch = analyzeChannel(win, { minR2 });
        if (!ch) continue;
        if (Math.abs(ch.upperSlope) > flatTol || Math.abs(ch.lowerSlope) > flatTol) continue;
        if (Math.abs(ch.convergence) > maxConvergence) continue;

        // Range muss hoch genug sein, sonst ist es nur Rauschen
        const heightPct = ch.widthEnd / ch.refPrice * 100;
        if (heightPct < minHeightPct) continue;

        const bo = findBreakout(data, ch, maxSpan);
        const target = bo
          ? (bo.dir === "up" ? ch.upper.at(bo.at) + ch.widthEnd : ch.lower.at(bo.at) - ch.widthEnd)
          : null;

        found.push({
          type: "rectangle", label: "Rechteck / Range", direction: "neutral",
          points: win, channel: ch,
          confirmedAt: bo ? bo.at : null,
          breakoutDir: bo ? bo.dir : null,
          neckline: bo ? (bo.dir === "up" ? ch.upper.at(bo.at) : ch.lower.at(bo.at)) : null,
          target,
          quality: Math.round(((ch.upper.r2 + ch.lower.r2) / 2 * 0.7 + (1 - Math.abs(ch.convergence) / maxConvergence) * 0.3) * 100) / 100,
        });
      }
    }
    return found;
  }

  // ---------- Flaggen und Wimpel ----------
  //
  // Neue Zutat gegenüber allen bisherigen Mustern: Diese brauchen einen
  // KONTEXT vor der Formation — einen scharfen Impuls ("Fahnenmast").
  // Ohne den ist eine Flagge nur ein kleiner Kanal, und kleine Kanäle
  // gibt es in jedem Chart zuhauf. Der Mast ist das, was das Muster
  // selten macht.
  //
  // Flagge: Konsolidierung in einem Kanal GEGEN die Impulsrichtung.
  // Wimpel: Konsolidierung in einem kleinen symmetrischen Dreieck.
  //
  // Beide sind Fortsetzungsmuster — der Ausbruch geht in Impulsrichtung.
  function detectFlags(pivots, data, opts = {}) {
    const {
      minPoleMove = 12,      // Mindest-Impuls in % — der Kern des Musters
      maxPoleBars = 30,      // ein Impuls ist schnell, sonst ist es ein Trend
      minFlagBars = 8,
      maxFlagBars = 60,
      maxFlagRetrace = 0.5,  // Konsolidierung darf max. halben Mast abgeben
      minR2 = 0.85,
      maxSpan = 200,
    } = opts;
    const found = [];

    for (let i = 0; i + 4 <= pivots.length; i++) {
      for (let len = 4; len <= Math.min(7, pivots.length - i); len++) {
        const win = pivots.slice(i, i + len);
        const flagFrom = win[0].index, flagTo = win[len - 1].index;
        const flagBars = flagTo - flagFrom;
        if (flagBars < minFlagBars || flagBars > maxFlagBars) continue;

        // Fahnenmast: scharfe Bewegung unmittelbar vor der Konsolidierung
        const poleStart = Math.max(0, flagFrom - maxPoleBars);
        if (flagFrom - poleStart < 5) continue;
        let lo = Infinity, hi = -Infinity, loIdx = 0, hiIdx = 0;
        for (let k = poleStart; k <= flagFrom; k++) {
          if (data[k].low  < lo) { lo = data[k].low;  loIdx = k; }
          if (data[k].high > hi) { hi = data[k].high; hiIdx = k; }
        }
        const poleMove = (hi - lo) / lo * 100;
        if (poleMove < minPoleMove) continue;

        // Richtung: lief der Impuls hoch oder runter?
        const poleUp = hiIdx > loIdx;
        const poleTop = poleUp ? hi : lo;

        const ch = analyzeChannel(win, { minR2 });
        if (!ch) continue;

        // Konsolidierung darf den Mast nicht auffressen
        const retrace = poleUp
          ? (poleTop - ch.lower.at(flagTo)) / (hi - lo)
          : (ch.upper.at(flagTo) - poleTop) / (hi - lo);
        if (retrace > maxFlagRetrace || retrace < 0) continue;

        // Flagge oder Wimpel?
        const parallel = Math.abs(ch.convergence) < 0.25;
        const converging = ch.convergence >= 0.25;
        if (!parallel && !converging) continue;

        // Bei der Flagge muss der Kanal GEGEN den Impuls laufen —
        // läuft er mit, ist es keine Konsolidierung, sondern Fortsetzung.
        if (parallel) {
          const drifts = (ch.upperSlope + ch.lowerSlope) / 2;
          if (poleUp && drifts > 0.5) continue;
          if (!poleUp && drifts < -0.5) continue;
        }

        const type  = parallel ? (poleUp ? "bullFlag" : "bearFlag")
                               : (poleUp ? "bullPennant" : "bearPennant");
        const label = parallel ? (poleUp ? "Bull-Flagge" : "Bear-Flagge")
                               : (poleUp ? "Bull-Wimpel" : "Bear-Wimpel");
        const direction = poleUp ? "bullish" : "bearish";

        // Ausbruch nur in Impulsrichtung zählt — ein Bruch in die
        // Gegenrichtung widerlegt das Muster.
        const end = Math.min(data.length - 1, flagTo + maxSpan);
        let confirmedAt = null, failed = false;
        for (let k = flagTo + 1; k <= end; k++) {
          if (poleUp) {
            if (data[k].close > ch.upper.at(k)) { confirmedAt = k; break; }
            if (data[k].close < ch.lower.at(k)) { failed = true; break; }
          } else {
            if (data[k].close < ch.lower.at(k)) { confirmedAt = k; break; }
            if (data[k].close > ch.upper.at(k)) { failed = true; break; }
          }
        }
        if (failed) continue;

        // Klassisches Ziel: Mastlänge ab Ausbruch projiziert
        const poleLen = hi - lo;
        const target = confirmedAt != null
          ? (poleUp ? data[confirmedAt].close + poleLen : data[confirmedAt].close - poleLen)
          : null;

        found.push({
          type, label, direction,
          points: win, channel: ch,
          pole: { from: poleStart, to: flagFrom, movePct: poleMove, up: poleUp },
          confirmedAt,
          breakoutDir: poleUp ? "up" : "down",
          neckline: confirmedAt != null ? (poleUp ? ch.upper.at(confirmedAt) : ch.lower.at(confirmedAt)) : null,
          target,
          quality: Math.round((
            Math.min(1, poleMove / (minPoleMove * 2)) * 0.4 +
            (ch.upper.r2 + ch.lower.r2) / 2 * 0.4 +
            (1 - retrace / maxFlagRetrace) * 0.2
          ) * 100) / 100,
        });
      }
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
    // Je mehr Struktur ein Muster verlangt, desto aussagekräftiger ist es
    // — bei Überlappung gewinnt das anspruchsvollere.
    const rank = {
      headShoulders: 4, invHeadShoulders: 4,
      bullFlag: 4, bearFlag: 4, bullPennant: 4, bearPennant: 4,  // Impuls-Kontext = selten
      risingWedge: 3, fallingWedge: 3,
      ascTriangle: 3, descTriangle: 3, symTriangle: 3,
      rectangle: 3,   // fasst Triple Top UND Triple Bottom zusammen -> aussagekräftiger
      tripleTop: 2, tripleBottom: 2,
      doubleTop: 1, doubleBottom: 1,
    };
    const sorted = [...patterns].sort((a, b) => {
      const r = (rank[b.type] || 0) - (rank[a.type] || 0);
      if (r !== 0) return r;
      const q = b.quality - a.quality;
      if (Math.abs(q) > 0.01) return q;
      // Bei gleicher Güte gewinnt die längere Formation. Wichtig für
      // Trendlinien-Muster: dieselbe Range wird in vielen Teilfenstern
      // gefunden, gemeint ist aber immer die grösste zusammenhängende.
      const la = a.points[a.points.length - 1].index - a.points[0].index;
      const lb = b.points[b.points.length - 1].index - b.points[0].index;
      return lb - la;
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

    // Trendlinien-Muster (Dreieck / Keil / Rechteck).
    //
    // Diese Werte stammen aus einem Nullmodell-Lauf (40× 500 Bars GARCH):
    //   R2 .75 conv .35 piv 5 -> 2.52 Fehlalarme/500 Bars
    //   R2 .90 conv .50 piv 5 -> 1.90
    //   R2 .90 conv .50 piv 6 -> 1.00   <- Default
    //   R2 .93 conv .55 piv 6 -> 0.80
    //
    // Bewusst NICHT der schärfste Wert: die Testmuster waren perfekt
    // konstruiert, echte sind unsauberer. Auf die letzte Zehntelstelle
    // zu optimieren hiesse, auf synthetische Daten zu overfitten.
    minR2:          0.90,   // Güte der Geraden durch die Pivots
    minConvergence: 0.50,   // wie stark müssen die Linien zusammenlaufen
    minPivots:      6,      // Stützpunkte je Linie — der wirksamste Hebel
    flatTol:        1.5,    // ab wann gilt eine Linie als "flach" (% über die Spanne)
    minSlope:       2.0,    // Mindest-Steigung für einen Keil
    minHeightPct:   3,      // Mindesthöhe einer Range

    // Flaggen und Wimpel
    minPoleMove:    12,     // Mindest-Impuls in % vor der Formation
    maxPoleBars:    30,     // Impuls muss schnell sein
    maxFlagRetrace: 0.5,    // Konsolidierung darf max. halben Mast abgeben
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
    detectTriangles,
    detectWedges,
    detectRectangles,
    detectFlags,
    fitLine,
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

      // Trendlinien-Muster brauchen die Pivots als Fenster, nicht als Tripel
      const wantTri  = on("ascTriangle") || on("descTriangle") || on("symTriangle");
      const wantWdg  = on("risingWedge") || on("fallingWedge");
      if (wantTri)          found = found.concat(detectTriangles(pivots, slice, opts));
      if (wantWdg)          found = found.concat(detectWedges(pivots, slice, opts));
      if (on("rectangle"))  found = found.concat(detectRectangles(pivots, slice, opts));

      const wantFlag = on("bullFlag") || on("bearFlag") || on("bullPennant") || on("bearPennant");
      if (wantFlag)         found = found.concat(detectFlags(pivots, slice, opts));

      // Einzelne Typen nachträglich filtern (die Detektoren liefern Gruppen)
      found = found.filter(p => opts[p.type] !== false);

      found = dedupe(found);
      if (opts.minQuality) found = found.filter(p => p.quality >= opts.minQuality);

      // Indizes auf den vollen Datensatz zurückrechnen.
      //
      // ACHTUNG: Nicht nur points/confirmedAt. Trendlinien-Muster tragen
      // channel.from/to, Flaggen zusätzlich pole.from/to — und die
      // Geraden-Funktionen at() rechnen mit SLICE-Indizes. Wird das
      // vergessen, greift das Rendering mit einem Slice-Index in den
      // vollen Datensatz und zeichnet das Muster ganz woanders hin.
      found.forEach(p => {
        p.points = p.points.map(pt => ({ ...pt, index: pt.index + from }));
        if (p.confirmedAt != null) p.confirmedAt += from;

        if (p.channel) {
          const ch = p.channel;
          // at() auf globale Indizes umhängen, bevor from/to verschoben werden
          const upAt = ch.upper.at, loAt = ch.lower.at;
          ch.upper = { ...ch.upper, at: (i) => upAt(i - from) };
          ch.lower = { ...ch.lower, at: (i) => loAt(i - from) };
          ch.from += from;
          ch.to   += from;
        }
        if (p.pole) {
          p.pole.from += from;
          p.pole.to   += from;
        }
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
