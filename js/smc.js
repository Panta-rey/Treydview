// ============================================================
// TreydView — Smart Money Concepts (SMC)
// Fair Value Gaps (FVG / Imbalance) + Order Blocks (OB)
//
// Eigenständiges Modul: Erkennung als reine Funktionen (SMC.detectFVG,
// SMC.detectOrderBlocks). Das Zeichnen übernimmt app.js via smcZone-Overlay.
// Bewusst konservative Defaults, damit nicht jedes Rauschen als Zone
// markiert wird. Alle Schwellen sind über opts steuerbar.
//
// Definitionen (eine gängige SMC-Auslegung — es gibt mehrere Schulen):
//   Bullish FVG : drei Kerzen i-1,i,i+1 mit high[i-1] < low[i+1].
//                 Die Lücke [high[i-1], low[i+1]] wurde im schnellen
//                 Aufwärtsimpuls nicht gehandelt (Imbalance). Wirkt als
//                 Unterstützung, "gefüllt" sobald der Preis zurück hineinläuft.
//   Bearish FVG : high[i+1] < low[i-1]. Lücke [high[i+1], low[i-1]].
//   Bullish OB  : letzte Abwärtskerze VOR einem impulsiven Aufwärtsmove,
//                 der das Hoch dieser Kerze bricht (Displacement).
//                 Zone = Body oder High/Low der OB-Kerze.
//   Bearish OB  : letzte Aufwärtskerze vor einem impulsiven Abwärtsmove.
// ============================================================

const SMC = (function () {
  "use strict";

  const DEFAULTS = {
    // FVG
    minGapPct:      0.05,   // Mindest-Lückengrösse in % vom Preis (Rauschfilter)
    fvgFillRule:    "touch",// "touch" = erste Berührung mitigiert, "full" = ganz durchlaufen
    // Order Blocks
    obLookahead:    3,      // Kerzen für den Displacement-Move nach der OB-Kerze
    obDisplaceMult: 1.5,    // Displacement muss > obDisplaceMult * ATR sein
    obUseBody:      true,   // Zone = Kerzenbody (true) oder ganze High/Low-Spanne (false)
    atrPeriod:      14,
  };

  // ---- Hilfen ----
  function atrAt(data, i, period) {
    // Einfache ATR (Wilder-frei, gleitendes Mittel der True Range) bis Index i
    let sum = 0, n = 0;
    for (let k = Math.max(1, i - period + 1); k <= i; k++) {
      const tr = Math.max(
        data[k].high - data[k].low,
        Math.abs(data[k].high - data[k - 1].close),
        Math.abs(data[k].low  - data[k - 1].close)
      );
      sum += tr; n++;
    }
    return n ? sum / n : (data[i].high - data[i].low);
  }

  // ---------- Fair Value Gaps ----------
  function detectFVG(data, range, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const from = Math.max(1, range?.from ?? 1);
    const to   = Math.min(data.length - 1, range?.to ?? (data.length - 1));
    const out = [];

    for (let i = from; i < to; i++) {
      const a = data[i - 1], c = data[i + 1];
      if (!a || !c) continue;
      const price = data[i].close || 1;

      // Bullish FVG: Lücke zwischen a.high (unten) und c.low (oben)
      if (a.high < c.low) {
        const bottom = a.high, top = c.low;
        const gapPct = ((top - bottom) / price) * 100;
        if (gapPct >= o.minGapPct) {
          const zone = { type: "bullish", kind: "fvg", top, bottom,
                         index: i, timestamp: data[i].timestamp, gapPct };
          zone.filledIndex = firstFillFVG(data, i + 1, to + 1e9, zone, o);
          out.push(zone);
        }
      }
      // Bearish FVG: Lücke zwischen c.high (unten) und a.low (oben)
      else if (c.high < a.low) {
        const bottom = c.high, top = a.low;
        const gapPct = ((top - bottom) / price) * 100;
        if (gapPct >= o.minGapPct) {
          const zone = { type: "bearish", kind: "fvg", top, bottom,
                         index: i, timestamp: data[i].timestamp, gapPct };
          zone.filledIndex = firstFillFVG(data, i + 1, to + 1e9, zone, o);
          out.push(zone);
        }
      }
    }
    return out;
  }

  // Ab welchem Index ist die FVG gefüllt? null = offen.
  function firstFillFVG(data, startIdx, hardEnd, zone, o) {
    const end = Math.min(data.length - 1, hardEnd);
    for (let j = startIdx + 1; j <= end; j++) {
      const d = data[j];
      if (!d) break;
      if (zone.type === "bullish") {
        // Preis läuft von oben zurück in die Lücke
        if (o.fvgFillRule === "full") { if (d.low <= zone.bottom) return j; }
        else                         { if (d.low <= zone.top)    return j; }
      } else {
        if (o.fvgFillRule === "full") { if (d.high >= zone.top)    return j; }
        else                         { if (d.high >= zone.bottom) return j; }
      }
    }
    return null;
  }

  // ---------- Order Blocks ----------
  function detectOrderBlocks(data, range, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const from = Math.max(1, range?.from ?? 1);
    const to   = Math.min(data.length - 1, range?.to ?? (data.length - 1));
    const out = [];

    for (let i = from; i < to; i++) {
      const ob = data[i];
      if (!ob) continue;
      const atr = atrAt(data, i, o.atrPeriod);
      if (!(atr > 0)) continue;

      const isDown = ob.close < ob.open;
      const isUp   = ob.close > ob.open;

      // Bullish OB: Abwärtskerze, danach impulsiver Aufwärtsmove, der ob.high bricht
      if (isDown) {
        let broke = false, disp = 0;
        for (let k = i + 1; k <= Math.min(to, i + o.obLookahead); k++) {
          disp = Math.max(disp, data[k].high - ob.high);
          if (data[k].close > ob.high) { broke = true; break; }
        }
        if (broke && disp > o.obDisplaceMult * atr) {
          const top    = o.obUseBody ? Math.max(ob.open, ob.close) : ob.high;
          const bottom = o.obUseBody ? Math.min(ob.open, ob.close) : ob.low;
          const zone = { type: "bullish", kind: "ob", top, bottom,
                         index: i, timestamp: ob.timestamp };
          zone.mitigatedIndex = firstMitigationOB(data, i, to + 1e9, zone);
          out.push(zone);
        }
      }
      // Bearish OB: Aufwärtskerze, danach impulsiver Abwärtsmove, der ob.low bricht
      else if (isUp) {
        let broke = false, disp = 0;
        for (let k = i + 1; k <= Math.min(to, i + o.obLookahead); k++) {
          disp = Math.max(disp, ob.low - data[k].low);
          if (data[k].close < ob.low) { broke = true; break; }
        }
        if (broke && disp > o.obDisplaceMult * atr) {
          const top    = o.obUseBody ? Math.max(ob.open, ob.close) : ob.high;
          const bottom = o.obUseBody ? Math.min(ob.open, ob.close) : ob.low;
          const zone = { type: "bearish", kind: "ob", top, bottom,
                         index: i, timestamp: ob.timestamp };
          zone.mitigatedIndex = firstMitigationOB(data, i, to + 1e9, zone);
          out.push(zone);
        }
      }
    }
    return out;
  }

  // Ab welchem Index wird der OB erstmals wieder berührt (mitigiert)? null = offen.
  function firstMitigationOB(data, obIdx, hardEnd, zone) {
    const end = Math.min(data.length - 1, hardEnd);
    // Erst NACH dem Displacement-Move suchen (mind. 2 Kerzen später)
    for (let j = obIdx + 2; j <= end; j++) {
      const d = data[j];
      if (!d) break;
      if (zone.type === "bullish") { if (d.low  <= zone.top)    return j; }
      else                         { if (d.high >= zone.bottom) return j; }
    }
    return null;
  }

  return { DEFAULTS, detectFVG, detectOrderBlocks, atrAt };
})();

// Node-Test-Export (im Browser ignoriert)
if (typeof module !== "undefined" && module.exports) module.exports = SMC;
