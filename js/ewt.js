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
    // ---- Skalen ----
    // Mehrere Wellengrade gleichzeitig. Ohne das sieht man immer nur
    // eine Aufloesung und verpasst sowohl die grossen Strukturen als
    // auch die feinen. Beide Referenz-Indikatoren machen es genauso.
    degrees: [5, 9, 17],

    // ---- Pivot-Kette ----
    // Mindestbewegung zwischen zwei aufeinanderfolgenden Pivots, in
    // Prozent. Wirkt beim AUFBAU der Kette, nicht als nachtraeglicher
    // Filter — genau so raeumt der Detector Pro das Rauschen weg, ohne
    // ganze Strukturen zu verlieren.
    minPivotPercent: 1.5,

    // ---- Struktur ----
    requireWave5NewExtreme: true,  // Welle 5 muss ueber Welle 3 hinaus
    allowDiagonal: false,          // Diagonalen duerfen Regel 3 verletzen

    // ---- Korrektur ----
    detectAbc: true,
    abcMaxRetrace: 0.854,          // C darf hoechstens so viel zurueckholen

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
    w5Ratio: 1.0,
    waveARatio: 0.382, waveBRatio: 0.5, waveCRatio: 1.0,
    maxProjBars: 90,

    // ---- Ausgabe ----
    // Der eigentliche FPS-Faktor ist die Overlay-Anzahl, nicht die
    // Rechnung: KLineCharts zeichnet jedes Overlay bei jedem Frame neu.
    maxImpulses: 8,
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
  function findFractals(data, n) {
    const out = [], len = data.length;
    if (len < 2 * n + 1) return out;
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
    const [p0, p1, p2, p3, p4, p5] = p.map(x => x.price);
    const w1 = Math.abs(p1 - p0), w3 = Math.abs(p3 - p2), w5 = Math.abs(p5 - p4);
    const r1 = bull ? p2 > p0 : p2 < p0;
    const r2 = !(w3 < w1 && w3 < w5);
    const r3 = opts.allowDiagonal ? true : (bull ? p4 > p1 : p4 < p1);
    const r4 = !opts.requireWave5NewExtreme ? true : (bull ? p5 > p3 : p5 < p3);
    return { r1, r2, r3, r4, all: r1 && r2 && r3 && r4, w1, w3, w5 };
  }

  // ============================================================
  // 4. Projektion der Folgewellen
  // ============================================================
  //
  // KEINE PROGNOSE. Die mechanische Fortschreibung der Verhaeltnisse,
  // die die Elliott-Lehre unterstellt — es kommt keine Information aus
  // den Daten hinzu, die nicht schon in Welle 1 steckt. Die Zeitachse
  // ist der schwaechste Teil und sagt nichts darueber aus, WANN etwas
  // eintritt.
  function buildProjection(L, H, anchor, measured, barsW1, opts) {
    if (!(anchor > 0) || !(H > 0) || !(L > 0)) return null;
    const w3  = logExtend(anchor, H, L, opts.w3Ratio);
    const w3x = logExtend(anchor, H, L, opts.w3RatioX);
    if (!isFinite(w3) || !isFinite(w3x)) return null;
    const w4Top = logRetrace(w3, anchor, opts.w4Top);
    const w4Bot = logRetrace(w3, anchor, opts.w4Bottom);
    // Verletzt die eigene Projektion Regel 3, ist die Zaehlung in sich
    // unstimmig — das wird gemeldet statt huebsch gezeichnet.
    const w4Conflict = w4Bot <= H;
    const w5 = logExtend(w4Bot, H, L, opts.w5Ratio);
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

      // ---- Kennzahlen einmal ueber den vollen Datensatz ----
      const closes = new Array(len);
      for (let i = 0; i < len; i++) closes[i] = data[i].close;
      const rsi = wilderRsi(closes, opts.rsiPeriod);

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
      for (const n of opts.degrees) {
        if (len < 2 * n + 8) continue;
        const chain = buildChain(findFractals(data, n), opts.minPivotPercent);
        if (chain.length < 6) continue;

        // ================= Impuls 1-2-3-4-5 =================
        // Fenster von 6 aufeinanderfolgenden Pivots.
        for (let k = 0; k + 5 < chain.length; k++) {
          const p = chain.slice(k, k + 6);
          const bull = p[0].type === "low";
          // Die Kette alterniert, also genuegt die Pruefung des ersten
          // Punktes — der Rest folgt zwangslaeufig.
          if (bull ? p[1].type !== "high" : p[1].type !== "low") continue;

          const rules = checkRules(p, bull, opts);
          if (!rules.all) continue;

          // Non-Repainting: die Struktur gilt erst als erkannt, wenn ihr
          // LETZTER Punkt bestaetigt ist.
          const confirmIndex = p[5].confirmIndex;
          if (confirmIndex >= len) continue;

          const i0 = p[0].index, i5 = p[5].index;
          const lo = bull ? p[0].price : p[5].price;
          const hi = bull ? p[5].price : p[0].price;

          // Bewertung, kein Filter
          const er = eff(Math.min(i0, i5), Math.max(i0, i5));
          const rsiEnd = rsi[i5];
          const v = volConf(Math.min(p[0].index, p[1].index),
                            Math.max(p[0].index, p[1].index),
                            Math.max(p[0].index, p[1].index) + Math.max(n, 3));
          if (opts.requireEfficiency && er < opts.minEfficiency) continue;
          if (opts.requireVolume && v.ok === false) continue;

          // Regelmaessigkeit der Verhaeltnisse: wie nah liegt Welle 3 an
          // 1.618 x Welle 1 und Welle 5 an 1.0 x Welle 1? Rein
          // beschreibend — ausdruecklich keine Trefferwahrscheinlichkeit.
          const r31 = rules.w1 > 0 ? rules.w3 / rules.w1 : 0;
          const r51 = rules.w1 > 0 ? rules.w5 / rules.w1 : 0;
          const near = (x, t) => Math.max(0, 1 - Math.abs(x - t) / t);
          const quality = Math.max(0, Math.min(1,
            0.40 * near(r31, 1.618) + 0.25 * near(r51, 1.0) +
            0.20 * Math.min(1, er / 0.5) +
            0.15 * (v.ratio == null ? 0.5 : Math.min(1, v.ratio / 2))));

          impulses.push({
            kind: "impulse", degree: n, dir: bull ? "bull" : "bear",
            points: p.map(x => ({ index: x.index, price: x.price })),
            chainPos: k, confirmIndex,
            w1: rules.w1, w3: rules.w3, w5: rules.w5,
            ratio31: r31, ratio51: r51,
            rules: { r1: rules.r1, r2: rules.r2, r3: rules.r3, r4: rules.r4 },
            er, rsiAtEnd: rsiEnd, volRatio: v.ratio, quality,
            lowPrice: lo, highPrice: hi,
            rightIndex: i5,
          });

          // ================= Korrektur A-B-C =================
          // Direkt im Anschluss an den Impuls: drei weitere Pivots.
          if (opts.detectAbc && k + 8 < chain.length) {
            const a = chain[k + 6], b = chain[k + 7], cc = chain[k + 8];
            if (a && b && cc && cc.confirmIndex < len) {
              const p5v = p[5].price, p0v = p[0].price;
              // Nach einem Bullen-Impuls korrigiert A-B-C abwaerts.
              const okDir = bull
                ? (a.price < p5v && b.price > a.price && b.price < p5v && cc.price < b.price)
                : (a.price > p5v && b.price < a.price && b.price > p5v && cc.price > b.price);
              // C darf den Impuls nicht praktisch ausloeschen.
              const limit = bull ? logRetrace(p5v, p0v, opts.abcMaxRetrace)
                                 : logRetrace(p0v, p5v, 1 - opts.abcMaxRetrace);
              const okDepth = bull ? cc.price >= limit : cc.price <= limit;
              if (okDir && okDepth) {
                abcs.push({
                  kind: "abc", degree: n, dir: bull ? "bear" : "bull",
                  points: [{ index: p[5].index, price: p5v },
                           { index: a.index,  price: a.price },
                           { index: b.index,  price: b.price },
                           { index: cc.index, price: cc.price }],
                  confirmIndex: cc.confirmIndex,
                  parentDir: bull ? "bull" : "bear",
                  rightIndex: cc.index,
                });
              }
            }
          }
        }

        // ================= Welle-3-Setup (Golden Pocket) =================
        // Eigener Modus: EIN bestaetigtes Bein, danach die logarithmische
        // Golden Pocket und die Zustandsmaschine. Das ist die urspruengliche
        // Fassung — jetzt aber ohne die Filter, die alles verworfen haben.
        if (opts.detectSetups && n === opts.degrees[0]) {
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
              kind: "setup", degree: n,
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

      // ---- Sichtbereich, Deduplizierung, Kappung ----
      const inView = (s) => s.rightIndex >= from &&
        (s.points ? s.points[0].index : s.lowIndex) <= to;

      // Ueber mehrere Grade entstehen fast deckungsgleiche Strukturen.
      // Der groebere Grad gewinnt: er beschreibt die uebergeordnete Welle.
      const dedupe = (arr) => {
        const out = [], seen = [];
        for (const s of arr.slice().sort((a, b) => b.degree - a.degree)) {
          const a0 = s.points[0].index, a1 = s.points[s.points.length - 1].index;
          const dup = seen.some(([b0, b1]) => {
            const ov = Math.min(a1, b1) - Math.max(a0, b0);
            return ov > 0 && ov / Math.max(1, a1 - a0) > 0.7;
          });
          if (!dup) { out.push(s); seen.push([a0, a1]); }
        }
        return out;
      };

      let imp = dedupe(impulses.filter(inView));
      imp.sort((a, b) => b.rightIndex - a.rightIndex || b.quality - a.quality);
      if (opts.maxImpulses > 0) imp = imp.slice(0, opts.maxImpulses);
      imp.sort((a, b) => a.rightIndex - b.rightIndex);

      const keep = new Set(imp.map(s => s.degree + ":" + s.points[5].index));
      const abc = abcs.filter(inView).filter(s => keep.has(s.degree + ":" + s.points[0].index));

      let set = setups.filter(inView);
      const sseen = new Set();
      set = set.filter(s => {
        const key = s.highIndex + ":" + Math.round(s.lowIndex / 3);
        if (sseen.has(key)) return false;
        sseen.add(key); return true;
      });
      set.sort((a, b) => b.highIndex - a.highIndex || b.quality - a.quality);
      if (opts.maxSetups > 0) set = set.slice(0, opts.maxSetups);
      set.sort((a, b) => a.highIndex - b.highIndex);

      return { impulses: imp, abcs: abc, setups: set };
    },

    // Diagnose fuer die Konsole: wie viele Strukturen je Grad, und wo
    // scheitern die Regeln? Beantwortet die Frage "warum finde ich nichts"
    // mit Zahlen statt mit Vermutungen.
    diagnose(data, userOpts = {}) {
      const opts = { ...DEFAULTS, ...userOpts };
      const out = { degrees: {}, gesamt: 0 };
      for (const n of opts.degrees) {
        const chain = buildChain(findFractals(data, n), opts.minPivotPercent);
        const c = { pivots: chain.length, fenster: 0, r1: 0, r2: 0, r3: 0, r4: 0, ok: 0, unbestaetigt: 0 };
        for (let k = 0; k + 5 < chain.length; k++) {
          const p = chain.slice(k, k + 6);
          const bull = p[0].type === "low";
          c.fenster++;
          const r = checkRules(p, bull, opts);
          if (!r.r1) c.r1++;
          if (!r.r2) c.r2++;
          if (!r.r3) c.r3++;
          if (!r.r4) c.r4++;
          if (r.all) { if (p[5].confirmIndex >= data.length) c.unbestaetigt++; else c.ok++; }
        }
        out.degrees[n] = c;
        out.gesamt += c.ok;
      }
      return out;
    },
  };

  if (typeof window !== "undefined") window.EWTEngine = EWTEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = EWTEngine;
})();
