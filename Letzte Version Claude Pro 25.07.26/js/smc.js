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
    // minGapAtr: Lückengrösse relativ zur ATR (statt fixem % vom Preis).
    // 0.05 % vom Preis filtert bei ruhigem Markt kaum, im Ausverkauf gar nicht —
    // weil die Schwelle bei 60k BTC 30 USD ist, aber die ATR 3000 USD.
    // 0.1 × ATR bedeutet: die Lücke muss mindestens 10 % einer normalen
    // Tagesrange sein — gleich sensitiv bei 20k und 100k.
    minGapAtr:      0.1,    // Lücke muss > minGapAtr × ATR sein
    fvgFillRule:    "touch",// "touch" = erste Berührung mitigiert, "full" = ganz durchlaufen
    // Order Blocks
    // lastCandleOnly: Nur die LETZTE Gegenkerze vor dem Impuls ist der OB.
    // SMC-Definition ist eindeutig: drei aufeinanderfolgende Abwärtskerzen
    // vor einem Aufwärtsimpuls ergeben EINEN OB (die letzte), nicht drei.
    // false = bisheriges Verhalten (alle Gegenkerzen im Lookahead).
    lastCandleOnly: true,
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

      // Bullish FVG: Lücke zwischen a.high (unten) und c.low (oben)
      if (a.high < c.low) {
        const bottom = a.high, top = c.low;
        const atr = atrAt(data, i, o.atrPeriod);
        if (atr > 0 && (top - bottom) >= o.minGapAtr * atr) {
          const zone = { type: "bullish", kind: "fvg", top, bottom,
                         index: i, timestamp: data[i].timestamp,
                         gapAtr: (top - bottom) / atr };
          zone.filledIndex = firstFillFVG(data, i + 1, to + 1e9, zone, o);
          out.push(zone);
        }
      }
      // Bearish FVG: Lücke zwischen c.high (unten) und a.low (oben)
      else if (c.high < a.low) {
        const bottom = c.high, top = a.low;
        const atr = atrAt(data, i, o.atrPeriod);
        if (atr > 0 && (top - bottom) >= o.minGapAtr * atr) {
          const zone = { type: "bearish", kind: "fvg", top, bottom,
                         index: i, timestamp: data[i].timestamp,
                         gapAtr: (top - bottom) / atr };
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

      // Bullish OB: Abwärtskerze, danach impulsiver Aufwärtsmove, der ob.high bricht.
      // lastCandleOnly: Ist die nächste Kerze ebenfalls eine Abwärtskerze, dann ist
      // DIESE Kerze nicht die letzte vor dem Impuls → überspringen.
      // So erfüllt der Code die SMC-Definition: drei aufeinanderfolgende Abwärtskerzen
      // erzeugen EINEN OB (die letzte), nicht drei.
      if (isDown) {
        // Wenn lastCandleOnly und die nächste Kerze ist ebenfalls abwärts → kein OB hier
        if (o.lastCandleOnly && i + 1 <= to && data[i + 1] &&
            data[i + 1].close < data[i + 1].open) continue;

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
      // Bearish OB: Aufwärtskerze, danach impulsiver Abwärtsmove, der ob.low bricht.
      else if (isUp) {
        // Wenn lastCandleOnly und die nächste Kerze ist ebenfalls aufwärts → kein OB hier
        if (o.lastCandleOnly && i + 1 <= to && data[i + 1] &&
            data[i + 1].close > data[i + 1].open) continue;

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

  // ---------- Nullmodell-Vergleich ----------
  // Portiert aus patterns.js: Vergleicht die Zonen-Basisrate auf echten Daten
  // gegen block-permutierte Zufallsdaten (gleiche Volatilitäts-Cluster,
  // zerstörte Marktstruktur). Beantwortet: Erkennt der Detektor echte
  // Marktstruktur, oder nur Rauschen mit SMC-Vokabular?
  //
  // Aufruf im Browser: SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))
  function nullTest(data, opts, runs, blockLen) {
    runs = runs || 20; blockLen = blockLen || 20;
    if (!data || data.length < 50) return Promise.resolve({ note: "Zu wenig Daten (min. 50 Bars)" });
    const range = { from: 1, to: data.length - 1 };
    const realFVG   = detectFVG(data, range, opts).length;
    const realOB    = detectOrderBlocks(data, range, opts).length;
    const realTotal = realFVG + realOB;
    const rets = [];
    for (let i = 1; i < data.length; i++)
      rets.push(Math.log(data[i].close / data[i - 1].close));
    const nullCounts = [];
    for (let r = 0; r < runs; r++) {
      const shuffled = [];
      while (shuffled.length < rets.length) {
        const start = Math.floor(Math.random() * Math.max(1, rets.length - blockLen));
        shuffled.push(...rets.slice(start, start + blockLen));
      }
      shuffled.length = rets.length;
      let p = data[0].close;
      const synth = [Object.assign({}, data[0])];
      for (let i = 0; i < shuffled.length; i++) {
        const prev = p;
        p *= Math.exp(shuffled[i]);
        synth.push({ timestamp: data[i+1].timestamp, open: prev,
          high: Math.max(prev, p)*1.002, low: Math.min(prev, p)*0.998, close: p, volume: 1 });
      }
      nullCounts.push(detectFVG(synth, range, opts).length + detectOrderBlocks(synth, range, opts).length);
    }
    const avg    = nullCounts.reduce(function(s,x){ return s+x; }, 0) / nullCounts.length;
    const better = nullCounts.filter(function(x){ return x <= realTotal; }).length;
    const pValue = Math.round((1 - better / nullCounts.length) * 1000) / 1000;
    return Promise.resolve({
      real:  { fvg: realFVG, ob: realOB, total: realTotal },
      null:  { avgTotal: Math.round(avg * 10) / 10, runs: runs },
      ratio: Math.round((realTotal / (avg || 1)) * 100) / 100,
      pValue: pValue,
      interpretation: pValue < 0.05
        ? "✅ Mehr Zonen als Zufall (p=" + pValue + ") — reagiert auf Marktstruktur"
        : "⚠️ Nicht signifikant (p=" + pValue + ") — Basisrate prüfen",
    });
  }

  return { DEFAULTS, detectFVG, detectOrderBlocks, atrAt, nullTest };
})();

// Node-Test-Export (im Browser ignoriert)
if (typeof module !== "undefined" && module.exports) module.exports = SMC;
