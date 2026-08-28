// ============================================================
// TreydView — Elliott-Wellen-Scanner
//
// Erkennt vollstaendige Wellenstrukturen auf mehreren Skalen:
//   • Impuls 1-2-3-4-5   (motive)
//   • Korrektur A-B-C     (corrective, im Anschluss an einen Impuls)
//   • Welle-3-Setup       (Golden Pocket nach Welle 1) — optionaler Modus
//
// ── WARUM DIESE FASSUNG ANDERS IST ──────────────────────────────────
//
// Die erste Fassung suchte nur EIN Bein (Tief -> Hoch) und legte
// darueber sechs Qualitaetsfilter: Mindestbars, Mindestprozent, ATR,
// Efficiency Ratio, RSI und Volumen. Gemessen an 2000 Kerzen blieben von
// 93 Kandidatenpaaren 5.6 uebrig — allein der RSI-Filter verwarf 76 %
// der bis dahin Ueberlebenden, das Volumen nochmals 53 % vom Rest.
// Ergebnis: ein Scanner, der fast nichts fand.
//
// Zwei Konsequenzen daraus:
//
//   1. ERKANNT WIRD JETZT DIE STRUKTUR, NICHT DAS BEIN.
//      Geprueft werden die drei kardinalen Elliott-Regeln plus die
//      Bedingung, dass Welle 5 ein neues Extrem setzt. Mehr braucht es
//      nicht, um von einer Wellenzaehlung zu sprechen.
//
//   2. OSZILLATOREN FILTERN NICHT MEHR, SIE BEWERTEN NUR NOCH.
//      RSI, Volumen und Efficiency Ratio fliessen in eine Guetezahl ein
//      und lassen sich bei Bedarf als Filter zuschalten — standardmaessig
//      aber NICHT. Eine Wellenstruktur ist eine geometrische Aussage;
//      ob gleichzeitig der RSI unter 30 stand, ist eine voellig andere
//      Frage und darf die Zaehlung nicht unterdruecken.
//
// ── DIE GRUNDREGELN GELTEN UNVERAENDERT ─────────────────────────────
//
//   KEIN REPAINTING. Ein Fraktal bei Index i ist erst bei i+swingLength
//   bestaetigt. Eine Struktur gilt erst als erkannt, wenn ihr letzter
//   Punkt bestaetigt ist; vorher wird sie nicht ausgegeben.
//
//   ZWINGEND LOGARITHMISCH. Alle Fibonacci-Rechnungen geometrisch,
//   siehe logRetrace().
// ============================================================

(function () {
  "use strict";

  const DEFAULTS = {
    // ---- Wellengrade ----
    //
    // Ein Wellengrad ist NICHT durch Dauer definiert, sondern durch seine
    // Position in der Verschachtelung: eine Welle heisst "Intermediate",
    // weil sie einen Grad unter der Primary liegt, zu der sie gehoert.
    // Die Dauern unten sind Faustregeln zur Verankerung, keine Definition.
    //
    // Entscheidend ist das VERHAELTNIS zwischen den Graden (~3.3x). Es
    // folgt aus der Selbstaehnlichkeit: ein vollstaendiger Zyklus hat acht
    // Beine (5+3), und jedes Bein ist selbst ein Zyklus der naechsttieferen
    // Ebene. Die fruehere Skala (base, base*1.8, base*3.4) lag zwischen
    // zwei Graden und traf keinen sauber.
    //
    // Das Fraktal-Fenster folgt aus dem KERZENINTERVALL, nicht aus der
    // Chartlaenge. Dadurch heisst dieselbe Struktur auf 1D und 1W gleich,
    // statt einmal "Grad 5" und einmal "Grad 26".
    degreeDefs: [
      { key: "primary",      label: "Primary",      days: 365 },
      { key: "intermediate", label: "Intermediate", days: 120 },
      { key: "minor",        label: "Minor",        days:  35 },
      { key: "minute",       label: "Minute",       days:  10 },
    ],
    // Welche Grade gezeichnet werden. Der naechsttiefere wird intern
    // ZUSAETZLICH gerechnet, weil die Unterteilungspruefung ihn braucht.
    degrees: ["primary", "intermediate"],
    // Gemeinsamer Faktor fuer alle Fenster. Bewusst EIN Wert statt vier
    // Einzelzahlen: das 3.3x-Verhaeltnis ist der inhaltlich bedeutsame
    // Teil, einzeln verschoben zerstoert man die Hierarchie, die den
    // Gradnamen erst rechtfertigt. Krypto laeuft schneller als Aktien —
    // ein Wert um 0.5-0.7 passt fuer BTC oft besser.
    degreeScale: 1.0,

    // ---- Zaehlbasis ----
    //
    // Hoch/Tief oder Schlusskurse. Die Fachwelt ist uneins: verbreitete
    // Lehrtexte empfehlen Schlusskurse, weil Intraday-Spitzen die
    // Wellenverhaeltnisse verzerren — Prechters eigenes System EWAVES
    // benutzt dagegen ausdruecklich Extrema und zeigt gar keine
    // Schlusskurse an. Deshalb waehlbar, Vorgabe wie EWAVES.
    basis: "hl",          // "hl" = Hoch/Tief, "close" = Schlusskurse

    // ---- Unterteilung ----
    //
    // Eine Impulswelle verlangt fuenf Unterwellen in Trendrichtung
    // (5-3-5-3-5). Ohne diese Pruefung ist "Impuls" eine Behauptung: eine
    // korrektive Struktur mit fuenf Beinen kann dieselbe Form haben.
    //
    // Die Pruefung ist DREIWERTIG. "nicht aufloesbar" ist kein
    // Regelverstoss — EWAVES raeumt selbst ein, dass die innere Struktur
    // ueber kurze Intervalle quantisierungsbedingt nicht erkennbar ist und
    // ihr System deshalb ueber Datensegmente "blinzeln" muss.
    checkSubdivision: true,
    requireSubdivision: false,   // als Filter zuschaltbar, Vorgabe aus
    subTolerance: 0.15,          // erlaubter Ueberhang je Wellenende

    // ---- Pivot-Kette ----
    // Mindestbewegung zwischen zwei aufeinanderfolgenden Pivots, in
    // Prozent. Wirkt beim AUFBAU der Kette, nicht als nachtraeglicher
    // Filter — genau so raeumt der Detector Pro das Rauschen weg, ohne
    // ganze Strukturen zu verlieren.
    // Mindestbewegung zwischen zwei Pivots, in Prozent, fuer den
    // FEINSTEN Grad. Groebere Grade bekommen eine groessere Schwelle:
    // ein Grad-17-Pivot beschreibt eine viel groessere Bewegung als ein
    // Grad-5-Pivot und darf nicht dieselbe Rauschschwelle haben.
    // Skaliert mit sqrt(Grad-Verhaeltnis) — die typische Schwungweite
    // waechst bei einem Zufallspfad mit der Wurzel der Fensterbreite.
    minPivotPercent: 1.5,

    // ---- Struktur ----
    // Welle 5 muss ueber Welle 3 hinaus.
    //
    // Default AUS: eine verkuerzte Fuenfte (truncated fifth) ist kein
    // Zaehlfehler, sondern ein Erschoepfungszeichen — oft die Vorwarnung
    // vor einer scharfen Umkehr. Sie auszublenden verwirft genau die
    // Strukturen, die am meisten aussagen. Betroffene Zaehlungen tragen
    // das Feld `truncated` und werden im Chart gekennzeichnet.
    requireWave5NewExtreme: false,
    allowDiagonal: false,          // Diagonalen duerfen Regel 3 verletzen

    // ---- Flexible Wellengrenzen (Skip-Suche) ----
    //
    // Der entscheidende Punkt: eine Teilwelle darf Zwischenextrema
    // ueberspringen. Ohne das muss ein ganzer Wellenzug in EINER
    // Fraktal-Aufloesung liegen — real braucht Welle 1 aber oft eine
    // groebere als Welle 3, und dann wird gar nichts gefunden.
    //
    // Uebernommen aus dem WaveOptionsGenerator5 des Python-Projekts,
    // aber gedeckelt: dort sind es bei up_to=10 rund 66'000
    // Kombinationen pro Startindex. maxSkip=2 ergibt 3^5 = 243, und mit
    // dem fruehen Abbruch ungueltiger Teilwellen bleibt das im Browser
    // bezahlbar. Durchprobiert wird aufsteigend nach Skip-Summe, die
    // erste gueltige Zaehlung gewinnt — kuerzeste Wellen zuerst.
    maxSkip: 2,

    // ---- Regelstrenge ----
    //   locker  nur die drei kardinalen Regeln
    //   mittel  + Proportionen (W2-Mindestkorrektur, W3 ueber W1, W5-Deckel)
    //   streng  + Dauer-Verhaeltnisse, wie im Python-Regelsatz
    strictness: "mittel",

    // ---- Korrektur ----
    detectAbc: true,
    abcMaxRetrace: 0.854,          // C darf hoechstens so viel zurueckholen

    // ---- Korrekturformen ----
    //
    // Die Elliott-Lehre kennt drei Grundformen der Dreierkorrektur, die
    // sich im Verhalten von Welle B unterscheiden:
    //
    //   Zigzag (5-3-5)         B bleibt deutlich innerhalb von A
    //   Flat   (3-3-5)         B laeuft praktisch bis an den A-Start
    //   Expanded Flat (3-3-5)  B laeuft UEBER den A-Start hinaus
    //
    // Eine frueher hier stehende Fassung liess nur B ∈ [0.35, 0.618] zu
    // und verlangte zusaetzlich, dass B den Impulsgipfel nicht
    // ueberschreitet — damit waren Flat und Expanded Flat per Konstruktion
    // ausgeschlossen. Gemessen fielen dadurch 82 % aller Kandidaten durch;
    // der Median des B/A-Verhaeltnisses lag bei 1.25, also mitten im
    // Expanded-Flat-Bereich.
    //
    // Die Obergrenze von 1.38 ist wesentlich: laeuft B noch weiter, ist es
    // keine Korrektur mehr, sondern ein neuer Impuls in Gegenrichtung.
    abcZigzagB: [0.382, 0.786], abcZigzagC: [0.618, 1.900],
    abcFlatB:   [0.786, 1.050], abcFlatC:   [0.700, 1.500],
    abcExpB:    [1.050, 1.382], abcExpC:    [1.000, 2.618],

    // ---- Welle-3-Setup (eigener Modus) ----
    detectSetups: true,
    gpTop: 0.5,
    gpBottom: 0.618,
    extension: 1.618,
    timeoutBars: 60,
    invalidateOnWick: false,
    setupMinPercent: 3.0,
    setupMinBars: 4,

    // ---- Bewertung (KEINE Filter, ausser explizit eingeschaltet) ----
    rsiPeriod: 14,
    rsiOversold: 30,
    requireRsi: false,
    requireVolume: false,
    requireEfficiency: false,
    minEfficiency: 0.30,

    // ---- Projektion ----
    projectWaves: true,
    w3Ratio: 1.618, w3RatioX: 2.618,
    w4Top: 0.236, w4Bottom: 0.382,
    // Welle 5 haengt davon ab, ob Welle 3 laenger als Welle 1 ist:
    //   W3 > W1  ->  Welle 5 strebt 1.0 x Welle 1
    //   W3 < W1  ->  Welle 5 misst sich an Welle 3 (0.382)
    // Ein fester Faktor unterschlaegt diese Fallunterscheidung.
    w5Ratio: 1.0, w5RatioShort: 0.382,
    waveARatio: 0.382, waveBRatio: 0.5, waveCRatio: 1.0,
    maxProjBars: 90,

    // ---- Ausgabe ----
    // Der eigentliche FPS-Faktor ist die Overlay-Anzahl, nicht die
    // Rechnung: KLineCharts zeichnet jedes Overlay bei jedem Frame neu.
    maxImpulses: 12,
    maxSetups: 6,
  };

  // ============================================================
  // 1. Kennzahlen
  // ============================================================

  function wilderRsi(closes, period) {
    const n = closes.length, out = new Array(n).fill(null);
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

  // ── LOGARITHMISCHES RETRACEMENT ──────────────────────────────────
  //
  //   retrace(H, L, r) = exp( ln H − r·(ln H − ln L) ) = H^(1−r) · L^r
  //
  //   r = 0     -> H          r = 0.5 -> sqrt(H·L), das geometrische
  //   r = 1     -> L                     Mittel, NICHT das arithmetische
  //
  // ACHTUNG: die Fassung H^r · L^(1−r) liefert bei r = 0.618 das
  // 0.382-Level. Das Komplement gehoert an den Exponenten von H.
  // Fuer nicht-positive Kurse Rueckfall auf linear statt NaN.
  function logRetrace(high, low, r) {
    if (!(high > 0) || !(low > 0)) return high - r * (high - low);
    return Math.exp(Math.log(high) - r * (Math.log(high) - Math.log(low)));
  }

  function logExtend(anchor, high, low, mult) {
    if (!(anchor > 0) || !(high > 0) || !(low > 0)) return anchor + mult * (high - low);
    return anchor * Math.pow(high / low, mult);
  }

  const pct = (a, b) => (a !== 0 ? Math.abs((b - a) / a) * 100 : 0);

  // ============================================================
  // 2. Fraktale und Pivot-Kette
  // ============================================================
  //
  // confirmIndex = i + n: erst dann ist das Fenster rechts vollstaendig
  // und das Fraktal ueberhaupt erkennbar. Daran haengt die gesamte
  // Repainting-Freiheit.
  //
  // Gleichstaende: links strikt, rechts erlaubend. Ohne diese Asymmetrie
  // liefert ein Plateau aus zwei exakt gleichen Hochs GAR KEIN Fraktal.
  function findFractals(data, n, basis) {
    const out = [], len = data.length;
    if (len < 2 * n + 1) return out;
    // Auf Schlusskursbasis sind Hoch und Tief derselbe Wert — Doechte
    // fallen weg, Ausreisser koennen die Zaehlung nicht mehr kippen.
    const useClose = basis === "close";
    const HI = (i) => useClose ? data[i].close : data[i].high;
    const LO = (i) => useClose ? data[i].close : data[i].low;
    for (let i = n; i < len - n; i++) {
      const h = HI(i), l = LO(i);
      let isHigh = true, isLow = true;
      for (let j = i - n; j < i; j++) {
        if (HI(j) >= h) isHigh = false;
        if (LO(j) <= l) isLow  = false;
        if (!isHigh && !isLow) break;
      }
      if (!isHigh && !isLow) continue;
      for (let j = i + 1; j <= i + n; j++) {
        if (HI(j) > h) isHigh = false;
        if (LO(j) < l) isLow  = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) out.push({ index: i, price: h, type: "high", confirmIndex: i + n });
      if (isLow)  out.push({ index: i, price: l, type: "low",  confirmIndex: i + n });
    }
    return out.sort((a, b) => a.index - b.index || (a.type === "low" ? -1 : 1));
  }

  // Alternierende Kette H-L-H-L mit Mindestbewegung.
  //
  // Zwei gleichartige Punkte hintereinander: der extremere gewinnt.
  // Ein Wechsel wird nur akzeptiert, wenn die Bewegung gross genug ist —
  // sonst zerlegt Rauschen jede grosse Welle in Dutzende Miniwellen und
  // keine Struktur ueberlebt die Regelpruefung.
  function buildChain(points, minPct) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last) { out.push(p); continue; }
      if (last.type === p.type) {
        const better = p.type === "high" ? p.price > last.price : p.price < last.price;
        if (better) out[out.length - 1] = p;
        continue;
      }
      // Richtungswechsel: nur bei ausreichender Bewegung
      if (pct(last.price, p.price) < minPct) continue;
      out.push(p);
    }
    return out;
  }

  // ── WELLENGRADE AUS DEM KERZENINTERVALL ABLEITEN ────────────────
  //
  // n = (Wellendauer / Kerzenintervall) / 2, mal dem gemeinsamen Faktor.
  // Ergibt sich ein Fenster unter 2, ist der Grad fuer dieses Intervall
  // zu fein — dann gibt es dort schlicht nichts zu sehen, und das wird
  // gemeldet statt stillschweigend uebersprungen.
  function ableitenGrade(data, opts) {
    const len = data.length;
    if (len < 3) return [];
    // Median der letzten Abstaende: einzelne Datenluecken sollen die
    // Intervallerkennung nicht kippen.
    const d = [];
    for (let i = Math.max(1, len - 40); i < len; i++) {
      const x = data[i].timestamp - data[i - 1].timestamp;
      if (x > 0) d.push(x);
    }
    if (!d.length) return [];
    d.sort((a, b) => a - b);
    const barMs = d[Math.floor(d.length / 2)];
    const skala = opts.degreeScale > 0 ? opts.degreeScale : 1;
    return (opts.degreeDefs || []).map(def => {
      const bars = (def.days * 86400000) / barMs;
      const n = Math.round((bars / 2) * skala);
      return { ...def, n, zuFein: n < 2, barMs };
    });
  }

  // ============================================================
  // 3. Die kardinalen Elliott-Regeln
  // ============================================================
  //
  // Punkte p0..p5 einer Impulsstruktur:
  //   p0 Start Welle 1   p1 Ende Welle 1   p2 Ende Welle 2
  //   p3 Ende Welle 3    p4 Ende Welle 4   p5 Ende Welle 5
  //
  //   Regel 1  Welle 2 gibt Welle 1 nicht vollstaendig zurueck
  //   Regel 2  Welle 3 ist nicht die kuerzeste von 1, 3 und 5
  //   Regel 3  Welle 4 laeuft nicht in das Gebiet von Welle 1
  //   Regel 4  Welle 5 setzt ein neues Extrem jenseits von Welle 3
  //
  // Regel 1-3 sind die klassischen, unverhandelbaren Regeln; beide
  // Referenz-Indikatoren pruefen exakt diese. Regel 4 ist streng
  // genommen keine Regel, sondern schliesst nur verkuerzte Fuenfte
  // (failed fifth) aus — deshalb abschaltbar.
  function checkRules(p, bull, opts) {
    const P = p.map(x => x.price);
    const [p0, p1, p2, p3, p4, p5] = P;
    const w1 = Math.abs(p1 - p0), w2 = Math.abs(p2 - p1);
    const w3 = Math.abs(p3 - p2), w4 = Math.abs(p4 - p3), w5 = Math.abs(p5 - p4);
    const d = (a, b) => Math.max(1, Math.abs(p[b].index - p[a].index));
    const d1 = d(0, 1), d2 = d(1, 2), d3 = d(2, 3), d4 = d(3, 4);

    // ---- Kardinal, immer geprueft ----
    const r1 = bull ? p2 > p0 : p2 < p0;
    const r2 = !(w3 < w1 && w3 < w5);
    const r3 = opts.allowDiagonal ? true : (bull ? p4 > p1 : p4 < p1);
    const r4 = !opts.requireWave5NewExtreme ? true : (bull ? p5 > p3 : p5 < p3);

    // ---- Struktur-Integritaet ----
    // Welle 2 muss das tiefste Tief bis Welle 4 bleiben. Steht dazwischen
    // ein tieferes, ist die Zaehlung hinfaellig. Entspricht der Pruefung
    // wave2.low > min(lows[wave2 .. wave4]) im Python-Analyzer.
    const rInt = bull ? p4 >= p2 : p4 <= p2;

    const lvl = opts.strictness || "mittel";
    let prop = true, dur = true;
    if (lvl === "mittel" || lvl === "streng") {
      prop =
        w2 >= 0.2 * w1 &&                        // W2 korrigiert mindestens 20 %
        (bull ? p3 > p1 : p3 < p1) &&            // W3 ueberschreitet W1-Ende
        w3 >= w1 / 3 &&                          // W3 nicht verkuemmert
        w3 > w2 &&                               // W3 laenger als W2
        w4 > w2 / 3 &&                           // W4 nicht verkuemmert
        w5 < 2.0 * w1;                           // W5 kein Ausreisser
    }
    if (lvl === "streng") {
      // Dauer-Verhaeltnisse aus dem Python-Regelsatz (w2_3, w3_5).
      dur = 9 * d2 > d1 && 7 * d3 > d1 && d4 > 0;
    }

    const all = r1 && r2 && r3 && r4 && rInt && prop && dur;

    // ---- Leitlinie der Alternation ----
    // Ist Welle 2 eine scharfe, tiefe Korrektur, faellt Welle 4 eher flach
    // und seitwaerts aus — und umgekehrt. Die beiden Korrekturen innerhalb
    // eines Impulses gleichen sich selten. Das ist eine LEITLINIE, keine
    // Regel: sie schliesst nichts aus, sie bewertet nur.
    const dep2 = w1 > 0 ? w2 / w1 : 0;      // Ruecklauf von Welle 2
    const dep4 = w3 > 0 ? w4 / w3 : 0;      // Ruecklauf von Welle 4
    const dur2 = d1 > 0 ? d2 / d1 : 0;      // Zeitverhaeltnis
    const dur4 = d3 > 0 ? d4 / d3 : 0;
    // Je staerker sich Tiefe UND Dauer unterscheiden, desto besser passt
    // die Alternation. Normiert auf 0..1.
    const alternation = Math.max(0, Math.min(1,
      0.6 * Math.min(1, Math.abs(dep2 - dep4) / 0.35) +
      0.4 * Math.min(1, Math.abs(dur2 - dur4) / 1.0)));

    // ---- Verlaengerte Welle und Regel der Gleichheit ----
    // Eine der drei Impulswellen ist typischerweise verlaengert, meist
    // Welle 3. Ist sie es, streben Welle 1 und Welle 5 zur Gleichheit.
    // Ist Welle 3 laenger als Welle 1? Entscheidet ueber das Welle-5-Ziel.
    const w3Dominant = w3 > w1;
    const extended = (w3 > 1.618 * w1 && w3 > 1.618 * w5) ? 3
                   : (w5 > 1.618 * w1 && w5 > 1.618 * w3) ? 5
                   : (w1 > 1.618 * w3 && w1 > 1.618 * w5) ? 1 : 0;
    const equality = (extended === 3 && w1 > 0)
      ? Math.max(0, 1 - Math.abs(w5 / w1 - 1) / 0.5)
      : null;

    return { r1, r2, r3, r4, rInt, prop, dur, all,
             w1, w2, w3, w4, w5, dep2, dep4, alternation, extended, equality,
             w3Dominant };
  }

  // Ist die Teilwelle von Ketten-Index a nach b sauber?
  //
  // "Sauber" heisst: kein Zwischenhoch ueberragt das Endhoch und kein
  // Zwischentief unterschreitet das Starttief. Genau das leisten im
  // Python-Projekt find_end() und die np.min/np.max-Pruefungen — ohne sie
  // wuerde ein Skip ueber ein tieferes Tief hinweg eine Welle behaupten,
  // die es nicht gibt.
  function legClean(chain, a, b, up) {
    const start = chain[a].price, end = chain[b].price;
    if (up ? !(end > start) : !(end < start)) return false;
    for (let i = a + 1; i < b; i++) {
      const q = chain[i];
      if (up) {
        if (q.type === "high" && q.price >= end)   return false;
        if (q.type === "low"  && q.price <= start) return false;
      } else {
        if (q.type === "low"  && q.price <= end)   return false;
        if (q.type === "high" && q.price >= start) return false;
      }
    }
    return true;
  }

  // ── ANPASSUNGSFEHLER ────────────────────────────────────────────
  //
  // Beantwortet objektiv, was eine handgewichtete Punkteformel nur raten
  // kann: welche von mehreren konkurrierenden Zaehlungen beschreibt den
  // Kursverlauf tatsaechlich am besten? Fuer jedes Wellensegment wird die
  // Sehne zwischen den Endpunkten gezogen und gemessen, wie weit der
  // echte Kurs davon abweicht. Kleiner Fehler = die Zaehlung liegt an der
  // Bewegung, statt sie zu behaupten.
  //
  // Zwei Abweichungen vom Vorbild (elliottWaveLinearRegressionError):
  //
  //   1. Gerechnet wird im LOG-Raum. Im Preisraum haengt der Fehler am
  //      Kursniveau — bei BTC um 60'000 kaeme etwas voellig anderes heraus
  //      als bei einem Index um 100, und die Werte waeren zwischen Assets
  //      nicht vergleichbar. Im Log-Raum ist der Wert eine mittlere
  //      RELATIVE Abweichung und damit dimensionslos.
  //
  //   2. Normiert wird mit sqrt(Spanne), nicht mit der Spanne selbst.
  //      Der rohe Fehler waechst mit der Wellenlaenge (gemessen: rho =
  //      0.78) — ohne Normierung gaelten lange Wellen pauschal als
  //      schlecht und grobe Wellengrade waeren chancenlos. Die Abweichung
  //      von einer Sehne waechst bei einem Random Walk mit sqrt(t);
  //      gemessen ueber 205 Impulse bleibt damit eine Restkorrelation von
  //      0.05, waehrend die Normierung mit der Spanne selbst deutlich
  //      ueberkorrigiert.
  // Praefixsummen fuer den Anpassungsfehler. Ohne sie laeuft die Rechnung
  // ueber jede Kerze jedes Kandidaten — gemessen 121 ms statt 26 ms auf
  // 5000 Kerzen. Damit wird jedes Segment O(1).
  function fitPrefix(logCloses) {
    const n = logCloses.length;
    const sy = new Float64Array(n + 1), syy = new Float64Array(n + 1), sxy = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const y = (logCloses[i] != null && isFinite(logCloses[i])) ? logCloses[i] : 0;
      sy[i + 1]  = sy[i]  + y;
      syy[i + 1] = syy[i] + y * y;
      sxy[i + 1] = sxy[i] + i * y;
    }
    return { sy, syy, sxy };
  }

  function fitError(pre, pts) {
    let sq = 0, cnt = 0;
    for (let k = 1; k < pts.length; k++) {
      const x1 = pts[k - 1].index, x2 = pts[k].index;
      const p1 = pts[k - 1].price, p2 = pts[k].price;
      if (!(p1 > 0) || !(p2 > 0) || x2 <= x1) continue;
      const n = x2 - x1;
      const y1 = Math.log(p1), m = (Math.log(p2) - y1) / n;

      // Fensterssummen aus den Praefixsummen
      const Sy  = pre.sy[x2]  - pre.sy[x1];
      const Syy = pre.syy[x2] - pre.syy[x1];
      const Sxy = pre.sxy[x2] - pre.sxy[x1];

      // Auf den Segmentanfang zentriert rechnen (x' = x - x1, y' = y - y1).
      // Ohne diese Verschiebung entstehen bei Index 5000 Summen um 1e7,
      // aus denen ein Ergebnis der Groessenordnung 0.1 herausgezogen
      // werden muesste — Ausloeschung, die das Resultat unbrauchbar macht.
      const Sy2  = Syy - 2 * y1 * Sy + n * y1 * y1;                       // Σ y'²
      const Sxy2 = Sxy - y1 * (n * x1 + n * (n - 1) / 2)
                       - x1 * Sy + n * x1 * y1;                            // Σ x'y'
      const Sxx2 = (n - 1) * n * (2 * n - 1) / 6;                          // Σ x'²

      sq += Math.max(0, Sy2 - 2 * m * Sxy2 + m * m * Sxx2);
      cnt += n;
    }
    if (!cnt) return null;
    const span = Math.max(1, pts[pts.length - 1].index - pts[0].index);
    const raw = Math.sqrt(sq / cnt);
    // Der Normierungsexponent ist NICHT universell. Er wurde an
    // synthetischen Zufallspfaden bestimmt, wo er per Konstruktion 0.5
    // sein muss. Echte Maerkte liegen je nach Skala eher darueber.
    // calibrateBeta() misst ihn an echten Daten nach.
    return { raw, norm: raw / Math.pow(span, FIT_BETA.value), span };
  }

  // Veraenderbar, damit die Kalibrierung greifen kann, ohne dass jede
  // Aufrufstelle einen Parameter durchreichen muss.
  const FIT_BETA = { value: 0.5 };

  // ============================================================
  // 4. Projektion der Folgewellen
  // ============================================================
  //
  // KEINE PROGNOSE. Die mechanische Fortschreibung der Verhaeltnisse,
  // die die Elliott-Lehre unterstellt — es kommt keine Information aus
  // den Daten hinzu, die nicht schon in Welle 1 steckt. Die Zeitachse
  // ist der schwaechste Teil und sagt nichts darueber aus, WANN etwas
  // eintritt.
  function buildProjection(L, H, anchor, measured, barsW1, opts, w3Dominant) {
    if (!(anchor > 0) || !(H > 0) || !(L > 0)) return null;
    const w3  = logExtend(anchor, H, L, opts.w3Ratio);
    const w3x = logExtend(anchor, H, L, opts.w3RatioX);
    if (!isFinite(w3) || !isFinite(w3x)) return null;
    const w4Top = logRetrace(w3, anchor, opts.w4Top);
    const w4Bot = logRetrace(w3, anchor, opts.w4Bottom);
    // Verletzt die eigene Projektion Regel 3, ist die Zaehlung in sich
    // unstimmig — das wird gemeldet statt huebsch gezeichnet.
    const w4Conflict = w4Bot <= H;
    // Bedingtes Welle-5-Ziel (siehe w5Ratio oben). Bei kuerzerer Welle 3
    // misst sich Welle 5 an Welle 3, nicht an Welle 1.
    const w5 = w3Dominant === false
      ? logExtend(w4Bot, w3, anchor, opts.w5RatioShort)
      : logExtend(w4Bot, H, L, opts.w5Ratio);
    const waveA = logRetrace(w5, L, opts.waveARatio);
    const waveB = logRetrace(w5, waveA, opts.waveBRatio);
    const waveC = waveA > 0 && w5 > 0
      ? waveB * Math.pow(waveA / w5, opts.waveCRatio)
      : waveB - opts.waveCRatio * (w5 - waveA);

    const raw = { w3: barsW1 * 1.618, w4: barsW1 * 0.618, w5: barsW1 * 1.0,
                  a: barsW1 * 1.0, b: barsW1 * 0.618, c: barsW1 * 1.0 };
    const tot = raw.w3 + raw.w4 + raw.w5 + raw.a + raw.b + raw.c;
    const k = tot > opts.maxProjBars ? opts.maxProjBars / tot : 1;
    const R = (v) => Math.max(1, Math.round(v * k));
    return {
      basis: measured ? "gemessen" : "angenommen",
      anchor, w3, w3x, w4Top, w4Bot, w5, waveA, waveB, waveC, w4Conflict,
      barsW3: R(raw.w3), barsW4: R(raw.w4), barsW5: R(raw.w5),
      barsA: R(raw.a), barsB: R(raw.b), barsC: R(raw.c),
      totalBars: R(raw.w3) + R(raw.w4) + R(raw.w5) + R(raw.a) + R(raw.b) + R(raw.c),
    };
  }

  // ============================================================
  // 5. Scanner
  // ============================================================

  const EWTEngine = {
    DEFAULTS, logRetrace, logExtend, findFractals, buildChain, checkRules,

    // Fenstergroesse (n) je Wellengrad fuer das aktuelle Kerzenintervall.
    // Exponiert die interne Ableitung `ableitenGrade`, damit das Panel
    // GENAU dieselbe Rechnung anzeigt wie der Scanner — kein zweiter,
    // driftender Rechenweg im UI. Rueckgabe je Grad:
    // { key, label, days, n, zuFein, barMs }.
    degreeWindows(data, userOpts = {}) {
      return ableitenGrade(data || [], { ...DEFAULTS, ...userOpts });
    },

    // Bewusst OHNE slice(): es wird auf globalen Indizes gerechnet und
    // erst am Ende nach Sichtbereich gefiltert. patterns.js sliced und
    // rechnet Indizes zurueck — dort steht ein langer Kommentar ueber die
    // Bugs, die das erzeugt hat. Bei 5000 Kerzen ist der Slice-Gewinn
    // nicht messbar, die Fehlerklasse aber vermieden.
    scan(data, range, userOpts = {}) {
      const opts = { ...DEFAULTS, ...userOpts };
      const len = data ? data.length : 0;
      if (len < 30) return { impulses: [], abcs: [], setups: [] };

      const from = Math.max(0, range && range.from != null ? range.from : 0);
      const to   = Math.min(len - 1, range && range.to != null ? range.to : len - 1);

      // ---- Wellengrade bestimmen ----
      //
      // Die frueher hier stehende Deckelung (degMax = Kerzen/30) war ein
      // Notbehelf gegen eine Skala, die Grade erzeugte, die es gar nicht
      // geben konnte. Mit aus dem Intervall abgeleiteten Graden entfaellt
      // sie: die einzige sinnvolle Bedingung ist, ob die Pivot-Kette
      // ueberhaupt sechs Punkte fuer EINE Zaehlung hergibt.
      //
      // Zusaetzlich zu den angezeigten Graden wird der naechsttiefere
      // mitgerechnet — die Unterteilungspruefung braucht ihn, auch wenn
      // er nicht gezeichnet wird.
      const alleGrade = ableitenGrade(data, opts);
      const gewaehlt = new Set(opts.degrees || []);
      const zeigen = alleGrade.filter(g => gewaehlt.has(g.key) && !g.zuFein);
      const zuFein  = alleGrade.filter(g => gewaehlt.has(g.key) && g.zuFein);

      // Feinster gewaehlter Grad -> sein Nachfolger dient nur der Pruefung
      let rechnen = zeigen.slice();
      if (opts.checkSubdivision && zeigen.length) {
        const idx = alleGrade.findIndex(g => g.key === zeigen[zeigen.length - 1].key);
        const kind = alleGrade[idx + 1];
        if (kind && !kind.zuFein && !gewaehlt.has(kind.key)) {
          rechnen = rechnen.concat([{ ...kind, nurPruefung: true }]);
        }
      }
      if (!rechnen.length) {
        return { impulses: [], abcs: [], setups: [],
                 degreesUsed: [], degreesTooFine: zuFein, alleGrade };
      }

      // ---- Kennzahlen einmal ueber den vollen Datensatz ----
      const closes = new Array(len), logCloses = new Array(len);
      for (let i = 0; i < len; i++) {
        closes[i] = data[i].close;
        logCloses[i] = data[i].close > 0 ? Math.log(data[i].close) : null;
      }
      const rsi = wilderRsi(closes, opts.rsiPeriod);
      const fitPre = fitPrefix(logCloses);

      const upV = new Float64Array(len + 1), dnV = new Float64Array(len + 1);
      const upC = new Int32Array(len + 1),   dnC = new Int32Array(len + 1);
      const adp = new Float64Array(len + 1);
      for (let i = 0; i < len; i++) {
        const v = data[i].volume || 0, up = data[i].close >= data[i].open;
        upV[i + 1] = upV[i] + (up ? v : 0);  dnV[i + 1] = dnV[i] + (up ? 0 : v);
        upC[i + 1] = upC[i] + (up ? 1 : 0);  dnC[i + 1] = dnC[i] + (up ? 0 : 1);
        adp[i + 1] = adp[i] + (i > 0 ? Math.abs(closes[i] - closes[i - 1]) : 0);
      }
      // Kaufman Efficiency Ratio in O(1)
      const eff = (a, b) => {
        if (b <= a) return 0;
        const dir = Math.abs(closes[b] - closes[a]);
        const path = adp[b + 1] - adp[a + 1];
        return path > 0 ? dir / path : 0;
      };
      // Volumen-Konfluenz: true / false / null.
      // null = keine belastbaren Daten (Indizes, Gold ueber FRED) und
      // laesst durch, statt dort alles zu blockieren.
      const volConf = (l, h, corrEnd) => {
        if (corrEnd >= len) return { ok: null, ratio: null };
        const us = upV[h + 1] - upV[l], uc = upC[h + 1] - upC[l];
        const ds = dnV[corrEnd + 1] - dnV[h + 1], dc = dnC[corrEnd + 1] - dnC[h + 1];
        if (uc === 0 || dc === 0 || (us === 0 && ds === 0)) return { ok: null, ratio: null };
        const au = us / uc, ad = ds / dc;
        if (ad === 0) return { ok: true, ratio: null };
        return { ok: au > ad, ratio: au / ad };
      };

      const impulses = [], abcs = [], setups = [];

      // ---- Je Wellengrad einmal durchgehen ----
      for (const grad of rechnen) {
        const n = grad.n;
        if (len < 2 * n + 8) continue;
        // Keine Skalierung der Pivot-Schwelle mehr nach Grad.
        //
        // Sie brachte gemessen fast nichts (54 -> 52 Pivots bei Grad 17)
        // und wurde mit den abgeleiteten Graden sogar schaedlich: Scan und
        // Diagnose bezogen sie auf unterschiedliche Referenzgrade, wodurch
        // der Scan die Schwelle auf 4.8 % zog und Strukturen verwarf, die
        // die Diagnose noch meldete. Das Fraktal-Fenster leistet die
        // gradgerechte Filterung ohnehin; die Prozentschwelle raeumt nur
        // Rauschen weg und darf fuer alle Grade gleich sein.
        const chain = buildChain(findFractals(data, n, opts.basis),
                                 opts.minPivotPercent);
        if (chain.length < 6) continue;

        // ================= Impuls 1-2-3-4-5 =================
        //
        // Statt sechs STARR aufeinanderfolgender Pivots wird pro Teilwelle
        // eine Skip-Tiefe gesucht: Welle 1 darf Zwischenextrema
        // ueberspringen, Welle 3 unabhaengig davon eine andere Zahl. Ohne
        // das muss der ganze Zug in einer Aufloesung liegen — und genau
        // daran scheiterte die vorige Fassung.
        //
        // Pro Startpunkt gewinnt die erste gueltige Zaehlung; die Tupel
        // sind nach Skip-Summe sortiert, also kuerzeste Wellen zuerst.
        const MS = Math.max(0, Math.min(4, opts.maxSkip | 0));

        for (let k = 0; k + 5 < chain.length; k++) {
          const bull = chain[k].type === "low";

          // Verschachtelte Schleifen statt einer flachen Tupelliste.
          //
          // Die flache Variante prueft Welle 1 fuer jede der Kombinationen
          // dahinter erneut; bei maxSkip=2 also 81-mal dasselbe. Scheitert
          // Welle 1 hier, sind alle 81 Nachfolger mit einem Schlag erledigt.
          // Gemessen auf 5000 Kerzen: 88 ms -> siehe unten.
          //
          // Die Reihenfolge bleibt aufsteigend (lexikografisch), es wird
          // also weiterhin die kuerzeste gueltige Zaehlung zuerst gefunden.
          let found = null;
          for (let s1 = 0; s1 <= MS; s1++) {
            const i1 = k + 1 + 2 * s1;
            if (i1 >= chain.length) break;
            if (!legClean(chain, k, i1, bull)) continue;

            for (let s2 = 0; s2 <= MS; s2++) {
              const i2 = i1 + 1 + 2 * s2;
              if (i2 >= chain.length) break;
              if (!legClean(chain, i1, i2, !bull)) continue;

              for (let s3 = 0; s3 <= MS; s3++) {
                const i3 = i2 + 1 + 2 * s3;
                if (i3 >= chain.length) break;
                if (!legClean(chain, i2, i3, bull)) continue;

                for (let s4 = 0; s4 <= MS; s4++) {
                  const i4 = i3 + 1 + 2 * s4;
                  if (i4 >= chain.length) break;
                  if (!legClean(chain, i3, i4, !bull)) continue;

                  for (let s5 = 0; s5 <= MS; s5++) {
                    const i5 = i4 + 1 + 2 * s5;
                    if (i5 >= chain.length) break;
                    if (!legClean(chain, i4, i5, bull)) continue;

                    const pp = [chain[k], chain[i1], chain[i2], chain[i3], chain[i4], chain[i5]];
                    const rr = checkRules(pp, bull, opts);
                    if (!rr.all) continue;
                    // Non-Repainting: erst wenn der LETZTE Punkt bestaetigt ist.
                    if (pp[5].confirmIndex >= len) continue;

                    // Nicht die ERSTE gueltige Zaehlung nehmen, sondern die
                    // BESTE. Welche zuerst kommt, haengt an der
                    // Iterationsreihenfolge — ein Implementierungsdetail.
                    // Beim Wechsel von summen- auf lexikografische
                    // Reihenfolge fielen die Treffer von 33 auf 25, ohne
                    // dass sich an den Daten etwas geaendert haette.
                    // Entscheidend ist stattdessen der Anpassungsfehler:
                    // welche Zaehlung liegt tatsaechlich am Kursverlauf?
                    const fpts = pp.map(x => ({ index: x.index, price: x.price }));
                    const fer = fitError(fitPre, fpts);
                    const score = fer == null ? Infinity : fer.norm;
                    if (!found || score < found.score) {
                      found = { p: pp, rules: rr, skips: [s1, s2, s3, s4, s5],
                                endChainIdx: i5, fe: fer, score };
                    }
                  }
                }
              }
            }
          }
          if (!found) continue;

          const { p, rules } = found;
          const rr2 = rules;
          const i0 = p[0].index, i5x = p[5].index;
          const lo = bull ? p[0].price : p[5].price;
          const hi = bull ? p[5].price : p[0].price;

          // ---- Momentum-Divergenz Welle 5 gegen Welle 3 ----
          //
          // Setzt Welle 5 ein neues Kursextrem, ohne dass der RSI das
          // Extrem von Welle 3 uebertrifft, ist der Impuls erschoepft —
          // die klassische Divergenz am Ende einer Fuenferstruktur.
          //
          // BEWERTUNG, kein Filter: eine Zaehlung ohne Divergenz ist nicht
          // falsch, nur weniger reif.
          const rsi3 = rsi[p[3].index], rsi5 = rsi[p[5].index];
          let momDiv = null;
          if (rsi3 != null && rsi5 != null) {
            momDiv = bull ? (p[5].price > p[3].price && rsi5 < rsi3)
                          : (p[5].price < p[3].price && rsi5 > rsi3);
          }

          const er = eff(Math.min(i0, i5x), Math.max(i0, i5x));
          const v = volConf(Math.min(p[0].index, p[1].index),
                            Math.max(p[0].index, p[1].index),
                            Math.max(p[0].index, p[1].index) + Math.max(n, 3));
          if (opts.requireEfficiency && er < opts.minEfficiency) continue;
          if (opts.requireVolume && v.ok === false) continue;

          // Beschreibend, keine Trefferwahrscheinlichkeit: wie nah liegen
          // die Verhaeltnisse an den klassischen Werten?
          const r31 = rules.w1 > 0 ? rules.w3 / rules.w1 : 0;
          const r51 = rules.w1 > 0 ? rules.w5 / rules.w1 : 0;
          const r21 = rules.w1 > 0 ? rules.w2 / rules.w1 : 0;
          const near = (x, t2) => Math.max(0, 1 - Math.abs(x - t2) / t2);
          // Anpassungsfehler: 0.0015 ist der gemessene Median ueber 205
          // Impulse und dient als Halbwertspunkt — dort ergibt sich 0.5.
          const fe = found.fe ? found.fe.norm : null;
          const feRaw = found.fe ? found.fe.raw : null;
          const feSpan = found.fe ? found.fe.span : null;
          const fitScore = fe == null ? 0.5 : 1 / (1 + fe / 0.0015);
          // Ist Welle 3 verlaengert, zaehlt zusaetzlich die Gleichheit von
          // Welle 1 und 5; sonst faellt der Beitrag neutral aus.
          const eqScore = rr2.equality == null ? 0.5 : rr2.equality;
          const momScore = momDiv == null ? 0.5 : (momDiv ? 1 : 0.4);
          const quality = Math.max(0, Math.min(1,
            0.08 * momScore +
            0.22 * fitScore +
            0.18 * near(r31, 1.618) + 0.09 * near(r51, 1.0) +
            0.07 * near(r21, 0.618) +
            0.13 * rr2.alternation +
            0.08 * eqScore +
            0.07 * Math.min(1, er / 0.5) +
            0.08 * (v.ratio == null ? 0.5 : Math.min(1, v.ratio / 2))));

          impulses.push({
            kind: "impulse", degree: n, degreeKey: grad.key, degreeLabel: grad.label,
            nurPruefung: !!grad.nurPruefung, dir: bull ? "bull" : "bear",
            points: p.map(x => ({ index: x.index, price: x.price })),
            chainPos: k, confirmIndex: p[5].confirmIndex,
            skips: found.skips,
            w1: rules.w1, w3: rules.w3, w5: rules.w5,
            ratio31: r31, ratio51: r51, ratio21: r21,
            rules: { r1: rules.r1, r2: rules.r2, r3: rules.r3, r4: rules.r4,
                     rInt: rules.rInt, prop: rules.prop, dur: rules.dur },
            er, rsiAtEnd: rsi[i5x], volRatio: v.ratio, quality,
            fitError: fe, fitErrorRaw: feRaw, fitSpan: feSpan, fitScore,
            momDiv, rsi3, rsi5, w3Dominant: rr2.w3Dominant,
            // Verkuerzte Fuenfte: Welle 5 erreicht das Extrem von Welle 3
            // nicht. Kein Zaehlfehler, sondern ein Erschoepfungszeichen.
            truncated: bull ? p[5].price <= p[3].price : p[5].price >= p[3].price,
            alternation: rr2.alternation, extended: rr2.extended,
            equality: rr2.equality, dep2: rr2.dep2, dep4: rr2.dep4,
            lowPrice: lo, highPrice: hi, rightIndex: i5x,
          });
          // Kein gieriges Blockieren benachbarter Startpunkte: das hat in
          // einer Zwischenfassung die Ergebnisse aufgefressen und die
          // Messung verfaelscht (strengere Regeln fanden MEHR, weil frueh
          // verworfene Kandidaten spaetere nicht mehr blockierten).
          // Deduplizieren geschieht geometrisch am Ende.

          // ================= Korrektur A-B-C =================
          // Direkt im Anschluss an den Impuls, ebenfalls mit Skip-Suche.
          if (opts.detectAbc) {
            const e0 = found.endChainIdx;
            let abcFound = null;
            abcOuter:
            for (let a1 = 0; a1 <= MS; a1++) {
             const ia = e0 + 1 + 2 * a1;
             if (ia >= chain.length) break;
             if (!legClean(chain, e0, ia, !bull)) continue;
             for (let a2 = 0; a2 <= MS; a2++) {
              const ib = ia + 1 + 2 * a2;
              if (ib >= chain.length) break;
              if (!legClean(chain, ia, ib, bull)) continue;
              for (let a3 = 0; a3 <= MS; a3++) {
              const ic = ib + 1 + 2 * a3;
              if (ic >= chain.length) break;
              if (!legClean(chain, ib, ic, !bull)) continue;
              const A = chain[ia], B = chain[ib], C = chain[ic];
              if (C.confirmIndex >= len) continue;

              const p5v = p[5].price, p0v = p[0].price;
              const lenA = Math.abs(p5v - A.price);
              const lenB = Math.abs(B.price - A.price);
              const lenC = Math.abs(C.price - B.price);
              if (!(lenA > 0)) continue;
              const ba = lenB / lenA, ca = lenC / lenA;

              // ---- Form bestimmen ----
              // Unterschieden wird ueber Welle B: wie weit holt sie die
              // A-Strecke zurueck? Das ist das Merkmal, an dem die Lehre
              // Zigzag, Flat und Expanded Flat trennt.
              const inR = (x, r) => x >= r[0] && x <= r[1];
              let form = null;
              if      (inR(ba, opts.abcZigzagB) && inR(ca, opts.abcZigzagC)) form = "zigzag";
              else if (inR(ba, opts.abcFlatB)   && inR(ca, opts.abcFlatC))   form = "flat";
              else if (inR(ba, opts.abcExpB)    && inR(ca, opts.abcExpC))    form = "expanded";
              if (!form) continue;

              // ---- Richtungslogik ----
              // A laeuft gegen den Impuls, B dagegen, C wieder mit A.
              // Anders als frueher darf B den Impulsgipfel UEBERSCHREITEN —
              // genau das macht den Expanded Flat aus. Verboten war das
              // pauschal und hat die Form unsichtbar gemacht.
              const dirOk = bull
                ? (A.price < p5v && B.price > A.price && C.price < B.price)
                : (A.price > p5v && B.price < A.price && C.price > B.price);
              if (!dirOk) continue;

              // Beim Zigzag bleibt B innerhalb des Impulses; bei den Flats
              // nicht. Das ist die zweite, unabhaengige Formprobe.
              if (form === "zigzag" && (bull ? B.price >= p5v : B.price <= p5v)) continue;

              // C muss ueber das A-Ende hinaus. Fehlt das, ist es ein
              // "running flat" — real, aber schwach und hier nicht gefuehrt.
              const cBeyondA = bull ? C.price < A.price : C.price > A.price;
              if (!cBeyondA) continue;

              // Die Korrektur darf den Impuls nicht praktisch ausloeschen
              const limit = bull ? logRetrace(p5v, p0v, opts.abcMaxRetrace)
                                 : logRetrace(p0v, p5v, 1 - opts.abcMaxRetrace);
              const depthOk = bull ? C.price >= limit : C.price <= limit;
              const bOk = true, cOk = true;

              if (bOk && cOk && dirOk && depthOk) {
                abcFound = { A, B, C, ratioBA: ba, ratioCA: ca, form };
                break abcOuter;
              }
              }
             }
            }
            if (abcFound) {
              abcs.push({
                kind: "abc", degree: n, degreeKey: grad.key, degreeLabel: grad.label,
                nurPruefung: !!grad.nurPruefung, dir: bull ? "bear" : "bull",
                points: [{ index: p[5].index, price: p[5].price },
                         { index: abcFound.A.index, price: abcFound.A.price },
                         { index: abcFound.B.index, price: abcFound.B.price },
                         { index: abcFound.C.index, price: abcFound.C.price }],
                confirmIndex: abcFound.C.confirmIndex,
                ratioBA: abcFound.ratioBA, ratioCA: abcFound.ratioCA,
                form: abcFound.form,
                parentEnd: p[5].index,
                rightIndex: abcFound.C.index,
              });
            }
          }
        }

        // ================= Welle-3-Setup (Golden Pocket) =================
        // Eigener Modus: EIN bestaetigtes Bein, danach die logarithmische
        // Golden Pocket und die Zustandsmaschine. Das ist die urspruengliche
        // Fassung — jetzt aber ohne die Filter, die alles verworfen haben.
        if (opts.detectSetups && !grad.nurPruefung && zeigen.length && grad.key === zeigen[zeigen.length - 1].key) {
          for (let k = 0; k + 1 < chain.length; k++) {
            const lp = chain[k], hp = chain[k + 1];
            if (lp.type !== "low" || hp.type !== "high") continue;
            const l = lp.index, h = hp.index;
            const L = data[l].low, H = data[h].high;
            if (!(H > L) || !(L > 0)) continue;
            if (h - l < opts.setupMinBars) continue;
            const risePct = (H - L) / L * 100;
            if (risePct < opts.setupMinPercent) continue;

            const confirmIdx = h + n;
            if (confirmIdx >= len) continue;

            const os = rsi[l] != null && rsi[l] <= opts.rsiOversold;
            // Bullische Divergenz gegen das vorherige Tief in der Kette
            let dv = false;
            for (let q = k - 2; q >= 0; q--) {
              if (chain[q].type !== "low") continue;
              const pi = chain[q].index;
              if (rsi[l] != null && rsi[pi] != null) {
                dv = data[l].low < data[pi].low && rsi[l] > rsi[pi];
              }
              break;
            }
            if (opts.requireRsi && !os && !dv) continue;

            const corrEnd = h + Math.max(n, 3);
            const v = volConf(l, h, corrEnd);
            if (opts.requireVolume && v.ok === false) continue;
            const er = eff(l, h);
            if (opts.requireEfficiency && er < opts.minEfficiency) continue;

            const boxTop    = logRetrace(H, L, opts.gpTop);
            const boxBottom = logRetrace(H, L, opts.gpBottom);
            if (!(boxTop > boxBottom)) continue;

            // ---- Zustandsmaschine ----
            //
            // Beruehrt eine Kerze die Box UND schliesst unter dem
            // Start-Tief, gewinnt die Invalidierung: ein Bar, der unter
            // der EWT-Grenze schliesst, darf keinen sauberen Einstieg
            // behaupten.
            //
            // Box-Kontakt als Intervall-Ueberlappung, nicht als "Close in
            // der Box" — sonst wuerde eine Kerze, die per Kursluecke
            // DURCH die Box springt, nicht erkannt.
            const scanEnd = Math.min(len - 1, confirmIdx + opts.timeoutBars);
            let state = "pending", resolvedAt = null;
            for (let t = confirmIdx; t <= scanEnd; t++) {
              const broke = opts.invalidateOnWick ? data[t].low < L : data[t].close < L;
              if (broke) { state = "invalid"; resolvedAt = t; break; }
              if (data[t].low <= boxTop && data[t].high >= boxBottom) {
                state = "triggered"; resolvedAt = t; break;
              }
            }
            if (state === "pending" && confirmIdx + opts.timeoutBars <= len - 1) {
              state = "timeout"; resolvedAt = scanEnd;
            }

            // Was danach geschah — rein historisch. Ohne diesen Teil sieht
            // im Rueckblick jede gruene Box wie ein Treffer aus.
            let target = null, w2Low = null, outcome = null;
            if (state === "triggered") {
              w2Low = Infinity;
              for (let t = h; t <= resolvedAt; t++) if (data[t].low < w2Low) w2Low = data[t].low;
              target = logExtend(w2Low, H, L, opts.extension);
              const horizon = Math.min(len - 1, resolvedAt + opts.timeoutBars);
              outcome = "offen";
              for (let t = resolvedAt + 1; t <= horizon; t++) {
                if (data[t].close < L)      { outcome = "invalidiert"; break; }
                if (data[t].high >= target) { outcome = "ziel";        break; }
              }
            }

            // Projektion nur fuer Setups, die noch laufen. Eine Projektion
            // aus einem abgelaufenen Setup haengt mitten im Chart und
            // behauptet eine Zukunft, die schon Vergangenheit ist.
            const running = state === "pending" ||
              (state === "triggered" && outcome === "offen" &&
               resolvedAt != null && resolvedAt + opts.timeoutBars >= len - 1);
            const projection = (opts.projectWaves && running)
              ? buildProjection(L, H,
                  state === "triggered" && w2Low != null ? w2Low : Math.sqrt(boxTop * boxBottom),
                  state === "triggered", Math.max(1, h - l), opts)
              : null;
            if (projection) projection.startIdx = state === "triggered" ? resolvedAt : null;

            const quality = Math.max(0, Math.min(1,
              0.35 * Math.min(1, er / 0.6) +
              0.25 * ((os ? 0.6 : 0) + (dv ? 0.4 : 0)) +
              0.20 * (v.ratio == null ? 0.5 : Math.min(1, v.ratio / 2)) +
              0.20 * Math.min(1, risePct / (opts.setupMinPercent * 3))));

            setups.push({
              kind: "setup", degree: n, degreeKey: grad.key, degreeLabel: grad.label,
              lowIndex: l, highIndex: h, lowPrice: L, highPrice: H,
              confirmIndex: confirmIdx, boxTop, boxBottom, invalidLevel: L,
              state, resolvedAt, target, w2Low, outcome,
              risePct, er, quality, rsiAtLow: rsi[l], oversold: os, divergence: dv,
              volRatio: v.ratio, volOk: v.ok, projection,
              rightIndex: resolvedAt != null ? resolvedAt
                : Math.min(len - 1, confirmIdx + opts.timeoutBars),
            });
          }
        }
      }

      // ---- Unterteilung pruefen ----
      //
      // Eine Impulswelle verlangt fuenf Unterwellen in Trendrichtung; die
      // Korrekturwellen 2 und 4 verlangen drei. Erst damit ist "Impuls"
      // mehr als eine Behauptung ueber die Form: eine korrektive Struktur
      // mit fuenf Beinen kann dieselben fuenf Punkte haben.
      //
      // Dreiwertig, und das ist wesentlich: "nicht aufloesbar" ist KEIN
      // Regelverstoss. Ist der naechsttiefere Grad fuer das Intervall zu
      // fein, kann die innere Struktur prinzipiell nicht sichtbar sein.
      // EWAVES raeumt dasselbe ein und laesst sein System deshalb ueber
      // Datensegmente "blinzeln".
      const pruefeUnterteilung = (s, kandidaten) => {
        if (!opts.checkSubdivision) return null;
        if (!kandidaten || !kandidaten.length) {
          return { state: "nichtAufloesbar", bestaetigt: 0, von: 5,
                   grund: "kein feinerer Grad verfügbar" };
        }
        const p = s.points;
        const spanne = p[5].index - p[0].index;
        const tol = Math.max(1, Math.round(spanne * (opts.subTolerance || 0.15) / 5));
        let bestaetigt = 0, widerspruch = 0;
        const details = [];
        for (let w = 1; w <= 5; w++) {
          const von = p[w - 1].index, bis = p[w].index;
          const impulsWelle = (w % 2 === 1);          // 1, 3, 5
          // Richtung der Unterwelle: Impulswellen laufen mit dem
          // Elterntrend, die Korrekturen 2 und 4 dagegen.
          const soll = impulsWelle ? s.dir : (s.dir === "bull" ? "bear" : "bull");
          const treffer = kandidaten.find(k => {
            if (impulsWelle && k.kind !== "impulse") return false;
            if (!impulsWelle && k.kind !== "abc") return false;
            if (k.dir !== soll) return false;
            const a = k.points[0].index, b = k.points[k.points.length - 1].index;
            return a >= von - tol && b <= bis + tol && (b - a) > (bis - von) * 0.4;
          });
          if (treffer) { bestaetigt++; details.push({ welle: w, ok: true }); }
          else {
            details.push({ welle: w, ok: false });
            // Widerspruch nur, wenn im Zeitraum ueberhaupt Strukturen des
            // feineren Grades liegen — sonst ist es Datenmangel, nicht
            // Gegenbeweis.
            const irgendwas = kandidaten.some(k => {
              const a = k.points[0].index, b = k.points[k.points.length - 1].index;
              return a >= von - tol && b <= bis + tol;
            });
            if (irgendwas) widerspruch++;
          }
        }
        const state = bestaetigt === 5 ? "bestaetigt"
                    : bestaetigt === 0 && widerspruch === 0 ? "nichtAufloesbar"
                    : widerspruch > bestaetigt ? "widersprochen" : "teilweise";
        return { state, bestaetigt, von: 5, widerspruch, details };
      };

      // Kandidaten sind alle Strukturen eines FEINEREN Grades.
      const feinereAls = (gradN) => {
        const imp = impulses.filter(x => x.degree < gradN);
        const ab  = abcs.filter(x => x.degree < gradN);
        return imp.concat(ab);
      };
      for (const s of impulses) {
        s.subdivision = pruefeUnterteilung(s, feinereAls(s.degree));
      }

      // ---- Sichtbereich, Deduplizierung, Kappung ----
      const inView = (s) => s.rightIndex >= from &&
        (s.points ? s.points[0].index : s.lowIndex) <= to;

      // Deduplizierung JE GRAD, nicht ueber alle Grade hinweg.
      //
      // Die Mehrskalen-Suche ist ja gerade dafuer da, dieselbe Bewegung
      // auf verschiedenen Ebenen zu zeigen — eine uebergeordnete Zaehlung
      // und die feinere darin sind kein Widerspruch, sondern der Sinn der
      // Sache. Frueher wurde ueber alle Grade dedupliziert, wodurch aus
      // 64 gefundenen Strukturen 11 wurden und die Skip-Suche wirkungslos
      // erschien.
      //
      // Innerhalb eines Grades gewinnt bei Ueberlappung die hoehere Guete.
      const dedupe = (arr) => {
        const byDeg = new Map();
        for (const s of arr) {
          if (!byDeg.has(s.degree)) byDeg.set(s.degree, []);
          byDeg.get(s.degree).push(s);
        }
        const out = [];
        for (const [, list] of byDeg) {
          const seen = [];
          // Bei Ueberlappung entscheidet primaer der Anpassungsfehler:
          // welche Zaehlung liegt naeher an der tatsaechlichen Bewegung?
          // Das ist objektiv, waehrend die Guetezahl gewichtete Annahmen
          // enthaelt. Fehlt der Fehler, zaehlt die Guetezahl.
          list.sort((a, b) => {
            const fa = a.fitError == null ? Infinity : a.fitError;
            const fb = b.fitError == null ? Infinity : b.fitError;
            return fa !== fb ? fa - fb : b.quality - a.quality;
          });
          for (const s of list) {
            const a0 = s.points[0].index, a1 = s.points[s.points.length - 1].index;
            const dup = seen.some(([b0, b1]) => {
              const ov = Math.min(a1, b1) - Math.max(a0, b0);
              return ov > 0 && ov / Math.max(1, a1 - a0) > 0.6;
            });
            if (!dup) { out.push(s); seen.push([a0, a1]); }
          }
        }
        // Ueber die Grade hinweg nur NAHEZU IDENTISCHE Zaehlungen entfernen.
        // Dieselbe Bewegung auf zwei Ebenen zu zeigen ist der Sinn der
        // Mehrskalen-Suche; zweimal exakt dasselbe ist nur Doppelung.
        // Schwelle bewusst hoch (90 %), damit echte Verschachtelung bleibt.
        // Bei Gleichstand gewinnt der groebere Grad.
        out.sort((a, b) => b.degree - a.degree);
        const uniq = [], taken = [];
        for (const s of out) {
          const a0 = s.points[0].index, a1 = s.points[s.points.length - 1].index;
          const same = taken.some(([b0, b1, dir]) => {
            if (dir !== s.dir) return false;
            const ov = Math.min(a1, b1) - Math.max(a0, b0);
            const un = Math.max(a1, b1) - Math.min(a0, b0);
            return ov > 0 && un > 0 && ov / un > 0.9;
          });
          if (!same) { uniq.push(s); taken.push([a0, a1, s.dir]); }
        }
        return uniq;
      };

      // Kappung raeumlich verteilen, NICHT nach Aktualitaet.
      //
      // Vorher wurde nach Endindex absteigend sortiert und dann
      // abgeschnitten — es ueberlebten also die N juengsten Strukturen und
      // die linke Chart-Haelfte blieb systematisch leer, egal wie gut die
      // Zaehlungen dort waren. Die Kappung soll die Overlay-Zahl
      // begrenzen, nicht den Zeitraum beschneiden.
      //
      // Jetzt: Sichtbereich in N Segmente teilen, je Segment die beste
      // Struktur, Restplaetze nach Guete auffuellen.
      const spread = (arr, max) => {
        if (max <= 0 || arr.length <= max) return arr;
        let lo = Infinity, hi = -Infinity;
        for (const s of arr) {
          const a = s.points[0].index, b = s.rightIndex;
          if (a < lo) lo = a;
          if (b > hi) hi = b;
        }
        const w = (hi - lo) / max || 1;
        const buckets = new Map();
        for (const s of arr) {
          const mid = (s.points[0].index + s.rightIndex) / 2;
          const b = Math.max(0, Math.min(max - 1, Math.floor((mid - lo) / w)));
          const cur = buckets.get(b);
          if (!cur || s.quality > cur.quality) buckets.set(b, s);
        }
        const chosen = new Set(buckets.values());
        const out = [...chosen];
        if (out.length < max) {
          const rest = arr.filter(s => !chosen.has(s))
                          .sort((a, b) => b.quality - a.quality);
          out.push(...rest.slice(0, max - out.length));
        }
        return out;
      };

      // Strukturen, die nur zur Pruefung gerechnet wurden, nicht zeigen.
      let impSichtbar = impulses.filter(x => !x.nurPruefung);
      if (opts.requireSubdivision) {
        // Als Filter zuschaltbar. "nicht aufloesbar" faellt NICHT durch —
        // fehlende Aufloesung ist kein Gegenbeweis.
        impSichtbar = impSichtbar.filter(x => !x.subdivision
          || x.subdivision.state === "bestaetigt"
          || x.subdivision.state === "nichtAufloesbar");
      }
      let imp = spread(dedupe(impSichtbar.filter(inView)), opts.maxImpulses);
      imp.sort((a, b) => a.rightIndex - b.rightIndex);

      // Nur Korrekturen zu Impulsen zeigen, die auch gezeichnet werden
      const keep = new Set(imp.map(s => s.degree + ":" + s.points[5].index));
      const abc = abcs.filter(x => !x.nurPruefung).filter(inView)
                      .filter(s => keep.has(s.degree + ":" + s.parentEnd));

      let set = setups.filter(inView);
      const sseen = new Set();
      set = set.filter(s => {
        const key = s.highIndex + ":" + Math.round(s.lowIndex / 3);
        if (sseen.has(key)) return false;
        sseen.add(key); return true;
      });
      // Setups tragen kein points-Array — fuer spread() nachruesten.
      set = spread(set.map(s => Object.assign(s, {
        points: s.points || [{ index: s.lowIndex, price: s.lowPrice }],
      })), opts.maxSetups);
      set.sort((a, b) => a.highIndex - b.highIndex);

      return { impulses: imp, abcs: abc, setups: set,
               degreesUsed: zeigen, degreesTooFine: zuFein, alleGrade,
               degreesComputed: rechnen };
    },

    // ── NULL-HYPOTHESEN-TEST ────────────────────────────────────────
    //
    // Die Frage, die bei Elliott immer im Raum steht: findet der Scanner
    // in echten Kursen mehr oder bessere Strukturen als in reinem
    // Rauschen? Ohne Antwort darauf ist jede Trefferzahl wertlos —
    // auf synthetischen Zufallspfaden wurden hier 33 Impulse pro 2000
    // Kerzen gefunden, was man ebenso gut als Warnung lesen kann.
    //
    // Nullmodell: dieselbe Reihe mit VERTAUSCHTEN Log-Renditen. Das
    // erhaelt Startkurs, Renditeverteilung, Volatilitaetsniveau und die
    // Form jeder einzelnen Kerze (Docht-Verhaeltnisse wandern mit) —
    // zerstoert aber die zeitliche Ordnung und damit jede Struktur.
    // Findet der Scanner darin gleich viel, misst er Rauschen.
    //
    // Rueckgabe u. a. p-Werte: Anteil der Permutationen, die mindestens
    // so gut abschnitten. Ueber 0.05 heisst: kein belastbarer Unterschied.
    vsNull(data, userOpts = {}, iterations = 30) {
      if (!data || data.length < 200) return { error: "Zu wenig Daten (min. 200)" };
      const opts = { ...userOpts, maxImpulses: 0, maxSetups: 0 };
      const range = { from: 0, to: data.length - 1 };

      const measure = (d) => {
        const r = this.scan(d, { from: 0, to: d.length - 1 }, opts);
        const errs = r.impulses.map(s => s.fitError).filter(x => x != null);
        return {
          n: r.impulses.length,
          abc: r.abcs.length,
          meanErr: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
          bestErr: errs.length ? Math.min(...errs) : null,
        };
      };

      // Log-Renditen und relative Dochtlaengen je Kerze
      const rets = [], shape = [];
      for (let i = 1; i < data.length; i++) {
        const a = data[i - 1].close, b = data[i].close;
        if (!(a > 0) || !(b > 0)) return { error: "Ungültige Kurse" };
        rets.push(Math.log(b / a));
        shape.push({
          hi: Math.log(Math.max(data[i].high, b) / b),
          lo: Math.log(Math.min(data[i].low, b) / b),
          v: data[i].volume || 0,
          up: data[i].close >= data[i].open,
        });
      }

      const rebuild = (order) => {
        const out = [{ ...data[0] }];
        let p = data[0].close;
        for (let i = 0; i < order.length; i++) {
          const k = order[i];
          const prev = p;
          p = p * Math.exp(rets[k]);
          const s = shape[k];
          out.push({
            timestamp: data[i + 1].timestamp,
            open: prev,
            close: p,
            high: p * Math.exp(s.hi),
            low:  p * Math.exp(s.lo),
            volume: s.v,
          });
        }
        return out;
      };

      const real = measure(data);
      const nulls = [];
      // Deterministischer Generator: derselbe Aufruf liefert dasselbe
      // Ergebnis, sonst ist der p-Wert nicht reproduzierbar.
      let seed = 20260805;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      for (let it = 0; it < iterations; it++) {
        const order = rets.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        nulls.push(measure(rebuild(order)));
      }

      const pct = (arr) => {
        const s = arr.slice().sort((a, b) => a - b);
        return (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
      };
      const nCounts = nulls.map(x => x.n);
      const nErrs = nulls.map(x => x.meanErr).filter(x => x != null);
      const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

      // p-Wert Anzahl: wie oft fand das Nullmodell MINDESTENS so viele?
      const pCount = (nCounts.filter(x => x >= real.n).length + 1) / (iterations + 1);
      // p-Wert Anpassung: wie oft war das Nullmodell MINDESTENS so gut
      // angepasst (kleinerer Fehler)?
      const pFit = real.meanErr == null ? null
        : (nErrs.filter(x => x <= real.meanErr).length + 1) / (iterations + 1);

      return {
        echt: { impulse: real.n, abc: real.abc,
                mittlererFehler: real.meanErr, besterFehler: real.bestErr },
        null: { impulseMittel: mean(nCounts),
                impulseSpanne: [Math.min(...nCounts), Math.max(...nCounts)],
                impulse95: pct(nCounts)(0.95),
                mittlererFehler: mean(nErrs) },
        pWertAnzahl: pCount,
        pWertAnpassung: pFit,
        iterationen: iterations,
        urteil: (pCount > 0.05 && (pFit == null || pFit > 0.05))
          ? "Kein belastbarer Unterschied zu Rauschen"
          : (pCount <= 0.05 && pFit != null && pFit <= 0.05)
            ? "Anzahl UND Anpassung unterscheiden sich von Rauschen"
            : pCount <= 0.05 ? "Nur die Anzahl unterscheidet sich"
                             : "Nur die Anpassungsgüte unterscheidet sich",
      };
    },

    // ── NORMIERUNGSEXPONENT AN ECHTEN DATEN BESTIMMEN ───────────────
    //
    // Der Anpassungsfehler waechst mit der Wellenlaenge. Ohne Normierung
    // gelten lange Wellen und grobe Grade pauschal als schlecht. Der
    // Exponent 0.5 stammt aus der Zufallspfad-Theorie und wurde an
    // synthetischen Daten bestaetigt — dort MUSS er 0.5 sein, weil die
    // Daten so erzeugt wurden. Das ist zirkulaer.
    //
    // Diese Funktion misst ihn an der vorliegenden Reihe nach:
    // Regression von log(roher Fehler) auf log(Spanne). Anschliessend
    // laesst sich der Wert mit setFitBeta() setzen.
    calibrateBeta(data, userOpts = {}) {
      const r = this.scan(data, { from: 0, to: data.length - 1 },
                          { ...userOpts, maxImpulses: 0, maxSetups: 0 });
      const pts = r.impulses
        .filter(s => s.fitErrorRaw != null && s.fitSpan > 1)
        .map(s => [Math.log(s.fitSpan), Math.log(s.fitErrorRaw)]);
      if (pts.length < 12) {
        return { error: "Zu wenige Impulse für eine Regression", n: pts.length };
      }
      const n = pts.length;
      const mx = pts.reduce((a, p) => a + p[0], 0) / n;
      const my = pts.reduce((a, p) => a + p[1], 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
      const beta = sxy / sxx, rho = sxy / Math.sqrt(sxx * syy);
      // Restkorrelation nach Normierung mit dem gemessenen Beta
      const res = pts.map(([x, y]) => [x, y - beta * x]);
      const mr = res.reduce((a, p) => a + p[1], 0) / n;
      let c2 = 0, s1 = 0, s2 = 0;
      for (const [x, y] of res) { c2 += (x - mx) * (y - mr); s1 += (x - mx) ** 2; s2 += (y - mr) ** 2; }
      return {
        n, beta: +beta.toFixed(3), korrelation: +rho.toFixed(3),
        restkorrelation: +(s2 > 0 ? c2 / Math.sqrt(s1 * s2) : 0).toFixed(3),
        aktuell: FIT_BETA.value,
        hinweis: Math.abs(beta - FIT_BETA.value) > 0.08
          ? `Weicht deutlich ab — EWTEngine.setFitBeta(${beta.toFixed(2)}) erwägen`
          : "Nahe am aktuellen Wert, kein Handlungsbedarf",
      };
    },

    setFitBeta(v) {
      if (typeof v === "number" && v >= 0 && v <= 1.5) { FIT_BETA.value = v; return v; }
      return FIT_BETA.value;
    },
    getFitBeta() { return FIT_BETA.value; },

    // Diagnose fuer die Konsole: wie viele Strukturen je Grad, und wo
    // scheitern die Regeln? Beantwortet die Frage "warum finde ich nichts"
    // mit Zahlen statt mit Vermutungen.
    diagnose(data, userOpts = {}) {
      const opts = { ...DEFAULTS, ...userOpts };
      const MS = Math.max(0, Math.min(4, opts.maxSkip | 0));
      const grade = ableitenGrade(data, opts);
      const out = { intervallMs: grade.length ? grade[0].barMs : null,
                    kerzen: data ? data.length : 0, grade: {}, gesamt: 0 };
      for (const g of grade) {
        if (g.zuFein) {
          out.grade[g.label] = { fenster: g.n, status: "zu fein für dieses Intervall" };
          continue;
        }
        const chain = buildChain(findFractals(data, g.n, opts.basis),
                                 opts.minPivotPercent);
        const c = { fenster: g.n, pivots: chain.length, starts: 0, legFail: 0,
                    r1: 0, r2: 0, r3: 0, r4: 0, rInt: 0, prop: 0,
                    ok: 0, unbestaetigt: 0, skipHisto: {} };
        if (chain.length < 6) {
          c.status = `nur ${chain.length} Pivots — für eine Zählung braucht es 6`;
          out.grade[g.label] = c;
          continue;
        }
        for (let k = 0; k + 5 < chain.length; k++) {
          const bull = chain[k].type === "low";
          c.starts++;
          for (let s1 = 0; s1 <= MS; s1++) {
           const i1 = k + 1 + 2*s1; if (i1 >= chain.length) break;
           if (!legClean(chain, k, i1, bull)) { c.legFail++; continue; }
           for (let s2 = 0; s2 <= MS; s2++) {
            const i2 = i1 + 1 + 2*s2; if (i2 >= chain.length) break;
            if (!legClean(chain, i1, i2, !bull)) continue;
            for (let s3 = 0; s3 <= MS; s3++) {
             const i3 = i2 + 1 + 2*s3; if (i3 >= chain.length) break;
             if (!legClean(chain, i2, i3, bull)) continue;
             for (let s4 = 0; s4 <= MS; s4++) {
              const i4 = i3 + 1 + 2*s4; if (i4 >= chain.length) break;
              if (!legClean(chain, i3, i4, !bull)) continue;
              for (let s5 = 0; s5 <= MS; s5++) {
               const i5 = i4 + 1 + 2*s5; if (i5 >= chain.length) break;
               if (!legClean(chain, i4, i5, bull)) continue;
               const r = checkRules([chain[k], chain[i1], chain[i2], chain[i3],
                                     chain[i4], chain[i5]], bull, opts);
               if (!r.r1) c.r1++; if (!r.r2) c.r2++; if (!r.r3) c.r3++;
               if (!r.r4) c.r4++; if (!r.rInt) c.rInt++; if (!r.prop) c.prop++;
               if (r.all) {
                 if (chain[i5].confirmIndex >= data.length) { c.unbestaetigt++; }
                 else {
                   const key = [s1,s2,s3,s4,s5].join("");
                   c.skipHisto[key] = (c.skipHisto[key] || 0) + 1;
                   c.ok++;
                 }
                 s1 = s2 = s3 = s4 = s5 = MS + 1;   // erste gueltige genuegt
               }
              }
             }
            }
           }
          }
        }
        out.grade[g.label] = c;
        out.gesamt += c.ok;
      }
      return out;
    },
  };

  if (typeof window !== "undefined") window.EWTEngine = EWTEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = EWTEngine;
})();
