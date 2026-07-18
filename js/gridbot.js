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
  // ============================================================
  // ZYKLUS-SCHWELLEN — FEST, NICHT EINSTELLBAR
  //
  // Aus BTCUSDT_Dashboard_Claude.xlsx, Parameter-Referenz:
  //   "Schwellen nie direkt ändern (fest in Formel).
  //    Aggressivität über Profil (I16) steuern."
  //
  // Der Grund steht ebenfalls dort: Mayer < 0.9 "traf jeden BTC-
  // Akkumulations-Boden seit 2015". Eine Schwelle, die zehn Jahre
  // gehalten hat, ist kein Regler. Wer sie hochdreht, wenn "Defensiv"
  // erscheint, senkt nicht das Risiko — nur die Warnung.
  // ============================================================
  const CYCLE = Object.freeze({
    mayerCheap:      0.9,    // darunter + Angst -> Akkumulationszone
    mayerExpensive:  2.0,    // darüber -> Defensiv (2.4 wäre hist. Extrem)
    mayerBullish:    1.0,    // darunter -> konstruktiver Aufschwung
    fngFear:        35,      // darunter -> Angst
    fngGreed:       80,      // darüber -> Gier, Defensiv
    erTrend:         0.5,    // ab hier Trend -> Grid riskant
    erRange:         0.3,    // darunter saubere Range
    minNetPerGrid:   0.15,   // Ziel-Profit minus Gebühr, Praxis-Untergrenze
  });

  // ============================================================
  // RISIKO-PROFIL — EIN Schalter statt drei Zahlen (Excel I16)
  // Steuert Hebel-Cap (I17), Risiko-Budget (I12) und Gap-Puffer (I13).
  // ============================================================
  const PROFILES = Object.freeze({
    Konservativ:   { leverageCap: 1, riskBudget: 1, gapBuffer: 8 },
    Moderat:       { leverageCap: 2, riskBudget: 2, gapBuffer: 5 },
    Risikofreudig: { leverageCap: 3, riskBudget: 3, gapBuffer: 3 },
  });

  // Frei einstellbar: dein Setup, keine Marktannahmen (Excel Spalte I)
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

    // Setup-Werte (Excel I1/I2/I7/I8/I10/I11/I14)
    feeRoundtrip:    0.1,    // I2  Gebühr Roundtrip %
    stakePct:      100,      // I7  Einsatz % vom Kapital
    fillsPerGrid:    2,      // I8  Füllungen je Grid/Monat (Schätzung)
    maintMargin:     0.5,    // I10 Maintenance Margin %
    slippageBuf:     0.3,    // I11 Slippage-Puffer Liq %
    calibration:     1,      // I14 Kalibrierungsfaktor (aus dem Journal)
  };

  let TH = { ...DEFAULT_THRESHOLDS };
  function setThresholds(t) { TH = { ...DEFAULT_THRESHOLDS, ...t }; }
  function getThresholds()  { return { ...TH }; }

  let PROFILE = "Moderat";
  function setProfile(p) { if (PROFILES[p]) PROFILE = p; }
  function getProfile()  { return PROFILE; }
  function profileValues() { return { ...PROFILES[PROFILE], name: PROFILE }; }

  // Tier-Voreinstellungen (Cockpit Zeilen 31-34)
  const DEFAULT_TIERS = [
    // holdDays: Haltedauer aus dem Dashboard (Z4) — Grundlage für Funding-Kosten
    { id: "short", label: "Kurzfrist", horizon: "1–7 Tage",    gridType: "Arithmetisch", atrKey: "atr14",  factor: 1.5, targetProfit: 0.8, leverageCap: 3,  holdDays: 7 },
    { id: "swing", label: "Swing",     horizon: "1–8 Wochen",  gridType: "Arithmetisch", atrKey: "atr90",  factor: 3.5, targetProfit: 1.4, leverageCap: 3,  holdDays: 30 },
    { id: "macro", label: "Makro",     horizon: "3–12 Monate", gridType: "Geometrisch",  atrKey: "atr200", factor: 5.5, targetProfit: 2.0, leverageCap: 10, holdDays: 180 },
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
    const prof = PROFILES[PROFILE];

    // B37/B38: Range = Preis ∓ ATR% × Faktor
    const lower = Math.round(price * (1 - atrFrac * f));
    const upper = Math.round(price * (1 + atrFrac * f));

    // B39/B27: Hebel = MAX(1, MIN(Bot-Cap, Profil-Cap, ABRUNDEN(1/Stopdistanz)))
    // 1/Breite: je weiter das Grid, desto weniger Hebel ist tragbar.
    // Maintenance Margin und Slippage kommen dazu (Excel I10 + I11) — sonst
    // liegt der Liquidationspreis näher als gerechnet.
    const levDist = atrFrac * f + TH.maintMargin / 100 + TH.slippageBuf / 100;
    let leverage = Math.max(1, Math.min(tier.leverageCap, prof.leverageCap, Math.floor(1 / levDist)));

    // HEBEL-LEITPLANKE (Excel B27, äusserer MIN-Wrapper)
    //
    // Bei Mayer > 2 oder FNG > 80 wird der Hebel zwingend auf 1× gedeckelt —
    // unabhängig von Profil und Bot-Cap. Der Market-Wizards-Schutz: in
    // Euphorien darf kein Risikoprofil vollen Hebel rechtfertigen.
    const guardActive = (ctx.mayer != null && ctx.mayer > CYCLE.mayerExpensive)
                     || (ctx.fng   != null && ctx.fng   > CYCLE.fngGreed);
    if (guardActive) leverage = 1;

    // B40: Grids = Range-Breite / (Ziel-Profit + Gebühr), gedeckelt 10..200
    const grids = Math.max(10, Math.min(200,
      Math.round((upper - lower) / price / (tier.targetProfit / 100 + feePct / 100))));

    // B41: Stop = halber ATR-Puffer hinter der Range
    const stopLoss = bias === "Short"
      ? Math.round(upper * (1 + atrFrac * 0.5))
      : Math.round(lower * (1 - atrFrac * 0.5));

    // B42: Take Profit nur bei gerichtetem Grid
    const takeProfit = bias === "Long" ? upper : bias === "Short" ? lower : null;

    // B26: Positionsgrösse = MIN(Einsatz-Decke, Risiko-Budget / (Hebel × (Stopdistanz + Gap-Puffer)))
    // Das Gap-Puffer (Profil) fängt Kurslücken ab, gegen die ein Stop nicht schützt.
    // B43: Funding-Drag — Longs zahlen bei positivem Funding, Shorts kassieren
    const fundingDrag = fundingMonthly == null ? 0
      : bias === "Long" ? Math.round(fundingMonthly * 100) / 100
      : bias === "Short" ? Math.round(-fundingMonthly * 100) / 100
      : 0;

    // B26/B44: Size = MIN(Einsatz-Decke, Risiko-Budget / (Hebel × (Stopdistanz + Gap-Puffer)))
    //
    // Zwei Änderungen gegenüber vorher, beide aus dem Dashboard:
    //  - Risiko-Budget kommt aus dem PROFIL (I12), nicht aus einem freien Feld
    //  - Gap-Puffer (I13) fängt Kurslücken ab, gegen die ein Stop nicht schützt
    const stopDist = Math.abs(price - stopLoss) / price;
    const risk = riskPct != null ? riskPct : prof.riskBudget;
    const stakeCap = capital * TH.stakePct / 100;
    const denom = Math.min(1, leverage * (stopDist + prof.gapBuffer / 100));
    const positionSize = denom > 0
      ? Math.round(Math.min(stakeCap, (capital * risk / 100) / denom))
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

  // ============================================================
  // GRID-EIGNUNG (Excel B37)
  // Der ER sagt, ob Grid überhaupt das richtige Werkzeug ist.
  // Ein Grid-Bot verdient am Pendeln — im Trend gibt es nichts zu ernten.
  // ============================================================
  function gridSuitability(er) {
    if (er == null) return { label: "—", state: "unknown", ok: false };
    if (er >= CYCLE.erTrend) return { label: "🔴 Trend – Grid riskant", state: "trend", ok: false };
    if (er >= CYCLE.erRange) return { label: "🟡 Übergang", state: "mixed", ok: false };
    return { label: "🟢 Range (ideal)", state: "range", ok: true };
  }

  // ============================================================
  // EMPFEHLUNG (Excel B39/B40) — Zyklus-Kalibrierung nach Marks
  //
  // Fragt NICHT "welcher Bot hat den besten Score", sondern "wo stehen
  // wir im Zyklus, und welche Risikohaltung ist angemessen".
  // Der GridScore fliesst bewusst NICHT ein — er bleibt reine Anzeige
  // der Mechanik-Qualität.
  // ============================================================
  function recommendation(mayer, fng, er, suit) {
    const m = mayer, f = fng;
    if (m == null || f == null) {
      return { label: "🟡 Daten fehlen", why: "Mayer oder Fear&Greed nicht verfügbar.", tier: null, stage: "unknown" };
    }
    const mt = m.toFixed(2);

    // 1. Defensiv: teuer UND/ODER gierig
    if (m > CYCLE.mayerExpensive || f > CYCLE.fngGreed) {
      return {
        label: "⛔ Defensiv – kein neuer Bot, Gewinne sichern",
        why: `Mayer ${mt} / FNG ${f}: teuer + gierig – defensiv (Marks). Hebel-Leitplanke zwingt jeden Bot auf 1×.`,
        tier: null, stage: "defensive",
      };
    }

    // 2. Akkumulation: billig UND Angst
    if (m < CYCLE.mayerCheap && f < CYCLE.fngFear) {
      if (er != null && er >= CYCLE.erTrend) {
        // Der wichtigste Fall: These sagt kaufen, Struktur sagt kein Grid.
        // Beides stimmt — für verschiedene Werkzeuge.
        return {
          label: "🟢 Akkumulation per Spot/DCA – Grid erst bei Range",
          why: `Mayer ${mt}, Angst, aber Trend (ER ${er.toFixed(2)}): Spot kaufen, Bot wartet auf Range.`,
          tier: null, stage: "accumulate-spot",
        };
      }
      return {
        label: "🟢 Makro-Long Bot C – Akkumulation",
        why: `Mayer ${mt} + Angst + Range: bestes Setup für Makro-Grid.`,
        tier: "macro", stage: "accumulate-grid",
      };
    }

    // 3. Kein Makro-Extrem, aber saubere Range
    if (suit && suit.state === "range") {
      return {
        label: "⚡ Kurzfrist Bot A – Range, neutral spielen",
        why: "ER tief: kurzes Pendeln ohne Richtungswette.",
        tier: "short", stage: "range",
      };
    }

    // 4. Konstruktiver Aufschwung
    if (m < CYCLE.mayerBullish) {
      return {
        label: "🔵 Long-Bias Bot B – gerichtet mit Grid",
        why: `Mayer ${mt}: Aufschwung – Grid mit Long-Bias.`,
        tier: "swing", stage: "long-bias",
      };
    }

    // 5. Nichts davon
    return {
      label: "🟡 Beobachten – kein klares Setup",
      why: "Kein Extrem, keine Range – warten. Nichtstun ist eine vollwertige Entscheidung.",
      tier: null, stage: "wait",
    };
  }

  // ============================================================
  // VIABILITÄT (Excel B45–B48)
  // Bringt das Grid mehr ein, als Funding und Gebühren kosten?
  // ============================================================
  function viability(tier, lev, direction, holdDays, fundingAvg8h) {
    // B45: Funding-Kosten % — Neutral zahlt netto nichts
    const sign = direction === "Neutral" ? 0 : (direction.startsWith("Short") ? -1 : 1);
    const fundingCost = sign * lev * (fundingAvg8h || 0) * holdDays * 3;

    // B46: Grid-Ertrag % = Füllungen/Monat × Tage/30 × Netto-Profit × Hebel × Kalibrierung
    const netPerGrid = tier.targetProfit - TH.feeRoundtrip;
    const gridYield = (TH.fillsPerGrid * holdDays / 30) * netPerGrid * lev * TH.calibration;

    const net = gridYield - fundingCost;
    return {
      fundingCost: Math.round(fundingCost * 10) / 10,
      gridYield:   Math.round(gridYield * 10) / 10,
      net:         Math.round(net * 10) / 10,
      ok:          net > 0,
      label:       net > 0 ? "✅ Ertrag > Kosten" : "⚠️ Funding/Gebühr frisst Ertrag",
      // Praxis-Schwelle aus der Q&A: darunter fressen Gebühren den Ertrag
      netPerGrid:  Math.round(netPerGrid * 100) / 100,
      netPerGridOk: netPerGrid >= CYCLE.minNetPerGrid,
    };
  }

  function compute(market, deriv, opts = {}) {
    const capital = opts.capital ?? 8000;
    // null (nicht 1!) — sonst überschreibt der Default das Risiko-Budget
    // des Profils und alle drei Profile rechnen mit demselben Wert.
    const riskPct = opts.riskPct ?? null;
    const feePct  = opts.feePct  ?? TH.feeRoundtrip;
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

    // Zyklus-Ebene (Excel F13/F19): Mayer sagt WO wir stehen, der ER sagt
    // OB ein Grid überhaupt das richtige Werkzeug ist.
    const mayer = market.mayer ?? null;
    const er    = market.er    ?? null;
    const suit  = gridSuitability(er);
    const rec   = recommendation(mayer, fng, er, suit);

    const ctx = { price: market.price, bias: bias.final, capital, riskPct, feePct,
                  fundingMonthly, mayer, fng };
    const rows = tiers.map(t => {
      const row = computeTier(t, { ...ctx, atr: market[t.atrKey] });
      if (!row) return null;
      // B45–B48: lohnt sich das Grid nach Funding und Gebühren überhaupt?
      // WICHTIG: viability erwartet die 8h-RATE (rechnet selbst × Tage × 3).
      // fundingAvg30 aus derivatives.js ist bereits auf den MONAT hochgerechnet
      // (× 90) — direkte Übergabe wäre Faktor 90 zu hoch und liesse jede
      // gerichtete Position massiv unrentabel aussehen.
      const avg8h = deriv?.funding?.fundingAvg30 != null
        ? deriv.funding.fundingAvg30 / 90
        : funding8h;
      row.viability = viability(t, row.leverage, bias.final, t.holdDays || 30, avg8h);
      return row;
    }).filter(Boolean);

    const headline = bias.final === "Long"  ? "🟢 LONG-GRID — Aufwärts-Bias"
                   : bias.final === "Short" ? "🔴 SHORT-GRID — Abwärts-Bias"
                   : "🟡 NEUTRAL-GRID — Seitwärts-Range";

    return {
      headline,
      // Zyklus-Ebene: die eigentliche Empfehlung. Steht ÜBER dem Bias —
      // der Bias sagt "welche Richtung", die Empfehlung sagt "überhaupt?".
      recommendation: rec,
      gridSuitability: suit,
      mayer, er,
      profile: profileValues(),
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
        mayer: market.mayer, er: market.er,
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
    // Zyklus-Ebene
    CYCLE, PROFILES, setProfile, getProfile, profileValues,
    gridSuitability, recommendation, viability,
  };
})();

if (typeof window !== "undefined") window.GridBot = GridBot;
if (typeof module !== "undefined" && module.exports) module.exports = GridBot;
