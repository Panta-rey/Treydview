// ============================================================
// TreydView v0.2 — Custom-Overlays (Zeichenwerkzeuge)
// Rechteck, Price Range, Date Range
// (Linien, Kanäle, Fibonacci sind in KLineCharts eingebaut)
// ============================================================

(function () {
  "use strict";

  function rectAttrs(c1, c2) {
    return {
      x: Math.min(c1.x, c2.x),
      y: Math.min(c1.y, c2.y),
      width: Math.abs(c2.x - c1.x),
      height: Math.abs(c2.y - c1.y),
    };
  }

  // ---------- Rechteck ----------
  klinecharts.registerOverlay({
    name: "rectangle",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      return [{
        type: "rect",
        attrs: rectAttrs(coordinates[0], coordinates[1]),
        styles: {
          style: "stroke_fill",
          color: "rgba(232,182,76,0.12)",
          borderColor: "#e8b64c",
          borderSize: 1,
        },
      }];
    },
  });

  // ---------- Price Range (vertikale Messung) ----------
  klinecharts.registerOverlay({
    name: "priceRange",
    totalStep: 3,
    needDefaultPointFigure: true,
    createPointFigures: ({ coordinates, overlay, precision }) => {
      if (coordinates.length < 2) return [];
      const p0 = overlay.points[0].value;
      const p1 = overlay.points[1].value;
      const diff = p1 - p0;
      const pct = p0 !== 0 ? (diff / p0) * 100 : 0;
      const digits = Math.min(precision.price, 4);
      const label = `${diff >= 0 ? "+" : ""}${diff.toFixed(digits)}  (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      const midX = (coordinates[0].x + coordinates[1].x) / 2;
      return [
        {
          type: "rect",
          attrs: rectAttrs(coordinates[0], coordinates[1]),
          styles: {
            style: "stroke_fill",
            color: diff >= 0 ? "rgba(63,182,139,0.10)" : "rgba(208,94,94,0.10)",
            borderColor: diff >= 0 ? "#3fb68b" : "#d05e5e",
            borderSize: 1,
          },
        },
        {
          type: "text",
          attrs: { x: midX, y: Math.min(coordinates[0].y, coordinates[1].y) - 6, text: label, align: "center", baseline: "bottom" },
          styles: {
            color: "#0d1117",
            backgroundColor: diff >= 0 ? "#3fb68b" : "#d05e5e",
            paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
            borderRadius: 3,
          },
          ignoreEvent: true,
        },
      ];
    },
  });

  // ---------- Date Range (horizontale Messung) ----------
  klinecharts.registerOverlay({
    name: "dateRange",
    totalStep: 3,
    needDefaultPointFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const t0 = overlay.points[0].timestamp;
      const t1 = overlay.points[1].timestamp;
      let label = "–";
      if (t0 && t1) {
        const ms = Math.abs(t1 - t0);
        const days = ms / 86400000;
        label = days >= 2
          ? `${Math.round(days)} Tage`
          : `${Math.round(ms / 3600000)} Std`;
      }
      const midX = (coordinates[0].x + coordinates[1].x) / 2;
      return [
        {
          type: "rect",
          attrs: rectAttrs(coordinates[0], coordinates[1]),
          styles: {
            style: "stroke_fill",
            color: "rgba(90,169,230,0.10)",
            borderColor: "#5aa9e6",
            borderSize: 1,
          },
        },
        {
          type: "text",
          attrs: { x: midX, y: Math.max(coordinates[0].y, coordinates[1].y) + 6, text: label, align: "center", baseline: "top" },
          styles: {
            color: "#0d1117",
            backgroundColor: "#5aa9e6",
            paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
            borderRadius: 3,
          },
          ignoreEvent: true,
        },
      ];
    },
  });

  // ---------- FRVP — Fixed Range Volume Profile ----------
  klinecharts.registerOverlay({
    name: "frvp",
    totalStep: 3,
    needDefaultPointFigure: false,  // Kein automatisches Verbindungsrechteck oben
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, xAxis, yAxis }) => {
      if (coordinates.length < 2) return [];
      const getData = (typeof window !== "undefined" && window.__tvGetDataList) ? window.__tvGetDataList : null;
      if (!getData) return [];
      const dataList = getData();
      if (!dataList || dataList.length === 0) return [];

      const p0 = overlay.points[0], p1 = overlay.points[1];
      const tStart = Math.min(p0.timestamp, p1.timestamp);
      const tEnd   = Math.max(p0.timestamp, p1.timestamp);
      const slice  = dataList.filter(d => d.timestamp >= tStart && d.timestamp <= tEnd);
      if (slice.length < 2) return [];

      // Parameter aus extendData (Rechtsklick-Menü)
      const ext = overlay.extendData || {};
      const rows      = ext.rows      || 150;
      const vaPct     = ext.valueArea || 70;
      const widthPct  = ext.width     || 30;
      const showVAH   = ext.showVAH   !== false;
      const showVAL   = ext.showVAL   !== false;
      const showPOC   = ext.showPOC   !== false;
      const colorUp   = ext.colorUp   || "rgba(63,182,139,0.55)";
      const colorDown = ext.colorDown || "rgba(208,94,94,0.55)";
      const colorVAH  = ext.colorVAH  || "#e8b64c";
      const colorVAL  = ext.colorVAL  || "#e8b64c";
      const colorPOC  = ext.colorPOC  || "#ffffff";

      // Preis-Range
      let pMin = Infinity, pMax = -Infinity;
      for (const d of slice) { if (d.low < pMin) pMin = d.low; if (d.high > pMax) pMax = d.high; }
      const rowH = (pMax - pMin) / rows;
      if (rowH === 0) return [];

      // Volumen akkumulieren
      const upVol = new Float64Array(rows), downVol = new Float64Array(rows);
      for (const d of slice) {
        const vol = d.volume || 0, isUp = d.close >= d.open;
        const rLow  = Math.max(0, Math.floor((d.low  - pMin) / rowH));
        const rHigh = Math.min(rows - 1, Math.floor((d.high - pMin) / rowH));
        const n = rHigh - rLow + 1;
        for (let r = rLow; r <= rHigh; r++) {
          if (isUp) upVol[r] += vol / n; else downVol[r] += vol / n;
        }
      }
      const totalVol = upVol.map((u, i) => u + downVol[i]);
      const maxVol   = Math.max(...totalVol.filter(v => v > 0));
      if (!(maxVol > 0)) return [];

      // POC (höchstes Volumen)
      const pocRow   = totalVol.indexOf(Math.max(...totalVol));
      const pocPrice = pMin + (pocRow + 0.5) * rowH;

      // Value Area (70% um POC)
      const totalAll = totalVol.reduce((s, v) => s + v, 0);
      const vaTarget = totalAll * (vaPct / 100);
      let vaVol = totalVol[pocRow], vaLow = pocRow, vaHigh = pocRow;
      while (vaVol < vaTarget && (vaLow > 0 || vaHigh < rows - 1)) {
        const aH = vaHigh < rows - 1 ? totalVol[vaHigh + 1] : 0;
        const aL = vaLow  > 0        ? totalVol[vaLow  - 1] : 0;
        if (aH >= aL) { vaHigh++; vaVol += aH; } else { vaLow--; vaVol += aL; }
      }
      const vahPrice = pMin + (vaHigh + 1) * rowH;
      const valPrice = pMin + vaLow * rowH;

      // Pixel-Koordinaten
      const xLeft  = Math.min(coordinates[0].x, coordinates[1].x);
      // extendRight: VAH/VAL/POC-Linien bis zum rechten Chart-Rand verlängern.
      // bounding kommt vom yAxis-Objekt (KLC-intern); als Fallback nehmen wir
      // eine grosszügige Breite, die in der Praxis nie sichtbar ist.
      const chartW  = (typeof xAxis?.getBounding === "function" ? xAxis.getBounding().width : null)
                   || (typeof yAxis?.getBounding === "function" ? yAxis.getBounding().right : null)
                   || 2400;
      const xRight   = (ext.extendRight) ? chartW : Math.max(coordinates[0].x, coordinates[1].x);
      const boxWidth = Math.max(coordinates[0].x, coordinates[1].x) - xLeft;
      const maxBarW  = boxWidth * (widthPct / 100);

      // Gesamt-Preis-Range in Pixel für Hitbox
      const yTop_px    = yAxis.convertToPixel(pMax);
      const yBottom_px = yAxis.convertToPixel(pMin);
      const profileH   = Math.abs(yBottom_px - yTop_px);

      const figures = [];

      // ---- Histogramm-Balken ----
      for (let r = 0; r < rows; r++) {
        const tot = totalVol[r];
        if (tot === 0) continue;
        const pb = pMin + r * rowH, pt = pb + rowH;
        const yb   = yAxis.convertToPixel(pb);
        const yt   = yAxis.convertToPixel(pt);
        const yTop = Math.min(yb, yt);
        const yH   = Math.max(1, Math.abs(yt - yb));
        const upW  = (upVol[r]   / maxVol) * maxBarW;
        const dnW  = (downVol[r] / maxVol) * maxBarW;

        if (upW > 0) figures.push({
          type: "rect",
          attrs: { x: xLeft, y: yTop, width: upW, height: yH },
          styles: { style: "fill", color: colorUp },
          ignoreEvent: true,
        });
        if (dnW > 0) figures.push({
          type: "rect",
          attrs: { x: xLeft + upW, y: yTop, width: dnW, height: yH },
          styles: { style: "fill", color: colorDown },
          ignoreEvent: true,
        });
      }

      // ---- VAH-Linie (verlängert bis xRight wenn extendRight) ----
      if (showVAH) {
        const yVAH = yAxis.convertToPixel(vahPrice);
        figures.push({
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: yVAH }, { x: xRight, y: yVAH }] },
          styles: { style: "solid", color: colorVAH, size: 1.5, dashedValue: [2, 2], smooth: false },
          ignoreEvent: true,
        });
      }

      // ---- VAL-Linie (verlängert bis xRight wenn extendRight) ----
      if (showVAL) {
        const yVAL = yAxis.convertToPixel(valPrice);
        figures.push({
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: yVAL }, { x: xRight, y: yVAL }] },
          styles: { style: "solid", color: colorVAL, size: 1.5, dashedValue: [2, 2], smooth: false },
          ignoreEvent: true,
        });
      }

      // ---- POC-Linie (verlängert bis xRight wenn extendRight) ----
      if (showPOC) {
        const yPOC = yAxis.convertToPixel(pocPrice);
        figures.push({
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: yPOC }, { x: xRight, y: yPOC }] },
          styles: { style: "dashed", color: colorPOC, size: 1.5, dashedValue: [4, 3], smooth: false },
          ignoreEvent: true,
        });
      }

      // ---- Unsichtbare Hitbox über dem ganzen Profil (macht es klickbar) ----
      // ignoreEvent: false = klickbar; transparent = unsichtbar
      figures.push({
        type: "rect",
        attrs: { x: xLeft, y: Math.min(yTop_px, yBottom_px), width: maxBarW, height: profileH },
        styles: { style: "fill", color: "rgba(0,0,0,0)" },
        ignoreEvent: false,  // Klick wird registriert
      });

      return figures;
    },
  });
  // ============================================================
  // FIBONACCI — TradingView-Stil
  // Retracement: 2 Punkte (Bewegung von 0 nach 1)
  // Extension:   3 Punkte (A→B Impuls, C Korrektur-Ende, Projektion ab C)
  // ============================================================

  // Levels kommen aus config.js (FIB_LEVEL_SETS) — einzige Quelle,
  // gemeinsam mit dem Einstellungsmenü in app.js.
  const FIB_LEVELS     = FIB_LEVEL_SETS.fibRetracement;
  const FIB_EXT_LEVELS = FIB_LEVEL_SETS.fibExtension;

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function fmtPrice(p) {
    return p.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Theme-abhängige Label-Farben. Farbiger Text auf kontrastierendem Chip
  // ist besser lesbar als farbiger Text direkt auf dem Chart.
  function labelColors() {
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    return {
      bg:     dark ? "rgba(13,17,23,0.85)"   : "rgba(255,255,255,0.92)",
      border: dark ? "rgba(143,163,184,0.2)" : "rgba(60,80,100,0.2)",
    };
  }

  // Baut die Figuren für eine Reihe von Fib-Levels.
  // yAt(level) -> Pixel-Y, priceAt(level) -> Preis
  function buildFibFigures(levels, coords, yAt, priceAt, extendData) {
    const ed = extendData || {};
    const figs = [];
    const xLeft   = Math.min(...coords.map(c => c.x));
    let   xRight  = Math.max(...coords.map(c => c.x));

    const showFill    = ed.showFill    !== false;
    const showLabels  = ed.showLabels  !== false;
    const showPrices  = ed.showPrices  !== false;
    const showLevels  = ed.showLevels  !== false;
    const extendRight = ed.extendRight === true;
    const fillAlpha   = (ed.fillOpacity != null ? ed.fillOpacity : 5) / 100;
    const lineWidth   = ed.lineWidth || 1;
    const hidden      = ed.hiddenLevels || {};   // { "0.236": true, ... }

    if (extendRight) xRight = xLeft + (xRight - xLeft) * 2.2;

    const visible = levels.filter(lv => !hidden[String(lv.v)]);
    const lc = labelColors();

    // 1. Flächen zwischen benachbarten sichtbaren Levels
    if (showFill) {
      for (let i = 0; i < visible.length - 1; i++) {
        const y1 = yAt(visible[i].v), y2 = yAt(visible[i + 1].v);
        if (y1 == null || y2 == null) continue;
        figs.push({
          type: "rect",
          attrs: { x: xLeft, y: Math.min(y1, y2), width: xRight - xLeft, height: Math.abs(y2 - y1) },
          styles: { style: "fill", color: hexA(visible[i + 1].color, fillAlpha) },
        });
      }
    }

    // 2. Level-Linien
    visible.forEach(lv => {
      const y = yAt(lv.v);
      if (y == null) return;
      figs.push({
        type: "line",
        attrs: { coordinates: [{ x: xLeft, y }, { x: xRight, y }] },
        styles: { style: "solid", color: hexA(lv.color, 0.85), size: lineWidth },
      });
    });

    // 3. Beschriftung als Chip mit Hintergrund (sonst auf farbiger
    //    Füllung praktisch unlesbar)
    if (showLabels) {
      visible.forEach(lv => {
        const y = yAt(lv.v);
        if (y == null) return;
        let txt = "";
        if (showLevels && showPrices) txt = `${lv.v} (${fmtPrice(priceAt(lv.v))})`;
        else if (showLevels)          txt = String(lv.v);
        else if (showPrices)          txt = fmtPrice(priceAt(lv.v));
        if (!txt) return;
        figs.push({
          type: "text",
          attrs: { x: xLeft - 4, y: y, text: txt, align: "right", baseline: "middle" },
          styles: {
            style: "stroke_fill",
            color: hexA(lv.color, 1),
            backgroundColor: lc.bg,
            borderColor: lc.border,
            borderSize: 1,
            borderRadius: 2,
            size: 11,
            family: "IBM Plex Mono, monospace",
            paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
          },
        });
      });
    }

    return figs;
  }

  // ---------- Fibonacci Retracement ----------
  klinecharts.registerOverlay({
    name: "fibRetracement",
    totalStep: 3,
    needDefaultPointFigure: false,
    onRightClick: (event) => {
      if (window.__tvOpenFibMenu) { window.__tvOpenFibMenu(event); return true; }
      return false;
    },
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const pts = overlay.points || [];
      if (pts.length < 2 || pts[0].value == null || pts[1].value == null) return [];

      const p0 = pts[0].value, p1 = pts[1].value;
      // Level 0 liegt beim ersten Punkt, Level 1 beim zweiten.
      const priceAt = (lv) => p0 + (p1 - p0) * lv;
      const yAt     = (lv) => c0.y + (c1.y - c0.y) * lv;

      const figs = buildFibFigures(FIB_LEVELS, [c0, c1], yAt, priceAt, overlay.extendData);
      // Verbindungslinie der beiden Ankerpunkte (gestrichelt, dezent)
      figs.push({
        type: "line",
        attrs: { coordinates: [c0, c1] },
        styles: { style: "dashed", dashedValue: [4, 4], color: "rgba(154,165,177,0.5)", size: 1 },
      });
      return figs;
    },
  });

  // ---------- Fibonacci Extension ----------
  klinecharts.registerOverlay({
    name: "fibExtension",
    totalStep: 4,
    needDefaultPointFigure: false,
    onRightClick: (event) => {
      if (window.__tvOpenFibMenu) { window.__tvOpenFibMenu(event); return true; }
      return false;
    },
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 3) return [];
      const [cA, cB, cC] = coordinates;
      const pts = overlay.points || [];
      if (pts.length < 3 || pts.some(p => p.value == null)) return [];

      const pA = pts[0].value, pB = pts[1].value, pC = pts[2].value;
      // Projektion: Impuls A→B wird ab C fortgesetzt.
      const diff = pB - pA;
      const priceAt = (lv) => pC + diff * lv;
      // Pixel analog: Distanz A→B ab C
      const dy = cB.y - cA.y;
      const yAt = (lv) => cC.y + dy * lv;

      const figs = buildFibFigures(FIB_EXT_LEVELS, [cB, cC], yAt, priceAt, overlay.extendData);
      // Hilfslinien A→B→C
      figs.push({
        type: "line",
        attrs: { coordinates: [cA, cB, cC] },
        styles: { style: "dashed", dashedValue: [4, 4], color: "rgba(154,165,177,0.5)", size: 1 },
      });
      return figs;
    },
  });

  // ---------- Erkanntes Chart-Muster ----------
  // Wird von der Pattern-Engine erzeugt, nicht vom User gezeichnet.
  // Punkte: 3 (Double) oder 5 (Triple, H&S) Pivots + optional
  // 1 Bestätigungspunkt am Ende.
  // Per Rechtsklick löschbar wie jede andere Zeichnung.
  klinecharts.registerOverlay({
    name: "pattern",
    totalStep: 1,               // programmatisch erzeugt, kein Klick-Flow
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, bounding }) => {
      if (coordinates.length < 3) return [];
      const ed = overlay.extendData || {};
      const bearish = ed.direction === "bearish";
      const col  = bearish ? "#d05e5e" : "#3fb68b";
      const colA = bearish ? "rgba(208,94,94,0.9)" : "rgba(63,182,139,0.9)";

      // Letzter Punkt ist der Bestätigungspunkt, falls vorhanden
      const nPivots = ed.pivotCount || (coordinates.length >= 6 ? 5 : coordinates.length >= 4 && coordinates.length !== 5 ? 3 : coordinates.length);
      const pivots  = coordinates.slice(0, nPivots);
      const confirm = coordinates.length > nPivots ? coordinates[coordinates.length - 1] : null;
      const figs = [];

      // Musterform: Verbindung aller Pivots
      figs.push({
        type: "line",
        attrs: { coordinates: pivots },
        styles: { style: "solid", color: colA, size: 2 },
      });

      // Neckline. Bei H&S schräg (durch die beiden Täler), sonst waagrecht.
      const xStart = pivots[0].x;
      const xEnd   = confirm ? confirm.x : pivots[pivots.length - 1].x + (pivots[pivots.length - 1].x - xStart) * 0.3;
      let neckFigure;
      if (ed.slantedNeckline && pivots.length >= 5) {
        // Gerade durch P2 und P4 verlängern
        const a = pivots[1], b = pivots[3];
        const m = (b.y - a.y) / (b.x - a.x || 1);
        neckFigure = {
          type: "line",
          attrs: { coordinates: [
            { x: xStart, y: a.y + m * (xStart - a.x) },
            { x: xEnd,   y: a.y + m * (xEnd   - a.x) },
          ]},
        };
      } else {
        // Waagrecht durch das relevante Tal
        const necklineY = pivots.length >= 5
          ? (bearish ? Math.max(pivots[1].y, pivots[3].y) : Math.min(pivots[1].y, pivots[3].y))
          : pivots[1].y;
        neckFigure = {
          type: "line",
          attrs: { coordinates: [{ x: xStart, y: necklineY }, { x: xEnd, y: necklineY }] },
        };
      }
      neckFigure.styles = { style: "dashed", dashedValue: [5, 4], color: colA, size: 1 };
      figs.push(neckFigure);

      // Extrempunkte markieren (Tops/Bottoms, nicht die Täler)
      pivots.forEach((c, i) => {
        if (i % 2 !== 0) return;
        const isHead = pivots.length === 5 && i === 2 && ed.hasHead;
        figs.push({
          type: "circle",
          attrs: { x: c.x, y: c.y, r: isHead ? 4.5 : 3.5 },
          styles: { style: "fill", color: col },
        });
      });

      // Bestätigungspunkt (Neckline-Bruch)
      if (confirm) {
        figs.push({
          type: "circle",
          attrs: { x: confirm.x, y: confirm.y, r: 4 },
          styles: { style: "stroke_fill", color: colA, borderColor: "#ffffff", borderSize: 1 },
        });
      }

      // Label mit Chip-Hintergrund (lesbar auf jedem Untergrund)
      const ys = pivots.map(c => c.y);
      const labelY = bearish ? Math.min(...ys) - 10 : Math.max(...ys) + 10;
      // "Form" statt nur "%": die Zahl misst Symmetrie/Ausprägung des Musters —
      // bewusst NICHT "Wahrscheinlichkeit", ein Prozentwert wirkt sonst wie eine Trefferquote.
      // NICHT die Trefferwahrscheinlichkeit. Ohne Label liest man sie als Konfidenz.
      const q = ed.quality != null ? `  Form ${Math.round(ed.quality * 100)}%` : "";
      const lc = labelColors();
      // Scrollt das Muster halb aus dem Bild, liegt die Mitte zwischen erstem
      // und letztem Pivot ausserhalb — dann sieht man nur noch die Punkte und
      // weiss nicht mehr, wofür sie stehen. Deshalb ins Sichtfeld klemmen.
      const W = bounding?.width || 1200;
      const rawX = (pivots[0].x + pivots[pivots.length - 1].x) / 2;
      const labelX = Math.max(60, Math.min(W - 60, rawX));

      figs.push({
        type: "text",
        attrs: {
          x: labelX,
          y: labelY,
          text: (ed.label || "Muster") + q,
          align: "center",
          baseline: bearish ? "bottom" : "top",
        },
        styles: {
          style: "stroke_fill",
          color: colA,
          backgroundColor: lc.bg,
          borderColor: colA,
          borderSize: 1,
          borderRadius: 3,
          size: 11,
          family: "IBM Plex Mono, monospace",
          paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
        },
      });

      return figs;
    },
  });

  // ---------- Grid-Bänder (vom Grid Bot erzeugt) ----------
  // Zeigt Range, Grid-Linien und Stop für das gewählte Tier.
  // Der eigentliche Mehrwert gegenüber Excel: man SIEHT, ob die Range
  // die letzten Monate überspannt hätte oder ob der Preis rausgelaufen wäre.
  klinecharts.registerOverlay({
    name: "gridBands",
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, bounding }) => {
      if (coordinates.length < 2) return [];
      const ed = overlay.extendData || {};
      const yUp = coordinates[0].y, yLo = coordinates[1].y;
      const x0 = 0, x1 = bounding?.width || coordinates[1].x;
      const figs = [];

      const dir = ed.direction;
      const col = dir === "Long" ? "#3fb68b" : dir === "Short" ? "#d05e5e" : "#e8b64c";
      const colA = (a) => hexA(col, a);

      // Range-Fläche
      figs.push({
        type: "rect",
        attrs: { x: x0, y: Math.min(yUp, yLo), width: x1 - x0, height: Math.abs(yLo - yUp) },
        styles: { style: "fill", color: colA(0.06) },
      });

      // Grid-Linien innerhalb der Range
      const n = Math.max(2, Math.min(60, ed.grids || 10));   // >60 wäre nur noch Grau
      for (let i = 1; i < n; i++) {
        const y = yUp + (yLo - yUp) * (i / n);
        figs.push({
          type: "line",
          attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] },
          styles: { style: "solid", color: colA(0.13), size: 1 },
        });
      }

      // Range-Grenzen
      [[yUp, ed.upper, "UP"], [yLo, ed.lower, "LP"]].forEach(([y, val, tag]) => {
        figs.push({
          type: "line",
          attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] },
          styles: { style: "solid", color: colA(0.85), size: 1 },
        });
        figs.push({
          type: "text",
          attrs: { x: x0 + 6, y: y, text: `${tag} ${fmtPrice(val)}`, align: "left", baseline: "middle" },
          styles: {
            style: "stroke_fill", color: colA(1), backgroundColor: labelColors().bg,
            borderColor: colA(0.4), borderSize: 1, borderRadius: 2, size: 10,
            family: "IBM Plex Mono, monospace",
            paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
          },
        });
      });

      // Stop-Linie
      if (ed.stopLoss != null && overlay.points?.[0]) {
        const yStop = yLo + (yLo - yUp) * 0.06 * (ed.stopLoss < ed.lower ? 1 : -1);
        figs.push({
          type: "line",
          attrs: { coordinates: [{ x: x0, y: yStop }, { x: x1, y: yStop }] },
          styles: { style: "dashed", dashedValue: [5, 4], color: "rgba(208,94,94,0.8)", size: 1 },
        });
        figs.push({
          type: "text",
          attrs: { x: x0 + 6, y: yStop, text: `SL ${fmtPrice(ed.stopLoss)}`, align: "left", baseline: "middle" },
          styles: {
            style: "stroke_fill", color: "#d05e5e", backgroundColor: labelColors().bg,
            borderColor: "rgba(208,94,94,0.4)", borderSize: 1, borderRadius: 2, size: 10,
            family: "IBM Plex Mono, monospace",
            paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
          },
        });
      }

      // Tier-Label
      figs.push({
        type: "text",
        attrs: { x: x1 - 6, y: Math.min(yUp, yLo) + 2, text: `${ed.label} · ${ed.grids} Grids · ${ed.leverage}×`, align: "right", baseline: "top" },
        styles: {
          style: "stroke_fill", color: colA(1), backgroundColor: labelColors().bg,
          borderColor: colA(0.4), borderSize: 1, borderRadius: 2, size: 10,
          family: "IBM Plex Mono, monospace",
          paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
        },
      });

      return figs;
    },
  });

  // ---------- Long / Short Position ----------
  // Drei Klicks: Einstieg, Stop, Ziel. CRV und Positionsgrösse fallen
  // daraus. Nutzt dieselben Kapital/Risiko-Felder wie der Grid Bot —
  // eine Quelle, zwei Konsumenten.
  klinecharts.registerOverlay({
    name: "positionTool",
    totalStep: 4,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const pts = overlay.points || [];
      if (pts.length < 2 || pts[0].value == null) return [];

      const entry = pts[0].value;
      const stop  = pts[1]?.value;
      const target = pts[2]?.value;
      const cEntry = coordinates[0], cStop = coordinates[1], cTarget = coordinates[2];

      const isLong = stop != null && stop < entry;
      const x0 = Math.min(...coordinates.map(c => c.x));
      const x1 = Math.max(...coordinates.map(c => c.x)) + 60;
      const figs = [];

      const risk = stop != null ? Math.abs(entry - stop) : null;
      const reward = target != null ? Math.abs(target - entry) : null;
      const rr = (risk && reward) ? reward / risk : null;

      // Risiko-Zone (Einstieg -> Stop)
      if (cStop) {
        figs.push({
          type: "rect",
          attrs: { x: x0, y: Math.min(cEntry.y, cStop.y), width: x1 - x0, height: Math.abs(cStop.y - cEntry.y) },
          styles: { style: "fill", color: "rgba(208,94,94,0.10)" },
        });
      }
      // Gewinn-Zone (Einstieg -> Ziel)
      if (cTarget) {
        figs.push({
          type: "rect",
          attrs: { x: x0, y: Math.min(cEntry.y, cTarget.y), width: x1 - x0, height: Math.abs(cTarget.y - cEntry.y) },
          styles: { style: "fill", color: "rgba(63,182,139,0.10)" },
        });
      }

      const line = (y, color, style) => ({
        type: "line",
        attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] },
        styles: { style: style || "solid", color, size: 1, dashedValue: [4, 4] },
      });
      const chip = (y, text, color) => ({
        type: "text",
        attrs: { x: x1 - 4, y, text, align: "right", baseline: "middle" },
        styles: {
          style: "stroke_fill", color, backgroundColor: labelColors().bg,
          borderColor: hexA(color.replace("rgba", "rgb").split(",").slice(0, 3).join(",") + ")", 0.4),
          borderSize: 1, borderRadius: 2, size: 10, family: "IBM Plex Mono, monospace",
          paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
        },
      });

      figs.push(line(cEntry.y, "rgba(154,165,177,0.9)"));
      figs.push(chip(cEntry.y, `Einstieg ${fmtPrice(entry)}`, "#9aa5b1"));

      if (cStop) {
        figs.push(line(cStop.y, "rgba(208,94,94,0.9)"));
        const rPct = ((Math.abs(entry - stop) / entry) * 100).toFixed(2);
        figs.push(chip(cStop.y, `Stop ${fmtPrice(stop)}  −${rPct}%`, "#d05e5e"));
      }
      if (cTarget) {
        figs.push(line(cTarget.y, "rgba(63,182,139,0.9)"));
        const gPct = ((Math.abs(target - entry) / entry) * 100).toFixed(2);
        figs.push(chip(cTarget.y, `Ziel ${fmtPrice(target)}  +${gPct}%`, "#3fb68b"));
      }

      // Kennzahlen-Block: CRV und Positionsgrösse
      if (rr != null) {
        const sizing = (window.__tvSizing && window.__tvSizing()) || null;
        const lines = [`${isLong ? "Long" : "Short"}   CRV 1:${rr.toFixed(2)}`];
        if (sizing && risk) {
          const stopDist = risk / entry;
          const size = Math.min(sizing.capital, Math.round((sizing.capital * sizing.riskPct / 100) / stopDist));
          lines.push(`Size ${size.toLocaleString("de-CH")} USDT  (${sizing.riskPct}% von ${sizing.capital.toLocaleString("de-CH")})`);
          lines.push(`Risiko ${Math.round(sizing.capital * sizing.riskPct / 100)} USDT  =  1R`);
        }
        const yTop = Math.min(...coordinates.map(c => c.y)) - 8;
        lines.forEach((txt, i) => {
          figs.push({
            type: "text",
            attrs: { x: x0 + 4, y: yTop - (lines.length - 1 - i) * 15, text: txt, align: "left", baseline: "bottom" },
            styles: {
              style: "stroke_fill", color: "#e8b64c", backgroundColor: labelColors().bg,
              borderColor: "rgba(232,182,76,0.35)", borderSize: 1, borderRadius: 2,
              size: 10, family: "IBM Plex Mono, monospace",
              paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2,
            },
          });
        });
      }

      return figs;
    },
  });

  // ---------- Freihand ----------
  // KLineCharts' Overlay-System arbeitet mit diskreten Klick-Punkten
  // (totalStep). Freihand braucht dagegen kontinuierliches Tracking bei
  // gedrückter Maus. Deshalb sammelt app.js die Punkte selbst per
  // mousemove und erzeugt das Overlay am Ende in einem Rutsch — dieses
  // Overlay zeichnet nur noch die fertige Punktkette.
  klinecharts.registerOverlay({
    name: "freehand",
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const ed = overlay.extendData || {};
      return [{
        type: "line",
        attrs: { coordinates },
        styles: {
          style: "solid",
          color: ed.color || "#e8b64c",
          size: ed.size || 2,
          smooth: true,
        },
      }];
    },
  });

  // ---------- Trendlinien-Muster (Dreieck / Keil / Rechteck) ----------
  // Anders als Double/Triple/H&S besteht dieses Muster nicht aus Pivots,
  // sondern aus zwei Geraden. Die Punkte sind: [links-oben, rechts-oben,
  // links-unten, rechts-unten] + optional Ausbruchspunkt.
  klinecharts.registerOverlay({
    name: "channelPattern",
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, bounding }) => {
      if (coordinates.length < 4) return [];
      const ed = overlay.extendData || {};
      const bearish = ed.direction === "bearish";
      const bullish = ed.direction === "bullish";
      const col  = bearish ? "#d05e5e" : bullish ? "#3fb68b" : "#e8b64c";
      const colA = (a) => hexA(col, a);

      const [ul, ur, ll, lr] = coordinates;
      const brk  = ed.hasBreak ? coordinates[4] : null;
      const poleA = ed.pole ? coordinates[ed.hasBreak ? 5 : 4] : null;
      const poleB = ed.pole ? coordinates[ed.hasBreak ? 6 : 5] : null;
      const figs = [];

      // Fahnenmast: der Impuls, der die Flagge überhaupt zur Flagge macht
      if (poleA && poleB) {
        figs.push({
          type: "line",
          attrs: { coordinates: [poleA, poleB] },
          styles: { style: "solid", color: colA(0.55), size: 3 },
        });
      }

      // Fläche zwischen den beiden Linien
      figs.push({
        type: "polygon",
        attrs: { coordinates: [ul, ur, lr, ll] },
        styles: { style: "fill", color: colA(0.07) },
      });

      // Die beiden Trendlinien
      figs.push({ type: "line", attrs: { coordinates: [ul, ur] },
                  styles: { style: "solid", color: colA(0.9), size: 2 } });
      figs.push({ type: "line", attrs: { coordinates: [ll, lr] },
                  styles: { style: "solid", color: colA(0.9), size: 2 } });

      // Ausbruchspunkt
      if (brk) {
        figs.push({
          type: "circle",
          attrs: { x: brk.x, y: brk.y, r: 4 },
          styles: { style: "stroke_fill", color: colA(1), borderColor: "#ffffff", borderSize: 1 },
        });
      }

      // Label
      const lc = labelColors();
      const q = ed.quality != null ? `  Form ${Math.round(ed.quality * 100)}%` : "";
      // Label ins Sichtfeld klemmen — sonst bleiben beim Rausscrollen nur
      // die Linien ohne Bezeichnung übrig.
      const W2 = bounding?.width || 1200;
      const lx = Math.max(70, Math.min(W2 - 70, (ul.x + ur.x) / 2));
      figs.push({
        type: "text",
        attrs: { x: lx, y: Math.min(ul.y, ur.y) - 8, text: (ed.label || "Muster") + q,
                 align: "center", baseline: "bottom" },
        styles: {
          style: "stroke_fill", color: colA(1), backgroundColor: lc.bg,
          borderColor: colA(1), borderSize: 1, borderRadius: 3, size: 11,
          family: "IBM Plex Mono, monospace",
          paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
        },
      });

      return figs;
    },
  });

  // ---------- Anchored VWAP ----------
  // 1 Klick = Ankerpunkt. Das Overlay zeichnet nur eine senkrechte Marker-
  // Linie am Ankerpunkt; die eigentliche VWAP-Kurve kommt vom AVWAP-Indikator,
  // den das Overlay via window.__tvAnchorVwap(timestamp) aktiviert.
  // Warum Overlay + Indikator getrennt: KLineCharts-Indikatoren können keine
  // interaktiven Klick-Punkte setzen; Overlays können keine Kurvendaten aus
  // allen historischen Bars berechnen. Die Kombination gibt beides.
  klinecharts.registerOverlay({
    name: "avwap",
    totalStep: 2,   // 1 Klick = fertig
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, yAxis }) => {
      if (coordinates.length < 1) return [];
      const x = coordinates[0].x;
      // Ankerlinie von oben nach unten durch das Preis-Pane
      const yTop    = yAxis ? yAxis.convertToPixel(yAxis.getRange?.()?.to ?? 1e9) : 0;
      const yBottom = yAxis ? yAxis.convertToPixel(yAxis.getRange?.()?.from ?? 0)  : 2000;
      return [{
        type: "line",
        attrs: { coordinates: [{ x, y: yTop }, { x, y: yBottom }] },
        styles: { style: "dashed", color: "rgba(199,146,234,0.6)", size: 1, dashedValue: [4, 3], smooth: false },
      }];
    },
    onDrawEnd: (ev) => {
      const ts = ev?.overlay?.points?.[0]?.timestamp;
      if (ts && typeof window.__tvAnchorVwap === "function") {
        window.__tvAnchorVwap(ts, ev.overlay.id);
      }
      return false;
    },
    onRemoved: (ev) => {
      if (typeof window.__tvRemoveAnchorVwap === "function") {
        window.__tvRemoveAnchorVwap(ev.overlay.id);
      }
      return false;
    },
  });

  // ---------- Polyline (nur Rendering) ----------
  // Das Zeichnen läuft klickbasiert über eigene Handler in app.js
  // (startPolyline), analog zum Freihand-Werkzeug. Hier nur die Darstellung
  // der fertigen Mehrpunkt-Linie.
  klinecharts.registerOverlay({
    name: "polyline",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const ed = overlay.extendData || {};
      const color = ed.color || "#e8b64c";
      const size  = ed.size || 1.5;
      const figs = [];
      for (let i = 0; i < coordinates.length - 1; i++) {
        figs.push({
          type: "line",
          attrs: { coordinates: [coordinates[i], coordinates[i + 1]] },
          styles: { style: "solid", color, size, smooth: false },
        });
      }
      return figs;
    },
  });

})();
