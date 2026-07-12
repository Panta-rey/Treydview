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
})();
