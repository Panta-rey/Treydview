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
      if (url.pathname === "/goldhistory" && request.method === "GET")  return await getGoldHistory(env);
      if (url.pathname === "/stooq"       && request.method === "GET")  return await getStooq(request, env);
      if (url.pathname === "/m2"          && request.method === "GET")  return await getM2(env);
      if (url.pathname === "/history"     && request.method === "GET")  return await getHistory(env);
      if (url.pathname === "/snapshot"    && request.method === "POST") return await postSnapshot(request, env);
      if (url.pathname === "/")
        return json({ ok: true, service: "panta-rey", routes: ["/macro", "/goldhistory", "/stooq", "/m2", "/history", "/snapshot"] });
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
// Antwortform bewusst UNVERAENDERT: { series:[[ms,close],...], from, to,
// n, _fetchedAt } — falls ein anderer Verbraucher dieses Format erwartet,
// bleibt er unberuehrt. Nur die Quelle dahinter ist neu.
async function buildGoldHistory() {
  const quelle = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=max&interval=1d";
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  let r = await fetch(quelle, { headers, cf: { cacheTtl: 21600 } });
  if (r.status === 429) {
    await new Promise(res => setTimeout(res, 400));
    r = await fetch(quelle, { headers, cf: { cacheTtl: 21600 } });
  }
  if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status} für Gold`);

  let json2;
  try { json2 = await r.json(); }
  catch (e) { throw new Error("Yahoo Finance: ungültiges JSON für Gold"); }

  const result = json2?.chart?.result?.[0];
  if (!result) {
    const grund = json2?.chart?.error?.description || "unbekannter Fehler";
    throw new Error(`Yahoo Finance lieferte keine Gold-Daten: ${grund}`);
  }

  const zeitstempel = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < zeitstempel.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue;   // Feiertage/Luecken auslassen
    rows.push([zeitstempel[i] * 1000, Math.round(c * 100) / 100]);
  }
  if (!rows.length) throw new Error("Yahoo Finance: 0 Gold-Kerzen erhalten");
  rows.sort((a, b) => a[0] - b[0]);

  const from = new Date(rows[0][0]).toISOString().slice(0, 10);
  const to   = new Date(rows[rows.length - 1][0]).toISOString().slice(0, 10);
  return { series: rows, from, to, n: rows.length, _fetchedAt: new Date().toISOString() };
}

async function getGoldHistory(env) {
  let cached = null;
  try { cached = JSON.parse(await env.PANTA.get("goldhistory")); } catch (_) {}
  if (cached && cached.data && (Date.now() - cached.ts) < GOLD_HISTORY_TTL_MS) return json(cached.data);

  let data;
  try {
    data = await buildGoldHistory();
  } catch (e) {
    // Wie bei den Indizes: lieber ein Tag alte Daten als ein Fehler,
    // sofern schon einmal ein erfolgreicher Abruf vorliegt.
    if (cached && cached.data) return json(cached.data);
    return json({ error: String(e && e.message || e) }, 500);
  }

  try { await env.PANTA.put("goldhistory", JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  return json(data);
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

  const kvKey = `stooq_${s}`;
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
  try { cached = JSON.parse(await env.PANTA.get("m2")); } catch (_) {}
  if (cached && cached.ts && cached.csv && (Date.now() - cached.ts) < M2_TTL_MS)
    return csv(cached.csv);

  const zeilen = await buildM2(key);
  const text = "date,value\n" + zeilen.map(([d, v]) => `${d},${v.toFixed(2)}`).join("\n");

  // In KV cachen — 24h ausreichend für eine Monatsreihe.
  try { await env.PANTA.put("m2", JSON.stringify({ ts: Date.now(), csv: text })); } catch (_) {}

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
