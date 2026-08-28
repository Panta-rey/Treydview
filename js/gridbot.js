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
    if (bias === "Short")
      safety = stopLoss < price * (1 + 1 / leverage) ? "✅ SL vor Liq" : "❌ Liq vor SL";
    else if (bias === "Long")
      safety = stopLoss > price * (1 - 1 / leverage) ? "✅ SL vor Liq" : "❌ Liq vor SL";
    else {
      // Neutral-Grid: kein gerichteter Stop, aber Liq-Abstand trotzdem prüfen.
      // Bei 1× kein Liq-Risiko; bei > 1× zeigen wir den Abstand.
      if (leverage <= 1) {
        safety = "ℹ️ Neutral-Grid (kein Hebel)";
      } else {
        const liqDist = Math.round((1 / leverage) * 100);
        safety = `⚠️ Neutral-Grid · Liq. ~${liqDist}% entfernt (${leverage}×)`;
      }
    }

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
  function viability(tier, lev, direction, holdDays, fundingAvg8h, erScore) {
    // B45: Funding-Kosten % — Neutral zahlt netto nichts
    const sign = direction === "Neutral" ? 0 : (direction.startsWith("Short") ? -1 : 1);
    const fundingCost = sign * lev * (fundingAvg8h || 0) * holdDays * 3;

    // Regime-sensitive Füllrate: Im Trend gehen Grid-Füllungen gegen null.
    // gridSuitability() erkennt das, aber viability() ignorierte es bisher —
    // das erzeugte einen grünen Haken trotz «🔴 Trend – Grid riskant».
    // Faustregel: ER ≥ erTrend → Füllungen halbiert; ER ≥ erRange → -25%.
    const er = erScore ?? null;
    let regimeFactor = 1.0;
    if (er != null) {
      if (er >= CYCLE.erTrend) regimeFactor = 0.3;       // Trend: stark reduziert
      else if (er >= CYCLE.erRange) regimeFactor = 0.65;  // Übergang
    }
    const effectiveFills = TH.fillsPerGrid * regimeFactor;

    // B46: Grid-Ertrag % = Füllungen/Monat × Tage/30 × Netto-Profit × Hebel × Kalibrierung
    const netPerGrid = tier.targetProfit - TH.feeRoundtrip;
    const gridYield = (effectiveFills * holdDays / 30) * netPerGrid * lev * TH.calibration;

    const net = gridYield - fundingCost;

    // Risikoterm: Liquidationsrisiko wächst mit dem Hebel, aber viability()
    // bildet das nicht ab — Netto wächst sonst linear mit Hebel ohne Gegenkraft.
    // Grobe Approximation: Liq-Abstand = 1/Hebel. Bei 10× ist der Chart
    // 10% weg von der Liquidation, was bei Krypto-Volatilität realistisch
    // innerhalb einer Haltedauer liegt. Wir zeigen das explizit, subrahieren es
    // aber NICHT vom Netto (es ist ein Risikohinweis, kein Ertragsminderer).
    const liqDist = lev > 1 ? Math.round((1 / lev) * 100) : null;

    return {
      fundingCost:    Math.round(fundingCost * 10) / 10,
      gridYield:      Math.round(gridYield * 10) / 10,
      net:            Math.round(net * 10) / 10,
      ok:             net > 0,
      regimeFactor:   Math.round(regimeFactor * 100),   // % der Nenn-Füllrate
      effectiveFills: Math.round(effectiveFills * 10) / 10,
      liqDist,        // % Abstand zur Liquidation (Risikohinweis)
      label: net > 0
        ? (regimeFactor < 1 ? `⚠️ Ertrag > Kosten (Regime: ${Math.round(regimeFactor*100)}% Füllrate)` : "✅ Ertrag > Kosten")
        : "❌ Funding/Gebühr frisst Ertrag",
      netPerGrid:    Math.round(netPerGrid * 100) / 100,
      netPerGridOk:  netPerGrid >= CYCLE.minNetPerGrid,
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
      row.viability = viability(t, row.leverage, bias.final, t.holdDays || 30, avg8h, er);
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

  // ---- UI-Schicht (aus app.js extrahiert, m73) ----
  // Die Grid-Bot-Bedienoberfläche lebte historisch in app.js. Sie ist eng an
  // app.js-Zustand gekoppelt (state, chart, mehrere Helfer), lädt aber logisch
  // zum Grid Bot. initUI(deps) nimmt die Kopplung als explizite Bridge entgegen;
  // app.js ruft es einmalig nach der Chart-Init auf. Funktionsrümpfe unverändert.
  function initUI(deps) {
    const { chart, state, setStatus, saveWorkspace, setChartCursor, resize, updateCycleBar, derivSymbolFor } = deps;

  function gbMarketData(dailyD) {
    const d = chart.getDataList();
    if (!d || d.length < 10) return null;
  
    // Preis und Volumen immer aus den aktuellen Chart-Kerzen (aktuellster Tick)
    const closes = d.map(x => x.close);
    const price = closes.at(-1);
    if (!price) return null;
  
    // Für ATR/SMA/ER: Tages-Kerzen bevorzugen wenn vorhanden, sonst Chart-Kerzen.
    // Das stellt sicher dass ATR14/90/200 immer tägliche Volatilität misst —
    // unabhängig davon ob der Chart auf 15m, 4h oder 1D steht.
    const base = (dailyD && dailyD.length >= 50) ? dailyD : d;
    const baseCloses = base.map(x => x.close);
  
    const sma = (n) => {
      if (baseCloses.length < n) return null;
      const s = baseCloses.slice(-n);
      return s.reduce((a, b) => a + b, 0) / n;
    };
  
    // Kaufman Efficiency Ratio auf Tages-Basis (auf 15m/4h-Kerzen zu rauschig)
    const efficiencyRatio = (period = 20) => {
      if (baseCloses.length < period + 1) return null;
      const seg = baseCloses.slice(-(period + 1));
      const direction = Math.abs(seg[seg.length - 1] - seg[0]);
      let volatility = 0;
      for (let i = 1; i < seg.length; i++) volatility += Math.abs(seg[i] - seg[i - 1]);
      return volatility > 0 ? direction / volatility : 0;
    };
  
    // RSI 14 nach Wilder aus Chart-Kerzen (Preis-Impuls ist TF-sensitiv, OK so)
    const rsiWilder = (period = 14) => {
      if (closes.length < period + 1) return null;
      let gain = 0, loss = 0;
      for (let i = 1; i <= period; i++) {
        const ch = closes[i] - closes[i - 1];
        if (ch > 0) gain += ch; else loss -= ch;
      }
      let ag = gain / period, al = loss / period;
      for (let i = period + 1; i < closes.length; i++) {
        const ch = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + (ch > 0 ? ch : 0)) / period;
        al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
      }
      if (al === 0) return 100;
      return 100 - 100 / (1 + ag / al);
    };
  
    // ATR nach Wilder auf base (Tages-Kerzen wenn vorhanden), in % vom Preis
    const atrPct = (period) => {
      if (base.length < period + 1) return null;
      const tr = [];
      for (let i = 1; i < base.length; i++) {
        tr.push(Math.max(
          base[i].high - base[i].low,
          Math.abs(base[i].high - base[i - 1].close),
          Math.abs(base[i].low  - base[i - 1].close)
        ));
      }
      let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
      for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
      return (a / price) * 100;
    };
  
    // Volumen-Signal aus Chart-Kerzen (aktuellster TF, passt so)
    const vols = d.map(x => x.volume || 0);
    const volMa = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volSignal = vols.at(-1) > volMa * 2 ? "🔥 Volumen-Spike (Achtung Trendwende/Ausbruch)"
                    : vols.at(-1) < volMa * 0.5 ? "😴 Volumen-Flaute" : "➖ Volumen normal";
  
    const a14 = atrPct(14), a90 = atrPct(90), a200 = atrPct(200);
    const context = (a14 != null && a90 != null)
      ? (a14 < a90 * 0.8 ? "Volatilitäts-Kontraktion (Kompression)"
       : a14 > a90 * 1.3 ? "Volatilitäts-Expansion" : "Normale Volatilität")
      : "—";
  
    const sma200v = sma(200);
    return {
      price, sma50: sma(50), sma200: sma200v, rsi: rsiWilder(14),
      atr14: a14, atr90: a90, atr200: a200,
      volumeSignal: volSignal, marketContext: context,
      mayer: sma200v ? price / sma200v : null,
      er: efficiencyRatio(20),
      dailyDataUsed: base !== d,
    };
  }

  async function gbRefresh(force) {
    // Tages-Kerzen separat holen — ATR/SMA/ER sollen immer auf Tagesdaten basieren,
    // unabhängig davon welchen Chart-Timeframe der Nutzer gerade anschaut.
    // 200 Kerzen reichen für ATR200 + SMA200 + ER20. Nur für Binance-Symbole;
    // bei anderen Exchanges (Kraken, Coinbase, Bybit) wird mit Chart-Daten gerechnet.
    let dailyD = null;
    try {
      if (state.symbol.type === "binance") {
        dailyD = await DataLayer.fetchBinanceKlines(state.symbol.id, "1d", 210);
      } else if (state.symbol.type === "bybit") {
        dailyD = await DataLayer.fetchBybitKlines(state.symbol.bybitSymbol, "D", 210);
      } else if (state.symbol.type === "kraken") {
        dailyD = await DataLayer.fetchKrakenKlines(state.symbol.krakenPair, "1440", 210);
      } else if (state.symbol.type === "bitstamp") {
        // Sonst rechnete Mayer/ATR auf Wochen- oder Monatskerzen, sobald der
        // Chart nicht auf 1D steht.
        dailyD = await DataLayer.fetchBitstampHistory(state.symbol.bitstampPair, 86400);
        dailyD = (dailyD || []).slice(-210).map(k => Array.isArray(k)
          ? { timestamp: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] } : k);
      }
    } catch (e) { dailyD = null; }   // Fallback: Chart-Kerzen
  
    const market = gbMarketData(dailyD);
    if (!market) { setStatus("Grid Bot: zu wenig Chart-Daten (200+ Kerzen nötig)"); return; }
  
    if (force) Derivatives.clearCache();
    document.getElementById("gbUpdated").textContent = "lädt…";
  
    let deriv = { funding: null, oi: null, ls: null, fng: null, errors: [] };
    // Fuer Gold, Indizes und Fonds gibt es keinen Perpetual — dort waeren
    // Funding und Open Interest sinnlos. Fear&Greed ist symbolunabhaengig
    // und wird trotzdem geholt.
    try {
      deriv = await Derivatives.fetchAll(derivSymbolFor(state.symbol));
    } catch (e) {
      deriv.errors = [String(e.message || e)];
    }
  
    const opts = {
      capital: state.gbCapital,
      riskPct: null,                       // null -> Risiko-Budget kommt aus dem Profil
      feePct:  GridBot.getThresholds().feeRoundtrip,
      tiers:   state.gbTiers,
    };
    GridBot.setThresholds(state.gbThresholds);
    state.gbResult = GridBot.compute(market, deriv, opts);
  
    gbRenderStatus();
    gbRenderTiers();
    gbRenderData();
    if (state.gbActiveTier) gbDrawBands(state.gbActiveTier);
  }

  function gbRenderStatus() {
    const r = state.gbResult;
    if (!r) return;
  
    // Die Statuszeile beantwortet in einem Blick: soll ich überhaupt?
    const rec = r.recommendation || {};
    const pill = document.getElementById("gbHeadline");
    const short = { defensive: "Defensiv", "accumulate-spot": "Spot/DCA", "accumulate-grid": "Makro-Grid",
                    range: "Kurzfrist", "long-bias": "Long-Bias", wait: "Beobachten" }[rec.stage] || "—";
    pill.textContent = short;
    pill.className = "gb-pill " + ({ defensive: "stop", "accumulate-spot": "long", "accumulate-grid": "long",
                                     range: "", "long-bias": "long", wait: "wait" }[rec.stage] || "");
  
    const set = (id, txt, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      el.className = "gb-stat" + (cls ? " " + cls : "");
    };
  
    const m = r.mayer;
    set("gbRegime", m != null ? "Mayer " + m.toFixed(2) : "Mayer –",
        m == null ? "" : m > GridBot.CYCLE.mayerExpensive ? "warn" : m < GridBot.CYCLE.mayerCheap ? "good" : "");
  
    const er = r.er;
    set("gbRsi", er != null ? "ER " + er.toFixed(2) : "ER –",
        er == null ? "" : er >= GridBot.CYCLE.erTrend ? "warn" : er < GridBot.CYCLE.erRange ? "good" : "");
  
    const fng = r.derivatives?.fng;
    set("gbFunding", fng != null ? "F&G " + fng : "F&G –",
        fng == null ? "" : fng > GridBot.CYCLE.fngGreed ? "warn" : fng < GridBot.CYCLE.fngFear ? "good" : "");
  
    const rsi = r.market?.rsi;
    set("gbFng", rsi != null ? "RSI " + rsi.toFixed(0) : "RSI –",
        rsi == null ? "" : (rsi >= 75 || rsi <= 25) ? "warn" : "");
  
    document.getElementById("gbUpdated").textContent = state.gbUpdated || "";
  
    // Zyklus-Ampel in der Topbar synchron aktualisieren
    updateCycleBar(r);
  }

  function gbRenderTiers() {
    const r = state.gbResult;
    const t = document.getElementById("gbTiers");
    const box = document.getElementById("gbRecoBox");
    if (!r || !r.tiers.length) {
      t.innerHTML = '<tbody><tr><td class="lbl">Keine Daten</td></tr></tbody>';
      if (box) box.innerHTML = "";
      return;
    }
  
    // ---- Empfehlung: die eine Aussage, um die es geht ----
    const rec = r.recommendation || {};
    const stageClass = { defensive: "reco-stop", "accumulate-spot": "reco-go", "accumulate-grid": "reco-go",
                         range: "reco-go", "long-bias": "reco-go", wait: "reco-wait" }[rec.stage] || "reco-wait";
    if (box) {
      box.className = "gb-reco " + stageClass;
      box.innerHTML = `<div class="reco-main">${rec.label || "—"}</div>`
        + `<div class="reco-why">${rec.why || ""}</div>`
        + `<div class="reco-meta">`
          + `<span>Grid-Eignung: <b>${r.gridSuitability?.label || "—"}</b></span>`
          + `<span>Profil: <b>${r.profile?.name || "—"}</b></span>`
          + (r.tiers.some(x => x.leverageGuard) ? `<span class="reco-guard">⚠ Hebel-Leitplanke aktiv → max 1×</span>` : "")
        + `</div>`;
    }
  
    const fmt = (n) => n == null ? "–" : n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
    const sign = (n) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";
  
    // Nur was man in Pionex tatsächlich eintippt oder zum Entscheiden braucht.
    // Alles andere (Scores, ATR, Faktoren) rechnet im Hintergrund.
    const rows = [
      ["Range oben",   (x) => fmt(x.upper)],
      ["Range unten",  (x) => fmt(x.lower)],
      ["Grids",        (x) => x.grids],
      ["Hebel",        (x) => x.leverage + "×" + (x.leverageGuard ? " ⚠" : "")],
      ["Investment",   (x) => fmt(x.positionSize) + " USDT"],
      ["Stop Loss",    (x) => fmt(x.stopLoss)],
      ["Sicherheit",   (x) => x.safety],
      ["Netto-Erwartung", (x) => x.viability ? sign(x.viability.net) : "–"],
    ];
  
    let html = "<thead><tr><th></th>" + r.tiers.map(x => {
      const isReco = rec.tier === x.id;
      return `<th class="tier-head${isReco ? " tier-reco" : ""}">${x.label}${isReco ? " ★" : ""}<span class="tier-hz">${x.horizon}</span></th>`;
    }).join("") + "</tr></thead><tbody>";
  
    rows.forEach(([lbl, fn]) => {
      html += `<tr><td class="lbl">${lbl}</td>` + r.tiers.map(x => {
        const isReco = rec.tier === x.id;
        let cls = isReco ? "on" : "";
        if (lbl === "Netto-Erwartung" && x.viability && !x.viability.ok) cls = "neg";
        return `<td${cls ? ` class="${cls}"` : ""}>${fn(x)}</td>`;
      }).join("") + "</tr>";
    });
  
    html += '<tr><td class="lbl"></td>' + r.tiers.map(x =>
      `<td><button class="gb-show${state.gbActiveTier === x.id ? " active" : ""}" data-tier="${x.id}">${state.gbActiveTier === x.id ? "Im Chart ✓" : "Im Chart"}</button></td>`
    ).join("") + "</tr></tbody>";
    t.innerHTML = html;
  
    t.querySelectorAll(".gb-show").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.dataset.tier;
        state.gbActiveTier = state.gbActiveTier === id ? null : id;
        saveWorkspace();
        gbRenderTiers();
        gbDrawBands(state.gbActiveTier);
      });
    });
  
    const w = document.getElementById("gbWarning");
    w.textContent = r.missing.length ? "Quellen fehlen: " + r.missing.join(", ") : "";
    w.className = "gb-note" + (r.missing.length ? " warn" : "");
  }

  function gbRenderData() {
    const r = state.gbResult;
    const box = document.getElementById("gbData");
    if (!r) return;
    const n = (v, d = 2, suf = "") => v == null ? "–" : v.toFixed(d) + suf;
    const blk = (title, kvs) =>
      `<div><div class="gb-blk-title">${title}</div>` +
      kvs.map(([k, v]) => `<div class="gb-kv"><span>${k}</span><span>${v}</span></div>`).join("") + "</div>";
  
    box.innerHTML =
      blk("Markt & Trend", [
        ["Preis", n(r.market.price, 0)],
        ["SMA50", n(r.market.sma50, 0)],
        ["SMA200", n(r.market.sma200, 0)],
        ["Abstand SMA200", n(r.market.sma200Dist, 2, "%")],
        ["RSI14 (Wilder)", n(r.market.rsi, 1)],
        ["ATR14 / 90 / 200", `${n(r.market.atr14)} / ${n(r.market.atr90)} / ${n(r.market.atr200)}`],
        ["Volumen", r.market.volumeSignal],
      ]) +
      blk("Sentiment & Derivate", [
        ["Fear & Greed", r.derivatives.fng != null ? `${r.derivatives.fng} (${r.derivatives.fngLabel})` : "–"],
        ["F&G Ø30 / Ø90", `${n(r.derivatives.fngAvg30, 1)} / ${n(r.derivatives.fngAvg90, 1)}`],
        ["Funding 8h", n(r.derivatives.funding8h, 4, "%")],
        ["Funding monatlich", n(r.derivatives.fundingMonthly, 2, "%")],
        ["Open Interest", r.derivatives.oiNow != null ? n(r.derivatives.oiNow, 0) + " BTC" : "–"],
        ["OI Δ30T / Δ90T", `${n(r.derivatives.oiChange30, 2, "%")} / ${n(r.derivatives.oiChange90, 2, "%")}`],
        ["L/S Ratio", n(r.derivatives.lsRatio, 4)],
        ["OI-Interpretation", r.oiInterpretation],
      ]) +
      blk("Konfluenz", [
        ["Trend-Score", r.confluence.trendScore ?? "–"],
        ["Derivate-Score", r.confluence.derivativeScore ?? "–"],
        ["Summe", r.confluence.sum ?? "–"],
        ["Extrem-Filter", r.confluence.extreme],
        ["Roh-Bias (vor Filter)", r.rawBias],
        ["Bias (final)", r.bias],
        ["Regime", r.regime],
      ]);
  }

  function gbClearBands() {
    (state.gbBandIds || []).forEach(id => { try { chart.removeOverlay(id); } catch (e) {} });
    state.gbBandIds = [];
  }

  function gbRenderSettings() {
    const box = document.getElementById("gbPaneSettings");
    if (!box) return;
  
    // Vier Felder. Der Rest ist bewusst fest.
    //
    // Aus der Parameter-Referenz zum Dashboard:
    //   "Schwellen nie direkt ändern (fest in Formel).
    //    Aggressivität über Profil (I16) steuern."
    //
    // Der Grund: Mayer < 0.9 traf jeden Akkumulations-Boden seit 2015. Wer
    // die Schwelle hochdreht, weil "Defensiv" erscheint, senkt nicht das
    // Risiko — nur die Warnung. Die Werte, die hier stehen dürfen, sind die
    // über DEIN Setup (Kapital, Börse), nicht die über den Markt.
    const th = GridBot.getThresholds();
    const prof = GridBot.profileValues();
  
    box.innerHTML = `
      <div class="gb-set-wrap">
        <div class="gb-set-block">
          <div class="gb-set-title">Dein Setup</div>
          <label>Kapital (USDT)<input type="number" id="gbCapital" value="${state.gbCapital}" min="10" step="100"></label>
          <label>Gebühr Roundtrip %<input type="number" id="gbFee" value="${th.feeRoundtrip}" min="0" max="1" step="0.01"></label>
          <label>Füllungen je Grid/Monat<input type="number" id="gbFills" value="${th.fillsPerGrid}" min="1" max="8" step="1"></label>
        </div>
  
        <div class="gb-set-block">
          <div class="gb-set-title">Aggressivität</div>
          <label>Risiko-Profil<select id="gbProfile">
            ${Object.keys(GridBot.PROFILES).map(p =>
              `<option value="${p}"${p === prof.name ? " selected" : ""}>${p}</option>`).join("")}
          </select></label>
          <div class="gb-prof-info" id="gbProfInfo"></div>
        </div>
      </div>
  
      <div class="gb-set-note">
        Alle Schwellwerte — Mayer 0.9 / 2.0, Fear&amp;Greed 35 / 80, ER 0.3 / 0.5, RSI 25 / 75 —
        sind bewusst fest verdrahtet und nicht editierbar. Sie sind historisch kalibriert:
        Mayer unter 0.9 traf jeden BTC-Akkumulationsboden seit 2015. Wer sie verschiebt, weil
        das Ergebnis nicht gefällt, senkt nicht das Risiko, sondern nur die Warnung.
        Aggressivität steuerst du über das Profil. Was genau gerechnet wird, steht im FAQ.
      </div>
    `;
  
    const renderProfInfo = () => {
      const p = GridBot.PROFILES[document.getElementById("gbProfile").value];
      document.getElementById("gbProfInfo").innerHTML =
        `<div class="pi-row"><span>Hebel max</span><b>${p.leverageCap}×</b></div>`
        + `<div class="pi-row"><span>Risiko je Bot</span><b>${p.riskBudget}%</b></div>`
        + `<div class="pi-row"><span>Gap-Puffer</span><b>${p.gapBuffer}%</b></div>`;
    };
    renderProfInfo();
  
    document.getElementById("gbProfile").addEventListener("change", (e) => {
      GridBot.setProfile(e.target.value);
      state.gbProfile = e.target.value;
      renderProfInfo();
      saveWorkspace();
      gbRefresh();
    });
  
    const num = (id, key) => {
      document.getElementById(id).addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        if (isNaN(v)) return;
        if (key === "capital") { state.gbCapital = v; }
        else { GridBot.setThresholds({ [key]: v }); state.gbThresholds = GridBot.getThresholds(); }
        saveWorkspace();
        gbRefresh();
      });
    };
    num("gbCapital", "capital");
    num("gbFee", "feeRoundtrip");
    num("gbFills", "fillsPerGrid");
  }

  function gbDrawBands(tierId) {
    gbClearBands();
    if (!tierId || !state.gbResult) return;
    const t = state.gbResult.tiers.find(x => x.id === tierId);
    if (!t) return;
  
    const d = chart.getDataList();
    if (!d || !d.length) return;
    const ts = d[Math.max(0, d.length - 200)].timestamp;
  
    try {
      const id = chart.createOverlay({
        name: "gridBands",
        points: [{ timestamp: ts, value: t.upper }, { timestamp: d.at(-1).timestamp, value: t.lower }],
        lock: true,
        onMouseEnter: () => { setChartCursor("pointer"); return false; },
        onMouseLeave: () => { setChartCursor(""); return false; },
        extendData: {
          lower: t.lower, upper: t.upper, grids: t.grids, stopLoss: t.stopLoss,
          takeProfit: t.takeProfit, label: t.label, direction: t.direction, leverage: t.leverage,
        },
      });
      if (id) state.gbBandIds.push(id);
    } catch (e) {}
  }

  function gbInitResize() {
    const handle = document.getElementById("gbResize");
    const bar = document.getElementById("gridBotBar");
    let dragging = false, startY = 0, startH = 0;
  
    const onMove = (e) => {
      if (!dragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const max = document.querySelector(".chart-col").clientHeight - 160;
      const h = Math.max(34, Math.min(max, startH + (startY - y)));
      bar.style.height = h + "px";
      state.gbHeight = h;
      resize();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
      saveWorkspace();
    };
  
    const onDown = (e) => {
      dragging = true;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startH = bar.getBoundingClientRect().height;
      document.body.style.cursor = "ns-resize";
      e.preventDefault();
    };
  
    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: false });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
  }

  function gbApplyHeight() {
    const bar = document.getElementById("gridBotBar");
    if (state.gbCollapsed) { bar.style.height = ""; return; }
    bar.style.height = (state.gbHeight || 250) + "px";
  }

  function gbToggleBar(show) {
    const bar = document.getElementById("gridBotBar");
    const on = show != null ? show : bar.classList.contains("hidden");
    bar.classList.toggle("hidden", !on);
    document.getElementById("gbResize").classList.toggle("hidden", !on || state.gbCollapsed);
    document.getElementById("gridBotBtn").classList.toggle("active", on);
    if (on) gbApplyHeight();
    state.gbOpen = on;
    saveWorkspace();
    resize();
    if (on && !state.gbResult) gbRefresh(false);
  }

  function gbSetCollapsed(c) {
    document.getElementById("gbBody").classList.toggle("collapsed", c);
    document.getElementById("gbResize").classList.toggle("hidden", c || !state.gbOpen);
    document.getElementById("gbChev").innerHTML = c
      ? '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    state.gbCollapsed = c;
    gbApplyHeight();
    saveWorkspace();
    resize();
  }

    return {
      refresh: gbRefresh,
      renderTiers: gbRenderTiers,
      renderSettings: gbRenderSettings,
      initResize: gbInitResize,
      toggleBar: gbToggleBar,
      setCollapsed: gbSetCollapsed,
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
    initUI,
  };
})();

if (typeof window !== "undefined") window.GridBot = GridBot;
if (typeof module !== "undefined" && module.exports) module.exports = GridBot;
