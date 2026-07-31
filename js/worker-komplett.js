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
      if (url.pathname === "/stooq"       && request.method === "GET")  return await getStooq(request);
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

async function buildGoldHistory() {
  const u = "https://stooq.com/q/d/l/?s=xauusd&i=d";
  const r = await fetch(u, {
    cf: { cacheTtl: 3600 },
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PantaRey/1.0)" },
  });
  if (!r.ok) throw new Error(`Stooq xauusd HTTP ${r.status}`);
  const text  = await r.text();
  const lines = text.trim().split("\n");
  if (!lines.length) throw new Error("Stooq: leere Antwort");

  const header = lines[0].toLowerCase();
  const cols   = header.split(",");
  const iDate  = cols.findIndex(c => c.includes("date"));
  const iClose = cols.findIndex(c => c.includes("close"));
  if (iDate < 0 || iClose < 0)
    throw new Error(`Stooq: unbekanntes Format. Erste Zeile: ${lines[0].slice(0, 120)}`);

  const rows = lines.slice(1)
    .map(l => l.split(","))
    .filter(c => c.length > iClose && c[iClose] && isFinite(parseFloat(c[iClose])))
    .map(c => [Date.parse(c[iDate].trim()), Math.round(parseFloat(c[iClose]) * 100) / 100])
    .filter(([ms]) => !isNaN(ms) && ms > 0)
    .sort((a, b) => a[0] - b[0]);

  if (!rows.length)
    throw new Error(`Stooq: 0 Zeilen geparsed. Header: ${lines[0].slice(0, 80)} | Beispiel: ${lines[1] || "—"}`);

  const from = new Date(rows[0][0]).toISOString().slice(0, 10);
  const to   = new Date(rows[rows.length - 1][0]).toISOString().slice(0, 10);
  return { series: rows, from, to, n: rows.length, _fetchedAt: new Date().toISOString() };
}

async function getGoldHistory(env) {
  let cached = null;
  try { cached = JSON.parse(await env.PANTA.get("goldhistory")); } catch (_) {}
  if (cached && cached.data && (Date.now() - cached.ts) < GOLD_HISTORY_TTL_MS) return json(cached.data);
  const data = await buildGoldHistory();
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
// ── Verlaufsentscheidung (zweiter Anlauf) ────────────────────────────────
// Erster Versuch: diese Route an stooqSeries() (fuer /macro) angleichen —
// Datumsbereich statt Vollhistorie, kein kuenstlicher User-Agent. Schlug
// TROTZDEM fehl. Die tatsaechliche Antwort war keine Ratenbegrenzung
// (kein Text wie "Exceeded the daily hits limit"), sondern eine waschechte
// JavaScript-Challenge-Seite: <meta name="robots" content="noindex,nofollow">
// plus <noscript>-Hinweis. Stooq verlangt an diesem Endpunkt inzwischen
// einen echten Browser, der JS ausfuehrt — das kann ein Server-Fetch
// grundsaetzlich NICHT loesen, unabhaengig von Kopfzeilen oder Parametern.
//
// Deshalb Quelle gewechselt: Yahoo Finance liefert Index-Tageskerzen ueber
// eine JSON-Chart-API, die ohne Browser/JS abrufbar ist — der uebliche Weg,
// den auch verbreitete Bibliotheken (z. B. yfinance) dafuer nutzen.
//
// Der Rueckgabewert bleibt CSV im GLEICHEN Format wie zuvor
// (Date,Open,High,Low,Close,Volume) — data.js und config.js muessen sich
// dadurch NICHT aendern, nur die Quelle hinter der Route ist neu.
//
// ACHTUNG — Annahme, die noch bestaetigt werden sollte: "Nasdaq" ist ohne
// Zusatz mehrdeutig. ^NDX ist der Nasdaq-100 (das schon in config.js
// verwendete Label). ^IXIC waere stattdessen der breitere Nasdaq
// Composite. Falls der Composite gemeint war, in YAHOO_SYMBOLE unten
// austauschen — sonst nichts weiter noetig.
const YAHOO_SYMBOLE = {
  "^spx": "^GSPC",   // S&P 500
  "^ndq": "^NDX",    // Nasdaq-100 — ^IXIC waere der Composite
  "^dji": "^DJI",    // Dow Jones Industrial Average
};

async function getStooq(request) {
  const url = new URL(request.url);
  const s   = (url.searchParams.get("s") || "").toLowerCase();
  const yahooSym = YAHOO_SYMBOLE[s];

  if (!yahooSym)
    return err(`Symbol nicht erlaubt: ${s}. Erlaubt: ${Object.keys(YAHOO_SYMBOLE).join(", ")}`, 400);

  const quelle = `https://query1.finance.yahoo.com/v8/finance/chart/`
    + `${encodeURIComponent(yahooSym)}?range=10y&interval=1d`;

  const r = await fetch(quelle, { cf: { cacheTtl: 21600 } });
  if (!r.ok) return err(`Yahoo Finance HTTP ${r.status} für ${s}`, 502);

  let json;
  try { json = await r.json(); }
  catch (e) { return err(`Yahoo Finance: ungültiges JSON für ${s}`, 502); }

  const result = json?.chart?.result?.[0];
  if (!result) {
    const grund = json?.chart?.error?.description || "unbekannter Fehler";
    return err(`Yahoo Finance lieferte keine Daten für ${s}: ${grund}`, 502);
  }

  const zeitstempel = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const zeilen = [];
  for (let i = 0; i < zeitstempel.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    // Feiertage und Luecken liefern null statt einer Zahl — auslassen statt
    // eine erfundene Kerze einzufuegen.
    if (o == null || h == null || l == null || c == null) continue;
    const datum = new Date(zeitstempel[i] * 1000).toISOString().slice(0, 10);
    const v = q.volume?.[i] ?? 0;
    zeilen.push(`${datum},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c.toFixed(2)},${v}`);
  }
  if (!zeilen.length) return err(`Yahoo Finance: 0 Kerzen für ${s}`, 502);

  return csv("Date,Open,High,Low,Close,Volume\n" + zeilen.join("\n"));
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

const M2_REIHEN = [
  { id: "M2SL",           faktor: 1        },   // USA,      Mrd. USD
  { id: "MYAGM2EZM196N",  faktor: 1.08     },   // Euroraum, Mrd. EUR → USD
  { id: "MYAGM2JPM189S",  faktor: 1 / 155  },   // Japan,    Mrd. JPY → USD
  { id: "MYAGM2CNM189N",  faktor: 1 / 7.2  },   // China,    Mrd. CNY → USD
];

async function buildM2(key) {
  // Alle vier Reihen parallel holen, dann nach Datum zusammenführen.
  const reihen = await Promise.all(
    M2_REIHEN.map(r =>
      fredSeries(r.id, key, "2010-01-01").then(obs => ({ obs, faktor: r.faktor }))
    )
  );

  // Erste Reihe als Ankerpunkt; die anderen per Datum nachschlagen.
  const restMaps = reihen.slice(1).map(r => {
    const m = new Map();
    r.obs.forEach(o => m.set(o.d, o.v));
    return { map: m, faktor: r.faktor };
  });

  const zeilen = [];
  for (const { d, v } of reihen[0].obs) {
    let summe = v * M2_REIHEN[0].faktor;
    let ok = true;
    for (const { map, faktor } of restMaps) {
      const w = map.get(d);
      if (w == null) { ok = false; break; }
      summe += w * faktor;
    }
    if (ok) zeilen.push([d, summe]);
  }
  zeilen.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!zeilen.length) throw new Error("Keine gemeinsamen M2-Monate gefunden");
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
