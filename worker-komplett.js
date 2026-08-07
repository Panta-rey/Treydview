/* ============================================================
   PANTA REY · Cloudflare Worker
   ------------------------------------------------------------
   Routen:
     GET  /               → Status
     GET  /macro          → FRED-Makrodaten + Gold
     GET  /goldhistory    → LBMA Gold-Langzeithistorie (via Stooq)
     GET  /stooq?s=...    → Aktienindizes (S&P 500, Nasdaq, Dow)
     GET  /m2             → Globale M2-Geldmenge (FRED aggregiert)
     GET  /history        → Snapshots lesen
     POST /snapshot       → Snapshot schreiben

   Bindings:
     KV-Namespace  →  Variablenname:  PANTA
     Secret        →  Name:           FRED_KEY
     Secret        →  Name:           FRED_API_KEY  (M2-Route, optional — gleicher Wert wie FRED_KEY)
     Secret        →  Name:           SNAP_KEY      (optional, schützt /snapshot)
   ============================================================ */

// ── Cache-Version ────────────────────────────────────────────────────────
// JEDER KV-Schluessel traegt diese Kennung. Wird die Berechnung geaendert,
// erhoehen — dann sind alle alten Eintraege sofort ungueltig, ohne dass
// jemand von Hand aufraeumen muss.
//
// Warum das noetig ist: Die Schluessel hiessen frueher schlicht "m2",
// "stooq_^spx" und "goldhistory", mit 24 Stunden Lebensdauer. Nach einer
// Korrektur am Rechenweg lieferte der Worker deshalb bis zu einen ganzen
// Tag lang weiter die ALTEN, falschen Werte — der Fix sah aus, als haette
// er nicht gewirkt. Konkret: die fehlerhaften M2-Werte (Faktor 1e9 zu
// gross) blieben im Cache und wurden vom Frontend als unplausibel
// verworfen, mit der Meldung "Keine plausiblen M2-Daten erhalten".
const CACHE_VERSION = "v2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Panta-Key",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const csv = (text, status = 200) =>
  new Response(text, {
    status,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=43200",
      ...CORS,
    },
  });

const err = (msg, status = 500) =>
  new Response(msg, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
  });

/* ============================================================
   EXPORT DEFAULT
   ============================================================ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (url.pathname === "/macro"       && request.method === "GET")  return await getMacro(env);
      if (url.pathname === "/goldhistory" && request.method === "GET")  return await getGoldHistory(env, request);
      if (url.pathname === "/bitstamp"    && request.method === "GET")  return await getBitstamp(request, env);
      if (url.pathname === "/stooq"       && request.method === "GET")  return await getStooq(request, env);
      if (url.pathname === "/m2"          && request.method === "GET")  return await getM2(env);
      if (url.pathname === "/history"     && request.method === "GET")  return await getHistory(env);
      if (url.pathname === "/snapshot"    && request.method === "POST") return await postSnapshot(request, env);
      if (url.pathname === "/")
        return json({ ok: true, service: "panta-rey", routes: ["/macro", "/goldhistory", "/bitstamp", "/stooq", "/m2", "/history", "/snapshot"] });
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      buildMacro(env)
        .then(d => env.PANTA.put("macro", JSON.stringify({ ts: Date.now(), data: d })))
        .catch(() => {})
    );
  },
};

/* ============================================================
   HILFSFUNKTIONEN (unverändert aus dem Originalcode)
   ============================================================ */
const MACRO_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 1200;

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

async function fredSeries(id, key, start) {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&observation_start=${start}&sort_order=asc`;
  const r = await fetch(u, { cf: { cacheTtl: 1800 } });
  if (!r.ok) throw new Error(`FRED ${id} ${r.status}`);
  const j = await r.json();
  return (j.observations || [])
    .filter(o => o.value !== ".")
    .map(o => ({ d: o.date, v: parseFloat(o.value) }));
}

const last   = a => a[a.length - 1];
const agoVal = (a, n) => a[Math.max(0, a.length - 1 - n)].v;

async function stooqSeries(symbol, days) {
  const f = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  const u = `https://stooq.com/q/d/l/?s=${symbol}&d1=${f(new Date(Date.now() - days * 864e5))}&d2=${f(new Date())}&i=d`;
  const r = await fetch(u, { cf: { cacheTtl: 1800 } });
  if (!r.ok) throw new Error(`Stooq ${symbol} ${r.status}`);
  const rows = (await r.text()).trim().split("\n").slice(1)
    .map(l => l.split(","))
    .filter(c => c.length >= 5 && c[4] && isFinite(parseFloat(c[4])))
    .map(c => ({ d: c[0], v: parseFloat(c[4]) }));
  if (!rows.length) throw new Error(`Stooq ${symbol}: keine Daten`);
  return rows;
}

/* ============================================================
   /macro  (unverändert)
   ============================================================ */
async function buildMacro(env) {
  const key = env.FRED_KEY;
  if (!key) throw new Error("FRED_KEY fehlt");
  const out = {};

  const tasks = {
    us10y: fredSeries("DGS10",          key, isoDaysAgo(180)),
    dxy:   fredSeries("DTWEXBGS",       key, isoDaysAgo(180)),
    sp500: fredSeries("SP500",          key, isoDaysAgo(200)),
    tips:  fredSeries("DFII10",         key, isoDaysAgo(180)),
    gold:  stooqSeries("xauusd", 430),
    m2:    fredSeries("M2SL",           key, isoDaysAgo(800)),
  };
  const keys = Object.keys(tasks);
  const res  = await Promise.allSettled(keys.map(k => tasks[k]));
  const data = {};
  res.forEach((r, i) => { if (r.status === "fulfilled" && r.value.length) data[keys[i]] = r.value; });

  if (data.us10y) { const a = data.us10y; out.us10y = { latest: last(a).v, chg30: +(last(a).v - agoVal(a, 21)).toFixed(2), date: last(a).d }; }
  if (data.tips)  { const a = data.tips;  out.tips  = { latest: +last(a).v.toFixed(2), chg30: +(last(a).v - agoVal(a, 21)).toFixed(2), date: last(a).d }; }
  if (data.dxy)   { const a = data.dxy;   const p = agoVal(a, 21); out.dxy = { latest: +last(a).v.toFixed(2), chg30: +(((last(a).v - p) / p) * 100).toFixed(2), date: last(a).d }; }
  if (data.gold)  {
    const a = data.gold; const p = agoVal(a, 21);
    const g = { latest: Math.round(last(a).v), chg30: +(((last(a).v - p) / p) * 100).toFixed(2), date: last(a).d };
    if (a.length >= 200) {
      const sma = a.slice(-200).reduce((s, o) => s + o.v, 0) / 200;
      g.r200 = +(last(a).v / sma).toFixed(3);
    }
    const hi = a.reduce((m, o) => o.v > m ? o.v : m, 0);
    if (hi > 0) g.dd = +(((last(a).v - hi) / hi) * 100).toFixed(1);
    out.gold = g;
  }
  if (data.m2)    { const a = data.m2;    const p = agoVal(a, 1);  out.m2    = { latest: last(a).v, chgPrev: +(((last(a).v - p) / p) * 100).toFixed(2), date: last(a).d }; }
  if (data.sp500) { const a = data.sp500; out.sp500 = { latest: last(a).v, series: a.slice(-130).map(o => [Date.parse(o.d), o.v]), date: last(a).d }; }

  out._fetchedAt = new Date().toISOString();
  return out;
}

async function getMacro(env) {
  let cached = null;
  try { cached = JSON.parse(await env.PANTA.get("macro")); } catch (_) {}
  if (cached && cached.data && (Date.now() - cached.ts) < MACRO_TTL_MS) return json(cached.data);
  const data = await buildMacro(env);
  try { await env.PANTA.put("macro", JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  return json(data);
}

/* ============================================================
   /goldhistory  (unverändert)
   ============================================================ */
const GOLD_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

// ── Gold: von Stooq auf Yahoo Finance umgestellt ─────────────────────────
// Derselbe Stooq-Bulk-CSV-Endpunkt, der bei den Indizes eine JavaScript-
// Challenge-Seite ausgeliefert hat, liegt auch hier dahinter — mit hoher
// Wahrscheinlichkeit dieselbe Ursache fuer die 500er.
//
// GC=F (Gold-Futures, COMEX) statt eines Spot-Tickers: Yahoo fuehrt dafuer
// durchgehende Tagesdaten. "range=max" gibt alles, was Yahoo hat — das
// sind schaetzungsweise 20-25 Jahre, nicht die 46+ Jahre der bisherigen
// Stooq/LBMA-Historie. Falls ein anderes Projekt auf dieser Route explizit
// die lange Historie braucht, muesste das separat geloest werden.
//
// Antwortform ERWEITERT, nicht ersetzt: `series` bleibt wie gehabt
// ([[ms,close],...]) fuer bestehende Verbraucher, `candles` kommt neu
// hinzu ([[ms,o,h,l,c,v],...]) und erlaubt erstmals echte Kerzen.
async function buildGoldHistory() {
  // ── Vierter Anlauf: LBMA-Direktfeed ────────────────────────────────
  //
  // Vorgeschichte, damit niemand dieselben Wege noch einmal geht:
  //   1. Stooq          → JavaScript-Challenge-Seite, serverseitig nicht loesbar
  //   2. Yahoo Finance  → HTTP 429 schon beim ersten Abruf mit leerem Cache
  //   3. FRED           → die LBMA-Goldreihen (GOLDAMGBD228NLBM /
  //                       GOLDPMGBD228NLBM) wurden aus FRED ENTFERNT.
  //                       FRED weist im eigenen Blog darauf hin.
  //   4. LBMA selbst    → veroeffentlicht die Fixings als offenes JSON,
  //                       ohne Schluessel, zurueck bis 1968.
  //
  // Format je Eintrag: { "d": "1968-04-01", "v": [USD, GBP, EUR] }
  // Wir nehmen Index 0 (USD). In den ersten Jahren steht bei EUR eine 0 —
  // deshalb NICHT auf Vollstaendigkeit des Arrays pruefen.
  //
  // WICHTIG zur Ehrlichkeit der Kerzen: Das sind Auktionspreise, keine
  // fortlaufenden Kurse. Es gibt zwei je Handelstag (AM und PM). Daraus
  // wird eine Tageskerze gebaut: open = AM, close = PM, high/low = das
  // Extrem der beiden. Das ist KEIN echtes Tages-Hoch/-Tief — der Kurs
  // schwankte dazwischen mehr. Fuer Struktur- und Trendbetrachtung ueber
  // Jahrzehnte reicht es, fuer Docht-Analyse nicht.
  const quellen = {
    am: "https://prices.lbma.org.uk/json/gold_am.json",
    pm: "https://prices.lbma.org.uk/json/gold_pm.json",
  };
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; TreydView/1.0)" };

  async function hole(url) {
    const r = await fetch(url, { headers, cf: { cacheTtl: 21600 } });
    if (!r.ok) throw new Error(`LBMA HTTP ${r.status} (${url})`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("LBMA: unerwartetes Format");
    const m = new Map();
    for (const row of j) {
      const d = row && row.d;
      const usd = row && Array.isArray(row.v) ? Number(row.v[0]) : NaN;
      if (!d || !isFinite(usd) || usd <= 0) continue;   // Feiertage tragen null
      m.set(d, usd);
    }
    return m;
  }

  const [am, pm] = await Promise.all([hole(quellen.am), hole(quellen.pm)]);
  if (am.size === 0 && pm.size === 0) throw new Error("LBMA lieferte keine Werte");

  // Vereinigung beider Tagesmengen — an manchen Tagen fehlt eine Auktion.
  const tage = [...new Set([...am.keys(), ...pm.keys()])].sort();
  const kerzen = [];
  const rows = [];
  const r2 = (x) => Math.round(x * 100) / 100;
  for (const d of tage) {
    const a = am.get(d), p = pm.get(d);
    const o = a != null ? a : p;
    const cl = p != null ? p : a;
    if (!isFinite(o) || !isFinite(cl)) continue;
    const ms = Date.parse(d + "T00:00:00Z");
    if (!isFinite(ms)) continue;
    kerzen.push([ms, r2(o), r2(Math.max(o, cl)), r2(Math.min(o, cl)), r2(cl), 0]);
    rows.push([ms, r2(cl)]);
  }
  if (kerzen.length === 0) throw new Error("LBMA: keine verwertbaren Tage");

  return {
    source: "LBMA (London Bullion Market Association) — Auktionspreise AM/PM",
    note: "Kerzen aus zwei Fixings je Tag; High/Low sind keine echten Tagesextreme.",
    from: kerzen[0][0], to: kerzen[kerzen.length - 1][0],
    count: kerzen.length,
    candles: kerzen,
    series: rows,
  };
}

async function getGoldHistory(env, request) {
  let cached = null;
  const goldKey = `goldhistory_${CACHE_VERSION}`;
  // ?from=<ms> liefert nur den Zuwachs — siehe zuschneiden().
  const from = request ? new URL(request.url).searchParams.get("from") : null;
  try { cached = JSON.parse(await env.PANTA.get(goldKey)); } catch (_) {}
  if (cached && cached.data && (Date.now() - cached.ts) < GOLD_HISTORY_TTL_MS) {
    return json(zuschneiden(cached.data, from));
  }

  let data;
  try {
    data = await buildGoldHistory();
  } catch (e) {
    // Wie bei den Indizes: lieber ein Tag alte Daten als ein Fehler,
    // sofern schon einmal ein erfolgreicher Abruf vorliegt.
    if (cached && cached.data) return json(zuschneiden(cached.data, from));
    return json({ error: String(e && e.message || e) }, 500);
  }

  try { await env.PANTA.put(goldKey, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  return json(zuschneiden(data, from));
}

/* ============================================================
   /bitstamp?pair=btcusd&step=86400
   Vollstaendige Kerzenhistorie von Bitstamp.

   Warum Bitstamp: Binance beginnt bei BTC/USDT im August 2017.
   Weiter zurueck kommt man dort nicht, egal was man am Worker baut.
   Bitstamp handelt BTC/USD seit 2011 und laeuft bis heute — eine
   durchgehende Reihe ohne Nahtstellen, statt zusammengeklebter
   Boersendaten mit Preissprüngen an den Uebergaengen.

   Bitstamp gibt hoechstens 1000 Kerzen je Anfrage zurueck. 2011 bis
   heute sind rund 5400 Tageskerzen, also wird hier serverseitig
   durchgeblaettert — der Browser stellt EINE Anfrage.
   ============================================================ */
// Schneidet eine fertige Historie auf den Zuwachs zu.
//
// Der Browser laedt die Altdaten aus einer statischen Datei im Repo und
// fragt hier nur noch, was seither dazugekommen ist. Das spart bei BTC
// rund 230 KB und bei Gold rund 530 KB je Aufruf — und der Chart
// funktioniert weiter, wenn diese Route einmal ausfaellt.
//
// Die Kerze AM Stichtag wird mitgeliefert (>=, nicht >): die letzte
// gespeicherte Kerze war moeglicherweise noch unvollstaendig und wird
// vom Zuwachs ueberschrieben.
function zuschneiden(data, fromParam) {
  const from = parseInt(fromParam || "0", 10);
  if (!isFinite(from) || from <= 0 || !Array.isArray(data.candles)) return data;
  const teil = data.candles.filter(k => k[0] >= from);
  return { ...data, candles: teil, count: teil.length, partial: true, since: from };
}

const BITSTAMP_PAIRS = new Set(["btcusd", "ethusd", "ltcusd", "xrpusd", "btceur", "etheur"]);
const BITSTAMP_TTL_MS = 6 * 60 * 60 * 1000;

async function getBitstamp(request, env) {
  const url  = new URL(request.url);
  const pair = (url.searchParams.get("pair") || "btcusd").toLowerCase();
  const step = parseInt(url.searchParams.get("step") || "86400", 10);

  // Ohne Weissliste waere die Route ein offener Proxy.
  if (!BITSTAMP_PAIRS.has(pair)) return json({ error: `Paar nicht erlaubt: ${pair}` }, 400);
  const ERLAUBTE_STEPS = new Set([3600, 14400, 86400]);
  if (!ERLAUBTE_STEPS.has(step)) return json({ error: `step nicht erlaubt: ${step}` }, 400);

  const key = `bitstamp_${pair}_${step}_${CACHE_VERSION}`;
  let cached = null;
  try { cached = JSON.parse(await env.PANTA.get(key)); } catch (_) {}
  const from = url.searchParams.get("from");
  if (cached && cached.data && (Date.now() - cached.ts) < BITSTAMP_TTL_MS) {
    return json(zuschneiden(cached.data, from));
  }

  let data;
  try {
    // Lange Historie nur bei Tageskerzen. Bei 1h/4h waeren es ueber 15
    // Jahre hunderttausende Kerzen, die niemand braucht und die den
    // Worker an sein CPU-Limit bringen.
    const maxKerzen = step >= 86400 ? 0 : 6000;
    data = await buildBitstampHistory(pair, step, maxKerzen);
  } catch (e) {
    if (cached && cached.data) return json(zuschneiden(cached.data, from));   // lieber alt als gar nichts
    return json({ error: String(e && e.message || e) }, 500);
  }
  try { await env.PANTA.put(key, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  return json(zuschneiden(data, from));
}

async function buildBitstampHistory(pair, step, maxKerzen) {
  // ── RUECKWAERTS paginieren, nicht vorwaerts ──────────────────────
  //
  // Die erste Fassung startete bei August 2011 — dem BTC-Listing. Fuer
  // ETH gab es damals nichts, Bitstamp lieferte eine leere erste Seite,
  // die Schleife brach ab und der Worker warf 500. Der Fehler war, das
  // Listing-Datum ANZUNEHMEN statt es herauszufinden.
  //
  // Rueckwaerts ab heute ueber "end" hat drei Vorteile: das Startdatum
  // ist egal und faellt als Ergebnis heraus, unbekannte Paare
  // funktionieren ohne Anpassung, und man kann nach genug Kerzen
  // aufhoeren — noetig fuer kurze Intervalle, wo 15 Jahre Historie
  // niemand braucht.
  const BASE = `https://www.bitstamp.net/api/v2/ohlc/${pair}/`;
  const LIMIT = 1000;
  const grenze = maxKerzen && maxKerzen > 0 ? maxKerzen : Infinity;
  const alle = new Map();
  let end = Math.floor(Date.now() / 1000);

  // Genug fuer 15 Jahre Tageskerzen; bei kurzen Intervallen greift
  // vorher die Kerzengrenze.
  const MAX_SEITEN = 20;

  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const u = `${BASE}?step=${step}&limit=${LIMIT}&end=${end}`;
    const r = await fetch(u, { cf: { cacheTtl: 3600 } });
    if (!r.ok) throw new Error(`Bitstamp HTTP ${r.status} (Seite ${seite + 1})`);
    const j = await r.json();
    const ohlc = j && j.data && Array.isArray(j.data.ohlc) ? j.data.ohlc : null;
    if (!ohlc) throw new Error("Bitstamp: unerwartetes Format");
    if (ohlc.length === 0) break;

    let aeltester = end;
    for (const k of ohlc) {
      const ts = parseInt(k.timestamp, 10);
      const o = parseFloat(k.open), h = parseFloat(k.high);
      const l = parseFloat(k.low),  cl = parseFloat(k.close);
      const v = parseFloat(k.volume);
      if (!isFinite(ts) || !isFinite(cl) || cl <= 0) continue;
      alle.set(ts * 1000, [ts * 1000, o, h, l, cl, isFinite(v) ? v : 0]);
      if (ts < aeltester) aeltester = ts;
    }
    if (alle.size >= grenze) break;
    // Weniger als eine volle Seite = Anfang der Historie erreicht.
    if (ohlc.length < LIMIT) break;
    if (aeltester >= end) break;          // kein Fortschritt
    end = aeltester - step;
  }

  let kerzen = [...alle.values()].sort((a, b) => a[0] - b[0]);
  if (kerzen.length === 0) {
    throw new Error(`Bitstamp: keine Kerzen fuer ${pair} (Paar gelistet?)`);
  }
  if (kerzen.length > grenze) kerzen = kerzen.slice(-grenze);

  return {
    source: `Bitstamp ${pair.toUpperCase()} (step ${step}s)`,
    from: kerzen[0][0], to: kerzen[kerzen.length - 1][0],
    count: kerzen.length,
    candles: kerzen,
  };
}

/* ============================================================
   /stooq?s=<symbol>  —  NEU
   Liefert Stooq-Tageskerzen für Aktienindizes als CSV.

   Nur Symbole auf der Weissliste sind erlaubt — ohne sie wäre
   die Route ein offener Proxy. Browser können Stooq nicht direkt
   abrufen (kein CORS), weshalb der Worker als Vermittler dient,
   genau wie bei /goldhistory.

   Der Unterschied zu buildGoldHistory: hier wird die CSV DIREKT
   weitergeleitet statt in ein JSON-Array umgewandelt — data.js
   (parseStooqCsv) versteht beide Formate.
   ============================================================ */
// ── Dritter und letzter Anlauf: FRED statt Stooq/Yahoo ──────────────────
// Zwei Fehlschlaege der Reihe nach:
//   1. Stooq (wie /goldhistory): JavaScript-Challenge-Seite, kein Server-
//      Fetch kann das umgehen.
//   2. Yahoo Finance: HTTP 429 bereits beim ERSTEN Versuch mit leerem
//      Cache — keine kurze Spitze, die ein Nachversuch abfaengt.
//
// Beide Versuche beruhten auf der Annahme "wird schon gehen", ohne einen
// Beleg dafuer, dass die gewaehlte Quelle aus DIESEM Worker heraus
// tatsaechlich zuverlaessig ist. Diesmal nicht: /macro fragt seit jeher
// fredSeries("SP500", ...) ab, und das ist der EINZIGE Stooq/FRED-
// verwandte Pfad im ganzen Worker, der in drei Fehlerrunden nie gemeldet
// wurde. Also FRED — dieselbe fredSeries()-Funktion, die schon nachweislich
// laeuft, nicht eine neu geratene Quelle.
//
// FRED fuehrt Aktienindizes nur als reine Schlusskurs-Reihe, kein
// OHLC/Volumen. Das reicht hier vollstaendig: drawCompare() in app.js
// liest fuer Vergleichslinien AUSSCHLIESSLICH .close, nie Hoch/Tief/Volumen
// (geprueft, nicht angenommen). Die CSV bekommt trotzdem alle sechs Spalten,
// mit Open=High=Low=Close und Volume=0 — data.js erwartet dieses Format
// und Close ist ueberall der einzige Wert, der tatsaechlich verwendet wird.
//
// KEIN eigener User-Agent, KEIN kuenstlicher Rate-Limit-Umgang noetig:
// FRED ist eine oeffentliche US-Regierungs-API mit registriertem
// Schluessel, kein Scraping-Ziel wie Stooq oder Yahoo.
// Zwei Quellen pro Index, in dieser Reihenfolge:
//
//   1. YAHOO  — liefert echtes OHLC. Nur damit sind Kerzen sinnvoll:
//               FRED veroeffentlicht fuer Indizes ausschliesslich
//               Schlusskurse, dort waere jede Kerze ein Strich ohne
//               Koerper und Docht.
//   2. FRED   — nur Schlusskurse, dafuer die bewaehrte Quelle. Springt
//               ein, wenn Yahoo mit 429 blockiert.
//
// Faellt Yahoo aus, bleibt der Chart also nutzbar (als Linie) statt leer.
// Das Antwortformat ist in beiden Faellen dasselbe.
const INDEX_QUELLEN = {
  "^spx": { yahoo: "^GSPC",  fred: "SP500"     },   // S&P 500
  "^ndq": { yahoo: "^IXIC",  fred: "NASDAQCOM" },   // Nasdaq Composite (passend zum FRED-Pendant)
  "^dji": { yahoo: "^DJI",   fred: "DJIA"      },   // Dow Jones Industrial Average
};

const STOOQ_TTL_MS = 24 * 60 * 60 * 1000;   // Tagesdaten, 24h Cache reicht

// Gemeinsame Yahoo-Abfrage samt Nachversuch bei 429 — dieselbe Logik wie
// bei Gold, hier nur mit anderem Ticker.
async function yahooKerzen(ticker) {
  const quelle = `https://query1.finance.yahoo.com/v8/finance/chart/`
    + `${encodeURIComponent(ticker)}?range=10y&interval=1d`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  let r = await fetch(quelle, { headers, cf: { cacheTtl: 21600 } });
  if (r.status === 429) {
    await new Promise(res => setTimeout(res, 400));
    r = await fetch(quelle, { headers, cf: { cacheTtl: 21600 } });
  }
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);

  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description || "keine Daten");

  const ts = result.timestamp || [];
  const q  = result.indicators?.quote?.[0] || {};
  const zeilen = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c2 = q.close?.[i];
    if (o == null || h == null || l == null || c2 == null) continue;
    const datum = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    const v = q.volume?.[i] ?? 0;
    zeilen.push(`${datum},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c2.toFixed(2)},${v}`);
  }
  if (!zeilen.length) throw new Error("0 Kerzen");
  return "Date,Open,High,Low,Close,Volume\n" + zeilen.join("\n");
}

async function buildIndexReihe(quellen, key, s) {
  // Erst Yahoo (echtes OHLC -> Kerzen moeglich).
  try {
    return await yahooKerzen(quellen.yahoo);
  } catch (eYahoo) {
    // Dann FRED (nur Schlusskurse, aber verlaesslich). O/H/L werden gleich
    // Close gesetzt, damit das Format stimmt — als Kerze waere das ein
    // Strich, als Linie voellig korrekt.
    if (!key) throw new Error(`Yahoo fehlgeschlagen (${eYahoo.message}), FRED-Schlüssel fehlt`);
    try {
      const obs = await fredSeries(quellen.fred, key, "2010-01-01");
      if (!obs.length) throw new Error("keine Daten");
      const zeilen = obs.map(({ d, v }) => `${d},${v.toFixed(2)},${v.toFixed(2)},${v.toFixed(2)},${v.toFixed(2)},0`);
      return "Date,Open,High,Low,Close,Volume\n" + zeilen.join("\n");
    } catch (eFred) {
      throw new Error(`Yahoo: ${eYahoo.message} | FRED: ${eFred.message}`);
    }
  }
}

async function getStooq(request, env) {
  const url = new URL(request.url);
  const s   = (url.searchParams.get("s") || "").toLowerCase();
  const quellen = INDEX_QUELLEN[s];

  if (!quellen)
    return err(`Symbol nicht erlaubt: ${s}. Erlaubt: ${Object.keys(INDEX_QUELLEN).join(", ")}`, 400);

  // Nicht mehr zwingend: ohne FRED-Schluessel laeuft Yahoo trotzdem.
  const key = env.FRED_API_KEY || env.FRED_KEY;

  const kvKey = `stooq_${s}_${CACHE_VERSION}`;
  let cached = null;
  try { cached = JSON.parse(await env.PANTA.get(kvKey)); } catch (_) {}
  if (cached && cached.csv && (Date.now() - cached.ts) < STOOQ_TTL_MS) return csv(cached.csv);

  let text;
  try {
    text = await buildIndexReihe(quellen, key, s);
  } catch (e) {
    if (cached && cached.csv) return csv(cached.csv);
    return err(String(e && e.message || e), 502);
  }

  try { await env.PANTA.put(kvKey, JSON.stringify({ ts: Date.now(), csv: text })); } catch (_) {}
  return csv(text);
}

/* ============================================================
   /m2  —  NEU
   Liefert die globale M2-Geldmenge in Mrd. USD als CSV.
   Format: date,value  (eine Zeile pro Monat, sortiert aufsteigend)

   Zusammengesetzt aus vier FRED-Reihen:
     M2SL           USA        Mrd. USD   → Faktor 1
     MYAGM2EZM196N  Euroraum   Mrd. EUR   → × 1.08  (fester Kurs)
     MYAGM2JPM189S  Japan      Mrd. JPY   → ÷ 155   (fester Kurs)
     MYAGM2CNM189N  China      Mrd. CNY   → ÷ 7.2   (fester Kurs)

   Warum feste Wechselkurse: M2 erscheint monatlich. Ein tagesaktueller
   Kurs würde rückwirkend Schwankungen in historische Monatswerte schreiben,
   die es nie gab. Wer eine kursadjustierte Reihe braucht, muss historische
   Monatskurse separat laden.

   Nur Monate, für die ALLE vier Reihen vorliegen, gehen in die Ausgabe —
   eine fehlende Veröffentlichung eines Landes soll nicht als Einbruch
   erscheinen.

   Braucht das Secret FRED_API_KEY (oder FRED_KEY als Fallback).
   Beide Secrets können denselben Wert haben.
   ============================================================ */
const M2_TTL_MS = 24 * 60 * 60 * 1000;   // 24h — erscheint monatlich

// KORRIGIERT — urspruengliche Faktoren gingen faelschlich davon aus, dass
// alle vier Serien bereits "in Milliarden" gemeldet werden. Nur M2SL (USA)
// stimmt das: FRED fuehrt es explizit als "Billions of Dollars".
//
// Die drei IWF-Serien (Euroraum, Japan, China) melden dagegen die ROHE
// Landeswaehrung, nicht Milliarden. Beleg direkt von FRED: M2 fuer den
// Euroraum stand im Maerz 2017 bei 10'876'141'000'000 mit der Einheit
// "Euros" — nicht 10'876 wie bei einer Milliarden-Skalierung. Dieselbe
// IWF-Quelle ("International Financial Statistics") und dasselbe
// Namensschema gelten fuer Japan und China, deshalb hier ebenfalls durch
// 1e9 geteilt, bevor der Wechselkurs angewendet wird.
//
// Symptom des Fehlers: eine einzelne, extrem grosse und vollkommen flache
// Linie (z. B. 39'860'906'812'499) — der Fehlbetrag war durchgehend um den
// Faktor ~1e9 zu gross, weil roh statt in Milliarden gerechnet wurde.
const M2_REIHEN = [
  { id: "M2SL",           faktor: 1              },   // USA — bereits Mrd. USD
  { id: "MYAGM2EZM196N",  faktor: 1.08     / 1e9 },   // Euroraum — rohe EUR
  { id: "MYAGM2JPM189S",  faktor: (1/155)  / 1e9 },   // Japan — rohe JPY
  { id: "MYAGM2CNM189N",  faktor: (1/7.2)  / 1e9 },   // China — rohe CNY
];

// Ergebnis muss in einer plausiblen Groessenordnung liegen (Mrd. USD).
// Verhindert, dass ein kuenftiger, noch unbekannter Einheiten-Fehler
// erneut eine absurde Zahl aufs Chart bringt — lieber eine Zeile
// auslassen als eine Zahl zu zeigen, die niemand ernst nehmen kann.
const M2_PLAUSIBEL_MIN = 1000;      // < $1 Billion waere garantiert falsch
const M2_PLAUSIBEL_MAX = 1000000;   // > $1000 Billionen ebenso

// WICHTIG — warum hier NICHT auf vollstaendige Monate gewartet wird:
//
// Die urspruengliche Fassung nahm nur Monate, in denen ALLE VIER Laender
// einen Wert hatten. Das klang sauber, war aber praktisch unbrauchbar:
// FRED hat die China-Reihe (MYAGM2CNM189N) im August 2019 EINGESTELLT.
// Damit gab es ab 2019 keinen einzigen gemeinsamen Monat mehr, die Ausgabe
// blieb leer und das Frontend meldete "Keine plausiblen M2-Daten erhalten".
//
// Neue Regel: Ein Monat zaehlt, sobald die USA (die verlaessliche
// Leitreihe) einen Wert hat. Fehlt ein Land, wird dessen LETZTER bekannter
// Wert fortgeschrieben — dieselbe Treppen-Logik, die der Indikator im
// Frontend ohnehin auf Monatsdaten anwendet.
//
// Das ist eine bewusste Abwaegung: Fuer China ab 2019 ist der Beitrag
// eingefroren, die Kurve zeigt dort also nur noch die Bewegung der anderen
// drei. Das ist deutlich naeher an der Wahrheit als gar keine Kurve — aber
// es ist eine Schaetzung, kein exakter Wert. Wer exakte globale M2-Daten
// braucht, kommt an einer kostenpflichtigen Quelle nicht vorbei.
async function buildM2(key) {
  const reihen = await Promise.all(
    M2_REIHEN.map(r =>
      fredSeries(r.id, key, "2010-01-01")
        .then(obs => ({ obs, faktor: r.faktor, id: r.id }))
        .catch(() => ({ obs: [], faktor: r.faktor, id: r.id }))   // einzelne Reihe darf ausfallen
    )
  );

  const [usa, ...rest] = reihen;
  if (!usa.obs.length) throw new Error("FRED M2SL (USA) lieferte keine Daten");

  // Fuer jedes Land: sortierte Liste plus Zeiger, um beim Durchlaufen der
  // US-Monate den jeweils letzten bekannten Wert mitzufuehren.
  const stand = rest.map(r => ({
    obs: r.obs.slice().sort((a, b) => (a.d < b.d ? -1 : 1)),
    faktor: r.faktor,
    i: 0,
    letzter: null,
  }));

  const zeilen = [];
  const usaSortiert = usa.obs.slice().sort((a, b) => (a.d < b.d ? -1 : 1));

  for (const { d, v } of usaSortiert) {
    let summe = v * usa.faktor;
    for (const s of stand) {
      while (s.i < s.obs.length && s.obs[s.i].d <= d) { s.letzter = s.obs[s.i].v; s.i++; }
      if (s.letzter != null) summe += s.letzter * s.faktor;
    }
    if (summe >= M2_PLAUSIBEL_MIN && summe <= M2_PLAUSIBEL_MAX) zeilen.push([d, summe]);
  }

  if (!zeilen.length) {
    // Diagnose mitgeben statt nur "keine Daten" — sonst steht man beim
    // naechsten Mal wieder ohne Anhaltspunkt da.
    const info = reihen.map(r => `${r.id}:${r.obs.length}`).join(" ");
    throw new Error(`Keine plausiblen M2-Monate (Reihenlaengen: ${info})`);
  }
  return zeilen;
}

async function getM2(env) {
  // FRED_API_KEY hat Vorrang; FRED_KEY als Fallback (beide können denselben Wert haben).
  const key = env.FRED_API_KEY || env.FRED_KEY;
  if (!key) return err("FRED_API_KEY fehlt (wrangler secret put FRED_API_KEY)", 500);

  // KV-Cache prüfen
  let cached = null;
  const m2Key = `m2_${CACHE_VERSION}`;
  try { cached = JSON.parse(await env.PANTA.get(m2Key)); } catch (_) {}
  if (cached && cached.ts && cached.csv && (Date.now() - cached.ts) < M2_TTL_MS)
    return csv(cached.csv);

  const zeilen = await buildM2(key);
  const text = "date,value\n" + zeilen.map(([d, v]) => `${d},${v.toFixed(2)}`).join("\n");

  // In KV cachen — 24h ausreichend für eine Monatsreihe.
  try { await env.PANTA.put(m2Key, JSON.stringify({ ts: Date.now(), csv: text })); } catch (_) {}

  return csv(text);
}

/* ============================================================
   /history  und  /snapshot  (unverändert)
   ============================================================ */
async function getHistory(env) {
  let arr = [];
  try { arr = JSON.parse(await env.PANTA.get("snapshots")) || []; } catch (_) {}
  return json(arr);
}

async function postSnapshot(request, env) {
  if (env.SNAP_KEY && request.headers.get("X-Panta-Key") !== env.SNAP_KEY)
    return new Response("unauthorized", { status: 401, headers: CORS });
  const snap = await request.json();
  if (!snap || !snap.date) return json({ error: "snapshot braucht ein date" }, 400);
  let arr = [];
  try { arr = JSON.parse(await env.PANTA.get("snapshots")) || []; } catch (_) {}
  const i = arr.findIndex(x => x.date === snap.date);
  if (i >= 0) arr[i] = snap; else arr.push(snap);
  arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (arr.length > MAX_SNAPSHOTS) arr = arr.slice(-MAX_SNAPSHOTS);
  await env.PANTA.put("snapshots", JSON.stringify(arr));
  return json({ ok: true, stored: snap.date, count: arr.length });
}
