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
  // Zwei Punkte spannen einen Zeitbereich auf; darin wird das Volumen
  // pro Preis-Row berechnet und als Histogramm gezeichnet.
  // Chart-Daten kommen über window.__tvGetDataList (in app.js gesetzt).
  klinecharts.registerOverlay({
    name: "frvp",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis, yAxis }) => {
      if (coordinates.length < 2) return [];
      const getData = (typeof window !== "undefined" && window.__tvGetDataList) ? window.__tvGetDataList : null;
      if (!getData) return [];
      const dataList = getData();
      if (!dataList || dataList.length === 0) return [];

      const p0 = overlay.points[0], p1 = overlay.points[1];
      const tStart = Math.min(p0.timestamp, p1.timestamp);
      const tEnd   = Math.max(p0.timestamp, p1.timestamp);

      // Candles im Zeitbereich sammeln
      const slice = dataList.filter(d => d.timestamp >= tStart && d.timestamp <= tEnd);
      if (slice.length < 2) return [];

      const rows = (overlay.extendData && overlay.extendData.rows) || 150;
      const vaPct = (overlay.extendData && overlay.extendData.valueArea) || 70;
      const widthPct = (overlay.extendData && overlay.extendData.width) || 30;

      let pMin = Infinity, pMax = -Infinity;
      for (const d of slice) { if (d.low < pMin) pMin = d.low; if (d.high > pMax) pMax = d.high; }
      const rowH = (pMax - pMin) / rows;
      if (rowH === 0) return [];

      const upVol = new Float64Array(rows), downVol = new Float64Array(rows);
      for (const d of slice) {
        const vol = d.volume || 0, isUp = d.close >= d.open;
        const rLow = Math.max(0, Math.floor((d.low - pMin) / rowH));
        const rHigh = Math.min(rows - 1, Math.floor((d.high - pMin) / rowH));
        const n = rHigh - rLow + 1;
        for (let r = rLow; r <= rHigh; r++) {
          if (isUp) upVol[r] += vol / n; else downVol[r] += vol / n;
        }
      }
      const totalVol = upVol.map((u, i) => u + downVol[i]);
      const maxVol = Math.max(...totalVol.filter(v => v > 0));
      if (!(maxVol > 0)) return [];
      const pocRow = totalVol.indexOf(Math.max(...totalVol));
      const pocPrice = pMin + (pocRow + 0.5) * rowH;

      // Pixel-Koordinaten
      const xLeft = Math.min(coordinates[0].x, coordinates[1].x);
      const xRight = Math.max(coordinates[0].x, coordinates[1].x);
      const boxWidth = xRight - xLeft;
      const maxBarW = boxWidth * (widthPct / 100);

      const figures = [];
      // Rahmen der Box
      figures.push({
        type: "rect",
        attrs: { x: xLeft, y: Math.min(coordinates[0].y, coordinates[1].y), width: boxWidth, height: Math.abs(coordinates[1].y - coordinates[0].y) },
        styles: { style: "stroke", borderColor: "rgba(232,182,76,0.5)", borderSize: 1 },
        ignoreEvent: true,
      });

      // Histogramm-Balken (Placement: Left — wachsen von xLeft nach rechts)
      for (let r = 0; r < rows; r++) {
        const tot = totalVol[r];
        if (tot === 0) continue;
        const pb = pMin + r * rowH, pt = pb + rowH;
        const yb = yAxis.convertToPixel(pb), yt = yAxis.convertToPixel(pt);
        const yTop = Math.min(yb, yt), yH = Math.max(1, Math.abs(yt - yb));
        const upW = (upVol[r] / maxVol) * maxBarW;
        const downW = (downVol[r] / maxVol) * maxBarW;
        const isPoc = Math.abs((pb + pt) / 2 - pocPrice) < rowH;
        // Up (grün) unten, Down (rot) darüber gestapelt
        if (upW > 0) figures.push({
          type: "rect",
          attrs: { x: xLeft, y: yTop, width: upW, height: yH },
          styles: { style: "fill", color: isPoc ? "rgba(232,182,76,0.7)" : "rgba(63,182,139,0.55)" },
          ignoreEvent: true,
        });
        if (downW > 0) figures.push({
          type: "rect",
          attrs: { x: xLeft + upW, y: yTop, width: downW, height: yH },
          styles: { style: "fill", color: isPoc ? "rgba(232,182,76,0.7)" : "rgba(208,94,94,0.55)" },
          ignoreEvent: true,
        });
      }
      return figures;
    },
  });
})();
