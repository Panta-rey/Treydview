// ============================================================
// TreydView — Elliott-Wellen-Scanner (Welle 3 / Golden Pocket)
//
// Sucht abgeschlossene Impulse (Welle 1), berechnet daraus die
// logarithmische Golden Pocket der Korrektur (Welle 2) und verfolgt,
// was danach tatsaechlich passiert ist.
//
// Aufbau in Schichten:
//   1. Kennzahlen      — RSI, ATR, Praefixsummen (einmal ueber alle Daten)
//   2. findFractals()  — bestaetigte Swing-Punkte, ohne Zukunftsblick
//   3. alternate()     — H-L-H-L-Kette, damit Welle 1 EIN Schwung ist
//   4. EWTEngine.scan()— Filter + Zustandsmaschine je Kandidat
//
// ── DIE ZWEI GRUNDREGELN ────────────────────────────────────────────
//
// 1. KEIN REPAINTING.
//    Ein Fraktal bei Index i ist erst bei i+swingLength bestaetigt —
//    vorher weiss niemand, dass es ein Extrempunkt war. Die
//    Zustandsmaschine startet deshalb strikt bei h+swingLength, nicht
//    bei h+1. Alles, was ein Setup entstehen laesst, steht zu diesem
//    Zeitpunkt fest und aendert sich danach nie mehr.
//
//    Genau daran scheitert der naheliegende Volumen-Filter "Kaufvolumen
//    im Anstieg vs. Verkaufsvolumen in der AKTUELLEN Korrektur": die
//    Korrektur ist ein wachsendes Fenster, das Ergebnis kippt mit jeder
//    neuen Kerze, und die Box verschwaende rueckwirkend. Das Fenster ist
//    hier deshalb fest auf h+1 … h+max(swingLength,3) verdrahtet.
//
// 2. ZWINGEND LOGARITHMISCH.
//    Alle Fibonacci-Rechnungen laufen geometrisch. Siehe logRetrace().
//
// Bewusst konservativ eingestellt, wie patterns.js: lieber ein Setup
// verpassen als zehn Fehlalarme zeichnen.
// ============================================================

(function () {
  "use strict";

  const DEFAULTS = {
    // ---- Struktur ----
    swingLength:     5,      // Fenstergroesse je Seite fuer Fraktale
    minImpulseBars:  5,      // ein 2-Kerzen-"Impuls" ist Rauschen
    minSwingPercent: 5.0,    // absoluter Boden fuer die Wellenhoehe

    // ---- Volatilitaets-Normierung ----
    // minSwingPercent allein ist regimeabhaengig: 5 % sind auf BTC-Daily
    // in ruhigen Phasen enorm und im Bullenlauf nichts. Der ATR-Test
    // macht den Scanner ueber Timeframes hinweg brauchbar, ohne dass man
    // die Prozentzahl jedes Mal nachziehen muss.
    useAtrFilter:    true,
    minSwingAtr:     2.0,    // (H-L) >= minSwingAtr * ATR am Startpunkt
    atrPeriod:       14,

    // ---- Impuls-Qualitaet ----
    // Kaufman Efficiency Ratio ueber die Welle. 1.0 = schnurgerade,
    // 0 = viel Weg ohne Fortschritt. Ein echter Impuls laeuft gerichtet;
    // ein zermuerbender Anstieg gleicher Amplitude ist keine Welle 1.
    requireEfficiency: true,
    minEfficiency:     0.30,

    // ---- RSI am Wellenstart ----
    requireRsi:   true,
    rsiPeriod:    14,
    rsiOversold:  30,        // ODER bullische Divergenz, siehe unten

    // ---- Volumen-Konfluenz ----
    requireVolume: true,

    // ---- Golden Pocket ----
    gpTop:     0.5,          // oberes Ende der Box (weniger zurueckgegeben)
    gpBottom:  0.618,        // unteres Ende
    extension: 1.618,        // Welle-3-Ziel als Log-Extension

    // ---- Zustandsmaschine ----
    timeoutBars:      60,    // wann verfaellt ein unberuehrtes Setup?
    invalidateOnWick: false, // false = Schlusskurs (Hauskonvention)

    // ---- Projektion ----
    // Fibonacci-Hypothesen fuer Welle 3/4/5. Rein regelbasiert
    // fortgeschrieben — siehe project() fuer die Einordnung.
    projectWaves: true,
    w3Ratio:  1.618,   // Welle 3 = 1.618 x Welle 1 (ab Welle-2-Tief)
    w3RatioX: 2.618,   // oberes Ende des Zielbands
    w4Top:    0.236,   // Welle 4 korrigiert 0.236 - 0.382 von Welle 3
    w4Bottom: 0.382,
    w5Ratio:  1.0,     // Welle 5 = 1.0 x Welle 1 (ab Welle-4-Tief)

    // ---- Ausgabe ----
    // Der eigentliche FPS-Schutz. Nicht die Rechnung ist teuer, sondern
    // die Anzahl Overlays: KLineCharts zeichnet jedes bei jedem Frame neu.
    maxSetups: 12,
  };

  // ============================================================
  // 1. Kennzahlen
  // ============================================================

  // Wilder-RSI. Liefert ein Array gleicher Laenge; alles vor der
  // Einschwingphase ist null (nicht 0 — 0 waere ein gueltiger Extremwert).
  function wilderRsi(closes, period) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n < period + 1) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch > 0) gain += ch; else loss -= ch;
    }
    let ag = gain / period, al = loss / period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = period + 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1];
      ag = (ag * (period - 1) + (ch > 0 ?  ch : 0)) / period;
      al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  // Wilder-ATR in absoluten Kurseinheiten.
  function atrSeries(data, period) {
    const n = data.length;
    const out = new Array(n).fill(null);
    if (n < period + 1) return out;
    const tr = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      tr[i] = Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low  - data[i - 1].close)
      );
    }
    let a = 0;
    for (let i = 1; i <= period; i++) a += tr[i];
    a /= period;
    out[period] = a;
    for (let i = period + 1; i < n; i++) {
      a = (a * (period - 1) + tr[i]) / period;
      out[i] = a;
    }
    return out;
  }

  // ── LOGARITHMISCHES RETRACEMENT ──────────────────────────────────
  //
  //   retrace(H, L, r) = exp( ln H − r·(ln H − ln L) ) = H^(1−r) · L^r
  //
  // r = wie viel der Bewegung zurueckgegeben wurde.
  //   r = 0     -> H          (nichts zurueckgegeben)
  //   r = 0.5   -> sqrt(H·L)  (geometrisches Mittel, NICHT das
  //                            arithmetische — genau darum geht es)
  //   r = 0.618 -> tiefer als r = 0.5
  //   r = 1     -> L          (alles zurueckgegeben)
  //
  // ACHTUNG, haeufige Verwechslung: die Fassung H^r · L^(1−r) liefert
  // fuer r = 0.618 das 0.382-Level. Die Golden Pocket landet damit
  // gespiegelt im oberen Drittel der Welle. Das Komplement gehoert an
  // den Exponenten von H, nicht von L.
  //
  // Fuer nicht-positive Kurse (defekte Datenreihe) faellt die Funktion
  // auf die lineare Rechnung zurueck, statt NaN zu erzeugen.
  function logRetrace(high, low, r) {
    if (!(high > 0) || !(low > 0)) return high - r * (high - low);
    return Math.exp(Math.log(high) - r * (Math.log(high) - Math.log(low)));
  }

  // Log-Extension: die Impuls-Ratio H/L, potenziert und ab einem Anker
  // angesetzt. Das geometrische Gegenstueck zu "Anker + 1.618 × Spanne".
  function logExtend(anchor, high, low, mult) {
    if (!(anchor > 0) || !(high > 0) || !(low > 0)) {
      return anchor + mult * (high - low);
    }
    return anchor * Math.pow(high / low, mult);
  }

  // ============================================================
  // 2. Fraktale (bestaetigte Swing-Punkte)
  // ============================================================
  //
  // Ein Swing High bei i ist hoeher als alle Kerzen im Fenster links UND
  // rechts. confirmIndex = i + n: erst dann ist das Fenster rechts
  // vollstaendig und das Fraktal ueberhaupt erkennbar.
  //
  // Gleichstaende: links strikt (>= schlaegt aus), rechts erlaubend (>).
  // Ohne diese Asymmetrie liefert ein Plateau aus zwei exakt gleichen
  // Hochs GAR KEIN Fraktal — auf Krypto selten, auf Indexdaten nach
  // Datenluecken real. So gewinnt deterministisch das erste Hoch.
  function findFractals(data, n) {
    const highs = [], lows = [];
    const len = data.length;
    if (len < 2 * n + 1) return { highs, lows };

    for (let i = n; i < len - n; i++) {
      const h = data[i].high, l = data[i].low;
      let isHigh = true, isLow = true;

      for (let j = i - n; j < i; j++) {
        if (data[j].high >= h) isHigh = false;
        if (data[j].low  <= l) isLow  = false;
        if (!isHigh && !isLow) break;
      }
      if (!isHigh && !isLow) continue;

      for (let j = i + 1; j <= i + n; j++) {
        if (data[j].high > h) isHigh = false;
        if (data[j].low  < l) isLow  = false;
        if (!isHigh && !isLow) break;
      }

      if (isHigh) highs.push({ index: i, price: h, type: "high", confirmIndex: i + n });
      if (isLow)  lows.push({  index: i, price: l, type: "low",  confirmIndex: i + n });
    }
    return { highs, lows };
  }

  // Alternierende Kette H-L-H-L. Zwei gleichartige Punkte hintereinander:
  // der extremere gewinnt.
  //
  // Das ist nicht nur Kosmetik, sondern der groesste Performance-Hebel:
  // ohne die Kette waeren alle (Tief, Hoch)-Paare Kandidaten — O(P²).
  // Mit ihr sind es nur benachbarte Paare — O(P). Und es ist inhaltlich
  // richtig: Welle 1 ist EIN sauberer Schwung, nicht irgendein Tief mit
  // irgendeinem spaeteren Hoch.
  function alternate(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || last.type !== p.type) { out.push(p); continue; }
      const replace = p.type === "high" ? p.price > last.price : p.price < last.price;
      if (replace) out[out.length - 1] = p;
    }
    return out;
  }

  // ============================================================
  // 3. Projektion der Folgewellen
  // ============================================================
  //
  // ── WAS DAS IST UND WAS NICHT ────────────────────────────────────
  //
  // Das hier ist KEINE Prognose. Es ist die mechanische Fortschreibung
  // der Fibonacci-Verhaeltnisse, die die Elliott-Lehre fuer einen
  // Impuls annimmt — mehr nicht. Es kommt keine Information aus den
  // Daten hinzu, die nicht schon in Welle 1 steckt: die gesamte
  // Projektion ist eine Funktion von (Tief, Hoch, Welle-2-Tief).
  //
  // Zwei Kerne von Unsicherheit stecken darin:
  //   1. Ob ueberhaupt ein Impuls laeuft, ist eine ANNAHME. Die meisten
  //      Anstiege sind keine Elliott-Impulse.
  //   2. Bei wartenden Setups ist das Welle-2-Tief noch gar nicht
  //      bekannt. Dann wird das geometrische Mittel der Golden Pocket
  //      unterstellt — die Projektion haengt also an einer Annahme ueber
  //      eine Annahme. Solche Setups sind mit basis:"angenommen"
  //      markiert und werden schwaecher gezeichnet.
  //
  // Die Zeitachse ist die schwaechste Komponente: Wellen-Zeitrelationen
  // sind empirisch weit unschaerfer als die Preisverhaeltnisse. Die
  // Bar-Abstaende dienen nur dazu, der Zeichnung eine Breite zu geben —
  // sie sind ausdruecklich keine Aussage darueber, WANN etwas eintritt.

  function s_ctx(l, h, L, H, boxTop, boxBottom, state, resolvedAt, w2Low) {
    return { l, h, L, H, boxTop, boxBottom, state, resolvedAt, w2Low };
  }

  function buildProjection(s, opts) {
    // Anker fuer Welle 3: das tatsaechliche Welle-2-Tief, falls die Box
    // schon beruehrt wurde — sonst das geometrische Mittel der Box.
    const measured = s.state === "triggered" && s.w2Low != null && isFinite(s.w2Low);
    const anchor = measured
      ? s.w2Low
      : Math.sqrt(s.boxTop * s.boxBottom);
    if (!(anchor > 0)) return null;

    // Welle 3: Log-Extension der Impuls-Ratio ab dem Welle-2-Tief.
    const w3 = logExtend(anchor, s.H, s.L, opts.w3Ratio);
    const w3x = logExtend(anchor, s.H, s.L, opts.w3RatioX);
    if (!isFinite(w3) || !isFinite(w3x)) return null;

    // Welle 4: korrigiert 0.236-0.382 von Welle 3, logarithmisch.
    const w4Top = logRetrace(w3, anchor, opts.w4Top);
    const w4Bot = logRetrace(w3, anchor, opts.w4Bottom);

    // ELLIOTT-REGEL: Welle 4 darf nicht in das Kursgebiet von Welle 1
    // laufen, also nicht unter das Hoch von Welle 1 fallen. Wird die
    // Regel von der eigenen Projektion verletzt, ist die Wellenzaehlung
    // in sich unstimmig — das wird gemeldet statt stillschweigend
    // huebsch gezeichnet.
    const w4Conflict = w4Bot <= s.H;

    // Welle 5: 1.0 x Welle 1 ab dem Welle-4-Tief.
    const w5 = logExtend(w4Bot, s.H, s.L, opts.w5Ratio);

    // Zeitachse: Vielfache der Welle-1-Dauer. Bewusst grob.
    const barsW1 = Math.max(1, s.h - s.l);
    const startIdx = s.state === "triggered" && s.resolvedAt != null
      ? s.resolvedAt : null;   // null = "ab jetzt", app.js setzt den letzten Bar

    return {
      basis: measured ? "gemessen" : "angenommen",
      anchor,
      w3, w3x, w4Top, w4Bot, w5,
      w4Conflict,
      startIdx,
      barsW3: Math.round(barsW1 * 1.618),
      barsW4: Math.round(barsW1 * 0.618),
      barsW5: Math.round(barsW1 * 1.0),
    };
  }

  // ============================================================
  // 4. Scanner
  // ============================================================

  const EWTEngine = {
    DEFAULTS,
    logRetrace,
    logExtend,

    // range = { from, to } in GLOBALEN Datenindizes.
    //
    // Bewusst OHNE slice(): patterns.js sliced und rechnet die Indizes
    // hinterher zurueck — dort steht ein langer Kommentar ueber genau die
    // Bugs, die das erzeugt hat (channel.from/to und at() vergessen).
    // Bei 5'000 Kerzen ist der Slice-Gewinn nicht messbar, die
    // Fehlerklasse aber komplett vermieden. Gefiltert wird am Ende.
    scan(data, range, userOpts = {}) {
      const opts = { ...DEFAULTS, ...userOpts };
      const n = Math.max(2, opts.swingLength | 0);
      const len = data ? data.length : 0;
      if (len < 2 * n + opts.minImpulseBars + 2) return [];

      const from = Math.max(0, range && range.from != null ? range.from : 0);
      const to   = Math.min(len - 1, range && range.to != null ? range.to : len - 1);

      // ---- Kennzahlen EINMAL ueber den vollen Datensatz ----
      const closes = new Array(len);
      for (let i = 0; i < len; i++) closes[i] = data[i].close;
      const rsi = wilderRsi(closes, opts.rsiPeriod);
      const atr = opts.useAtrFilter ? atrSeries(data, opts.atrPeriod) : null;

      // Praefixsummen: Fenster-Mittelwerte und Efficiency Ratio in O(1)
      // statt O(Fensterbreite).
      const upVolPS = new Float64Array(len + 1);
      const dnVolPS = new Float64Array(len + 1);
      const upCntPS = new Int32Array(len + 1);
      const dnCntPS = new Int32Array(len + 1);
      const absDiffPS = new Float64Array(len + 1);
      for (let i = 0; i < len; i++) {
        const v  = data[i].volume || 0;
        const up = data[i].close >= data[i].open;
        upVolPS[i + 1] = upVolPS[i] + (up ? v : 0);
        dnVolPS[i + 1] = dnVolPS[i] + (up ? 0 : v);
        upCntPS[i + 1] = upCntPS[i] + (up ? 1 : 0);
        dnCntPS[i + 1] = dnCntPS[i] + (up ? 0 : 1);
        absDiffPS[i + 1] = absDiffPS[i] + (i > 0 ? Math.abs(closes[i] - closes[i - 1]) : 0);
      }

      // Kaufman Efficiency Ratio ueber [a..b], O(1).
      const efficiency = (a, b) => {
        if (b <= a) return 0;
        const direction = Math.abs(closes[b] - closes[a]);
        const path = absDiffPS[b + 1] - absDiffPS[a + 1];
        return path > 0 ? direction / path : 0;
      };

      // Volumen-Konfluenz auf FESTEN Fenstern (siehe Kopfkommentar).
      // Drei Rueckgaben: true / false / null.
      // null = keine belastbaren Volumendaten (Indizes, Gold ueber FRED)
      // und laesst durch, statt dort jedes Setup zu blockieren.
      const volumeConfluence = (l, h, corrEnd) => {
        const upSum = upVolPS[h + 1] - upVolPS[l];
        const upCnt = upCntPS[h + 1] - upCntPS[l];
        const dnSum = dnVolPS[corrEnd + 1] - dnVolPS[h + 1];
        const dnCnt = dnCntPS[corrEnd + 1] - dnCntPS[h + 1];
        if (upCnt === 0 || dnCnt === 0) return { ok: null, ratio: null };
        if (upSum === 0 && dnSum === 0) return { ok: null, ratio: null };
        const avgUp = upSum / upCnt, avgDn = dnSum / dnCnt;
        if (avgDn === 0) return { ok: true, ratio: null };
        return { ok: avgUp > avgDn, ratio: avgUp / avgDn };
      };

      // ---- Fraktale und Kette ----
      const { highs, lows } = findFractals(data, n);
      if (!highs.length || !lows.length) return [];

      // Position jedes Tiefs in der Tief-Liste — fuer die Divergenz
      // brauchen wir den VORHERIGEN Tiefpunkt.
      const lowPos = new Map();
      lows.forEach((p, i) => lowPos.set(p.index, i));

      const chain = alternate(
        highs.concat(lows).sort((a, b) => a.index - b.index || (a.type === "low" ? -1 : 1))
      );

      // Bullische Divergenz: tieferes Tief im Kurs, hoeheres Tief im RSI.
      // Beide Tiefs sind laengst bestaetigt (sie liegen vor dem Hoch, das
      // seinerseits erst spaeter bestaetigt wird) — kein Zukunftsblick.
      const bullishDivergence = (l) => {
        const pos = lowPos.get(l);
        if (pos == null || pos < 1) return false;
        const prev = lows[pos - 1];
        if (rsi[l] == null || rsi[prev.index] == null) return false;
        return data[l].low < data[prev.index].low && rsi[l] > rsi[prev.index];
      };

      // ---- Kandidaten durchgehen ----
      const setups = [];

      for (let k = 0; k < chain.length - 1; k++) {
        const lowPt = chain[k], highPt = chain[k + 1];
        if (lowPt.type !== "low" || highPt.type !== "high") continue;

        const l = lowPt.index, h = highPt.index;
        const L = data[l].low, H = data[h].high;
        if (!(H > L) || !(L > 0)) continue;

        // -- Struktur --
        if (h - l < opts.minImpulseBars) continue;

        // -- Amplitude: Prozent-Boden UND ATR-Normierung --
        const risePct = (H - L) / L * 100;
        if (risePct < opts.minSwingPercent) continue;
        if (opts.useAtrFilter && atr && atr[l] != null && atr[l] > 0) {
          if ((H - L) < opts.minSwingAtr * atr[l]) continue;
        }

        // -- Impuls-Effizienz --
        const er = efficiency(l, h);
        if (opts.requireEfficiency && er < opts.minEfficiency) continue;

        // -- RSI am Wellenstart: ueberverkauft ODER Divergenz --
        const rsiAtLow = rsi[l];
        const oversold = rsiAtLow != null && rsiAtLow <= opts.rsiOversold;
        const diverg   = bullishDivergence(l);
        if (opts.requireRsi && !oversold && !diverg) continue;

        // -- Bestaetigungszeitpunkt: HIER steckt die Non-Repainting-Regel --
        const confirmIdx = h + n;
        if (confirmIdx >= len) continue;   // noch gar nicht wissbar

        // -- Volumen auf festem Fenster --
        const corrEnd = h + Math.max(n, 3);
        if (corrEnd >= len) continue;
        const vol = volumeConfluence(l, h, corrEnd);
        if (opts.requireVolume && vol.ok === false) continue;

        // -- Golden Pocket, logarithmisch --
        const boxTop    = logRetrace(H, L, opts.gpTop);
        const boxBottom = logRetrace(H, L, opts.gpBottom);
        if (!(boxTop > boxBottom)) continue;

        // ---- Zustandsmaschine ----
        //
        // Reihenfolge innerhalb einer Kerze ist unbekannt. Beruehrt eine
        // Kerze die Box UND schliesst unter dem Start-Tief, gewinnt die
        // Invalidierung: ein Bar, der unter der EWT-Grenze schliesst,
        // darf keinen sauberen Einstieg behaupten.
        //
        // Box-Kontakt als Intervall-Ueberlappung, nicht als "Close in der
        // Box" — sonst wuerde eine Kerze, die per Kursluecke DURCH die
        // Box springt, nicht erkannt. Die springende Kerze enthaelt die
        // Box vollstaendig, die Ueberlappung greift also korrekt.
        const scanEnd = Math.min(len - 1, confirmIdx + opts.timeoutBars);
        let state = "pending", resolvedAt = null;

        for (let t = confirmIdx; t <= scanEnd; t++) {
          const broke = opts.invalidateOnWick ? data[t].low < L : data[t].close < L;
          if (broke) { state = "invalid"; resolvedAt = t; break; }
          if (data[t].low <= boxTop && data[t].high >= boxBottom) {
            state = "triggered"; resolvedAt = t; break;
          }
        }
        // Fenster vollstaendig abgelaufen und nichts passiert -> Time-Out.
        // Reicht das Fenster ueber den letzten Bar hinaus, laeuft es noch.
        if (state === "pending" && confirmIdx + opts.timeoutBars <= len - 1) {
          state = "timeout"; resolvedAt = scanEnd;
        }

        // ---- Was danach geschah (nur historisch, kein Repainting) ----
        //
        // Ohne diesen Teil sieht jede gruene Box im Rueckblick wie ein
        // Treffer aus — genau der Fehler, vor dem das FAQ bei "Form 88 %"
        // warnt. Eine gruene Box mit rotem Strichrand ist eine, die nach
        // dem Einstieg gebrochen ist.
        let target = null, w2Low = null, outcome = null, outcomeAt = null;
        if (state === "triggered") {
          w2Low = Infinity;
          for (let t = h; t <= resolvedAt; t++) if (data[t].low < w2Low) w2Low = data[t].low;
          target = logExtend(w2Low, H, L, opts.extension);

          const horizon = Math.min(len - 1, resolvedAt + opts.timeoutBars);
          outcome = "offen";
          for (let t = resolvedAt + 1; t <= horizon; t++) {
            if (data[t].close < L)      { outcome = "invalidiert"; outcomeAt = t; break; }
            if (data[t].high >= target) { outcome = "ziel";        outcomeAt = t; break; }
          }
        }

        // ---- Guete: rein beschreibend, KEINE Trefferwahrscheinlichkeit ----
        const qEff  = Math.min(1, er / 0.6);
        const qRsi  = (oversold ? 0.6 : 0) + (diverg ? 0.4 : 0);
        const qVol  = vol.ratio == null ? 0.5 : Math.min(1, vol.ratio / 2);
        const qSize = Math.min(1, risePct / (opts.minSwingPercent * 3));
        const quality = Math.max(0, Math.min(1,
          0.35 * qEff + 0.25 * qRsi + 0.20 * qVol + 0.20 * qSize));

        // ---- Projektion der Folgewellen ----
        // Nur fuer Setups, die noch leben. Eine Projektion aus einem
        // invalidierten oder abgelaufenen Setup waere sinnlos.
        let projection = null;
        if (opts.projectWaves && (state === "pending" || state === "triggered")) {
          projection = buildProjection(s_ctx(l, h, L, H, boxTop, boxBottom,
                                             state, resolvedAt, w2Low), opts);
        }

        setups.push({
          type: "ewtWave3",
          projection,
          lowIndex: l, highIndex: h,
          lowPrice: L, highPrice: H,
          confirmIndex: confirmIdx,
          boxTop, boxBottom,
          invalidLevel: L,
          state, resolvedAt,
          target, w2Low, outcome, outcomeAt,
          risePct, er, quality,
          rsiAtLow, oversold, divergence: diverg,
          volRatio: vol.ratio, volOk: vol.ok,
          // Rechter Rand fuer den Sichtbereichs-Filter
          rightIndex: resolvedAt != null ? resolvedAt : Math.min(len - 1, confirmIdx + opts.timeoutBars),
        });
      }

      // ---- Sichtbereich, Deduplizierung, Kappung ----
      let out = setups.filter(s => s.rightIndex >= from && s.lowIndex <= to);

      // Fast identische Setups (gleiches Hoch, minimal anderes Tief)
      const seen = new Set();
      out = out.filter(s => {
        const key = s.highIndex + ":" + Math.round(s.lowIndex / Math.max(1, n));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Neueste zuerst, dann nach Guete — und kappen. Die Anzahl Overlays
      // ist der eigentliche FPS-Faktor, nicht die Rechnung.
      out.sort((a, b) => (b.highIndex - a.highIndex) || (b.quality - a.quality));
      if (opts.maxSetups > 0) out = out.slice(0, opts.maxSetups);
      out.sort((a, b) => a.highIndex - b.highIndex);
      return out;
    },

    // Ehrliche Auswertung ueber alle getriggerten Setups.
    // Beantwortet: wie oft wurde nach dem Box-Kontakt das 1.618-Ziel
    // erreicht, bevor das Start-Tief brach?
    // In der Konsole: EWTEngine.stats(window.__tvGetDataList())
    stats(data, userOpts = {}) {
      const all = this.scan(data, { from: 0, to: data.length - 1 },
                            { ...userOpts, maxSetups: 0 });
      const trig = all.filter(s => s.state === "triggered");
      const byState = {};
      all.forEach(s => { byState[s.state] = (byState[s.state] || 0) + 1; });
      if (!trig.length) return { n: all.length, byState, note: "Keine getriggerten Setups" };
      const ziel   = trig.filter(s => s.outcome === "ziel").length;
      const gebro  = trig.filter(s => s.outcome === "invalidiert").length;
      return {
        n: all.length,
        byState,
        getriggert: trig.length,
        zielErreicht: ziel,
        nachEinstiegGebrochen: gebro,
        nochOffen: trig.length - ziel - gebro,
        // Anteil der Einstiege, die das Ziel VOR dem Bruch erreichten.
        // Das ist eine Trefferquote auf historischen Daten, keine Prognose.
        trefferquotePct: Math.round(ziel / trig.length * 100),
      };
    },
  };

  if (typeof window !== "undefined") window.EWTEngine = EWTEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = EWTEngine;
})();
