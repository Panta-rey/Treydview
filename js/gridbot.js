// ============================================================
// TreydView — Futures Grid Bot
//
// Portierung der Logik aus Cockpit.xlsx. Zellbezüge stehen an jeder
// Funktion, damit die Herkunft nachvollziehbar bleibt — das Excel
// bleibt die lesbare Referenz.
//
// Kern in drei Schritten:
//   1. Konfluenz  -> Roh-Bias aus Trend + Derivaten
//   2. Extremfilter -> überschreibt den Bias bei RSI/F&G-Extremen
//   3. Tiers      -> Grid-Dimensionierung je Laufzeit
// ============================================================

const GridBot = (function () {
  "use strict";

  // Schwellwerte. Im Panel editierbar — nicht hier ändern, sondern
  // über setThresholds(), damit die UI die Quelle bleibt.
  //
  // Herkunft: aus dem Excel-Cockpit übernommen. RSI 25/75 und F&G 15/85
  // sind bewusst enger als die üblichen 30/70 bzw. 20/80. Die Funding-
  // Schwellen sind asymmetrisch (Faktor 5) — verteidigbar, weil BTC-
  // Funding historisch überwiegend positiv ist und negatives Funding
  // deshalb das seltenere, aussagekräftigere Signal darstellt.
  // OI ±10 und L/S 0.45/0.55 sind runde Zahlen und am ehesten
  // Kandidaten für eine Häufigkeitsprüfung.
  const DEFAULT_THRESHOLDS = {
    rsiOversold:    25,
    rsiOverbought:  75,
    fngOversold:    15,
    fngOverbought:  85,
    fundingLong:    -0.01,   // Funding 8h % darunter -> +1 (Shorts zahlen)
    fundingShort:    0.05,   // darüber -> -1 (Longs zahlen teuer)
    oiChangeHigh:    10,     // OI Δ30T % darüber -> Hebel-Aufbau
    oiChangeLow:    -10,     // darunter -> Hebel bereinigt
    lsLongCrowded:   0.55,   // L/S darüber bei OI-Aufbau -> Long-Squeeze-Risiko
    lsShortCrowded:  0.45,   // darunter -> Short-Squeeze-Fuel
    biasThreshold:   2,      // |Trend+Derivat| >= 2 -> Richtung
  };

  let TH = { ...DEFAULT_THRESHOLDS };
  function setThresholds(t) { TH = { ...DEFAULT_THRESHOLDS, ...t }; }
  function getThresholds()  { return { ...TH }; }

  // Tier-Voreinstellungen (Cockpit Zeilen 31-34)
  const DEFAULT_TIERS = [
    { id: "short", label: "Kurzfrist", horizon: "1–7 Tage",    gridType: "Arithmetisch", atrKey: "atr14",  factor: 1.5, targetProfit: 0.8, leverageCap: 2 },
    { id: "swing", label: "Swing",     horizon: "1–8 Wochen",  gridType: "Arithmetisch", atrKey: "atr90",  factor: 3.5, targetProfit: 1.5, leverageCap: 3 },
    { id: "macro", label: "Makro",     horizon: "3–12 Monate", gridType: "Geometrisch",  atrKey: "atr200", factor: 5.5, targetProfit: 2.0, leverageCap: 2 },
  ];

  // ---------- 1. Konfluenz ----------

  // Cockpit E4: =IF(B11>B12,1,-1)+IF(B11>B13,1,-1)
  // Preis über SMA50 und SMA200 -> je +1, sonst je -1. Bereich -2..+2.
  function trendScore(price, sma50, sma200) {
    if (price == null || sma50 == null || sma200 == null) return null;
    return (price > sma50 ? 1 : -1) + (price > sma200 ? 1 : -1);
  }

  // Cockpit E22: OI-Interpretation aus OI-Änderung und L/S-Verhältnis.
  // Die Logik dahinter: steigendes OI heisst Hebelaufbau. Wer dabei in
  // der Mehrheit ist, ist das Futter für den Squeeze in die Gegenrichtung.
  function oiInterpretation(oiChange30, lsRatio) {
    if (oiChange30 == null) return { text: "–", score: 0 };
    if (oiChange30 < TH.oiChangeLow) {
      return { text: "🟢 Hebel bereinigt (gesunder Boden)", score: 0 };
    }
    if (oiChange30 > TH.oiChangeHigh) {
      if (lsRatio == null) return { text: "🟠 Hebel-Aufbau", score: 0 };
      if (lsRatio >= TH.lsLongCrowded)  return { text: "🔴 Long-Squeeze-Risiko",  score: -1 };
      if (lsRatio <= TH.lsShortCrowded) return { text: "🔥 Short-Squeeze-Fuel",   score:  1 };
      return { text: "🟠 Hebel-Aufbau (Kampfzone)", score: 0 };
    }
    return { text: "🟡 Neutral / Range", score: 0 };
  }

  // Cockpit E5: Funding-Term + OI/LS-Term
  function derivativeScore(funding8h, oiInterp) {
    let s = 0;
    if (funding8h != null) {
      if (funding8h < TH.fundingLong)       s += 1;   // Shorts zahlen = Long-Squeeze-Fuel
      else if (funding8h > TH.fundingShort) s -= 1;   // Longs zahlen teuer
    }
    s += oiInterp?.score || 0;
    return s;
  }

  // Cockpit E6: Extremfilter. Der klügste Teil des Cockpits — er sticht
  // den Bias. Kein Short in die Kapitulation, kein Long in die Euphorie,
  // egal was die Konfluenz sagt.
  function extremeFilter(rsi, fng) {
    const os = (rsi != null && rsi <= TH.rsiOversold)   || (fng != null && fng <= TH.fngOversold);
    const ob = (rsi != null && rsi >= TH.rsiOverbought) || (fng != null && fng >= TH.fngOverbought);
    if (os) return "Überverkauft";
    if (ob) return "Überkauft";
    return "—";
  }

  // Cockpit E7 (Roh-Bias) und B5 (finaler Bias nach Filter)
  function computeBias(tScore, dScore, extreme) {
    const sum = (tScore || 0) + (dScore || 0);
    const raw = sum >= TH.biasThreshold ? "Long" : sum <= -TH.biasThreshold ? "Short" : "Neutral";
    const final = (extreme === "Überverkauft" || extreme === "Überkauft") ? "Neutral" : raw;
    return { raw, final, sum };
  }

  // Cockpit B6 / B7
  function regimeText(extreme, marketContext) {
    if (extreme === "Überverkauft") return "⚠️ Überverkauft / Kapitulation — kein Short, Mean-Reversion-Risiko";
    if (extreme === "Überkauft")    return "⚠️ Überhitzt / Euphorie — kein Long";
    return marketContext || "—";
  }

  function warningText(oiInterp, fundingMonthly) {
    if (oiInterp?.text === "🔴 Long-Squeeze-Risiko") return "🚨 Long-Squeeze-Risiko: scharfer Rücksetzer möglich";
    if (oiInterp?.text === "🔥 Short-Squeeze-Fuel")  return "🔥 Short-Squeeze-Treibstoff: Spike nach oben möglich";
    if (fundingMonthly != null && Math.abs(fundingMonthly) > 3) {
      return `⚠️ Hohe Funding-Kosten (~${fundingMonthly.toFixed(1)}%/Monat) — je nach Seite`;
    }
    return "✅ Keine akuten Warnungen";
  }

  // ---------- 2. Tier-Berechnung ----------
  //
  // Cockpit B37-B46. Die Reihenfolge ist die eigentliche Logik:
  // Range aus ATR -> Hebel aus Range -> Stop aus ATR -> Size aus Risiko
  // und Stop-Distanz. Der Hebel ist eine Folge der Grid-Breite, nicht
  // eine freie Wahl. Die Grösse folgt aus dem Risiko, nicht umgekehrt.
  function computeTier(tier, ctx) {
    const { price, atr, bias, capital, riskPct, feePct, fundingMonthly } = ctx;
    if (price == null || atr == null || atr <= 0) return null;

    const f = tier.factor;
    const atrFrac = atr / 100;

    // B37/B38: Range = Preis ∓ ATR% × Faktor
    const lower = Math.round(price * (1 - atrFrac * f));
    const upper = Math.round(price * (1 + atrFrac * f));

    // B39: Hebel = MAX(1, MIN(Cap, ABRUNDEN(1 / (ATR%×Faktor))))
    // 1/Breite: je weiter das Grid, desto weniger Hebel ist tragbar.
    const leverage = Math.max(1, Math.min(tier.leverageCap, Math.floor(1 / (atrFrac * f))));

    // B40: Grids = Range-Breite / (Ziel-Profit + Gebühr), gedeckelt 10..200
    const grids = Math.max(10, Math.min(200,
      Math.round((upper - lower) / price / (tier.targetProfit / 100 + feePct / 100))));

    // B41: Stop = halber ATR-Puffer hinter der Range
    const stopLoss = bias === "Short"
      ? Math.round(upper * (1 + atrFrac * 0.5))
      : Math.round(lower * (1 - atrFrac * 0.5));

    // B42: Take Profit nur bei gerichtetem Grid
    const takeProfit = bias === "Long" ? upper : bias === "Short" ? lower : null;

    // B43: Funding-Drag — Longs zahlen bei positivem Funding, Shorts kassieren
    const fundingDrag = fundingMonthly == null ? 0
      : bias === "Long" ? Math.round(fundingMonthly * 100) / 100
      : bias === "Short" ? Math.round(-fundingMonthly * 100) / 100
      : 0;

    // B44: Size = MIN(Kapital, (Kapital × Risiko%) / (Stop-Distanz in %))
    const stopDist = Math.abs(price - stopLoss) / price;
    const positionSize = stopDist > 0
      ? Math.min(capital, Math.round((capital * riskPct / 100) / stopDist))
      : 0;

    // B45
    const effective = positionSize * leverage;

    // B46: Liegt der Stop vor dem Liquidationspreis?
    // Liquidation grob bei 1/Hebel Abstand — bei 2× also 50%.
    let safety;
    if (bias === "Short")      safety = stopLoss < price * (1 + 1 / leverage) ? "✅ SL vor Liq" : "❌ Liq vor SL";
    else if (bias === "Long")  safety = stopLoss > price * (1 - 1 / leverage) ? "✅ SL vor Liq" : "❌ Liq vor SL";
    else                       safety = "ℹ️ Neutral-Grid";

    return {
      ...tier,
      atrPct: atr,
      direction: bias,
      lower, upper, leverage, grids, stopLoss, takeProfit,
      fundingDrag, positionSize, effective, safety,
      gridStep: Math.round((upper - lower) / grids),
    };
  }

  // ---------- 3. Alles zusammen ----------
  //
  // market: { price, sma50, sma200, rsi, atr14, atr90, atr200, volumeSignal, marketContext }
  // deriv:  Ergebnis von Derivatives.fetchAll()
  // opts:   { capital, riskPct, feePct, tiers }
  function compute(market, deriv, opts = {}) {
    const capital = opts.capital ?? 8000;
    const riskPct = opts.riskPct ?? 1;
    const feePct  = opts.feePct  ?? 0.1;
    const tiers   = opts.tiers   ?? DEFAULT_TIERS;

    const funding8h      = deriv?.funding?.fundingNow ?? null;
    const fundingMonthly = deriv?.funding?.fundingMonthly ?? null;
    const oiChange30     = deriv?.oi?.oiChange30 ?? null;
    const lsRatio        = deriv?.ls?.lsRatio ?? null;
    const fng            = deriv?.fng?.fngNow ?? null;

    const tScore   = trendScore(market.price, market.sma50, market.sma200);
    const oiInterp = oiInterpretation(oiChange30, lsRatio);
    const dScore   = derivativeScore(funding8h, oiInterp);
    const extreme  = extremeFilter(market.rsi, fng);
    const bias     = computeBias(tScore, dScore, extreme);

    const ctx = { price: market.price, bias: bias.final, capital, riskPct, feePct, fundingMonthly };
    const rows = tiers.map(t => computeTier(t, { ...ctx, atr: market[t.atrKey] })).filter(Boolean);

    const headline = bias.final === "Long"  ? "🟢 LONG-GRID — Aufwärts-Bias"
                   : bias.final === "Short" ? "🔴 SHORT-GRID — Abwärts-Bias"
                   : "🟡 NEUTRAL-GRID — Seitwärts-Range";

    return {
      headline,
      bias: bias.final,
      rawBias: bias.raw,
      confluence: { trendScore: tScore, derivativeScore: dScore, sum: bias.sum, extreme },
      regime:  regimeText(extreme, market.marketContext),
      warning: warningText(oiInterp, fundingMonthly),
      oiInterpretation: oiInterp.text,
      market: {
        price: market.price, sma50: market.sma50, sma200: market.sma200,
        sma200Dist: market.sma200 ? ((market.price - market.sma200) / market.sma200) * 100 : null,
        rsi: market.rsi, atr14: market.atr14, atr90: market.atr90, atr200: market.atr200,
        volumeSignal: market.volumeSignal,
      },
      derivatives: {
        fng, fngLabel: deriv?.fng?.fngLabel ?? null,
        fngAvg30: deriv?.fng?.fngAvg30 ?? null, fngAvg90: deriv?.fng?.fngAvg90 ?? null,
        funding8h, fundingMonthly,
        fundingAvg30: deriv?.funding?.fundingAvg30 ?? null,
        oiNow: deriv?.oi?.oiNow ?? null, oiChange30, oiChange90: deriv?.oi?.oiChange90 ?? null,
        lsRatio,
      },
      tiers: rows,
      inputs: { capital, riskPct, feePct },
      missing: deriv?.errors || [],
    };
  }

  return {
    compute, computeTier,
    trendScore, derivativeScore, oiInterpretation, extremeFilter, computeBias,
    setThresholds, getThresholds,
    DEFAULT_THRESHOLDS, DEFAULT_TIERS,
  };
})();

if (typeof window !== "undefined") window.GridBot = GridBot;
if (typeof module !== "undefined" && module.exports) module.exports = GridBot;
