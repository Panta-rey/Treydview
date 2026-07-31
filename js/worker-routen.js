// ─────────────────────────────────────────────────────────────────────────
// TreydView — Worker-Routen für Indizes und Global M2
//
// Zum Einfügen in den bestehenden Cloudflare-Worker
// (pantarey.rey-gafner.workers.dev), NEBEN der vorhandenen /goldhistory-Route.
//
// Warum überhaupt ein Worker: Stooq und die Notenbank-Quellen senden keine
// CORS-Kopfzeilen. Ein direkter fetch() aus dem Browser wird deshalb vom
// Browser blockiert — unabhängig davon, ob die Daten öffentlich sind. Genau
// derselbe Grund, aus dem Gold schon über den Worker läuft.
//
// Beide Routen liefern CSV durch. TreydView versteht CSV wie JSON; die
// Umwandlung passiert im Browser (data.js: parseStooqCsv / fetchGlobalM2).
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Nur diese Symbole sind erlaubt. Ohne diese Liste wäre die Route ein
// offener Proxy, über den jeder beliebige Stooq-Abfragen über deine Domain
// laufen lassen könnte.
const ERLAUBTE_SYMBOLE = new Set(["^spx", "^ndq", "^dji"]);

async function routeStooq(request) {
  const url = new URL(request.url);
  const s = (url.searchParams.get("s") || "").toLowerCase();

  if (!ERLAUBTE_SYMBOLE.has(s)) {
    return new Response(`Symbol nicht erlaubt: ${s}`, {
      status: 400,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // i=d = Tageswerte. Stooq liefert CSV mit Kopfzeile
  // Date,Open,High,Low,Close,Volume
  const quelle = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;

  const res = await fetch(quelle, {
    // Ohne User-Agent antwortet Stooq gelegentlich mit einer leeren Seite.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TreydView/1.0)" },
    // Zwölf Stunden puffern: Tageswerte ändern sich höchstens einmal täglich.
    cf: { cacheTtl: 43200, cacheEverything: true },
  });

  if (!res.ok) {
    return new Response(`Stooq HTTP ${res.status}`, {
      status: 502,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const text = await res.text();

  // Stooq antwortet bei Überlastung mit HTTP 200 und dem Text "Exceeded the
  // daily hits limit" — ohne diese Prüfung käme das als gültige CSV an und
  // der Chart bliebe kommentarlos leer.
  if (!/^date,/i.test(text.trim())) {
    return new Response(`Stooq lieferte keine CSV: ${text.slice(0, 120)}`, {
      status: 502,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(text, {
    headers: {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=43200",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Global M2
//
// "Globale M2-Geldmenge" ist keine Zahl, die jemand veröffentlicht — sie
// wird aus den Angaben mehrerer Notenbanken zusammengesetzt und in eine
// Währung umgerechnet. Diese Route summiert die vier grössten Blöcke in
// US-Dollar:
//
//   USA       FRED  M2SL     bereits in Mrd. USD
//   Euroraum  FRED  MYAGM2EZM196N   in Mrd. EUR  -> * EURUSD
//   Japan     FRED  MYAGM2JPM189S   in Mrd. JPY  -> / USDJPY
//   China     FRED  MYAGM2CNM189N   in Mrd. CNY  -> / USDCNY
//
// Die Umrechnungskurse sind bewusst FEST und nicht tagesaktuell: M2 ist eine
// Monatsreihe, und ein tagesaktueller Kurs würde in die Vergangenheit hinein
// Schwankungen erzeugen, die es nie gab. Wer eine wechselkursbereinigte
// Reihe braucht, muss historische Monatskurse mitziehen — das ist bewusst
// nicht Teil dieser Route.
//
// FRED braucht einen kostenlosen API-Schlüssel (fred.stlouisfed.org).
// Als Secret hinterlegen:  wrangler secret put FRED_API_KEY
// ─────────────────────────────────────────────────────────────────────────

const M2_REIHEN = [
  { id: "M2SL",            faktor: 1        },   // USA, Mrd. USD
  { id: "MYAGM2EZM196N",   faktor: 1.08     },   // Euroraum, Mrd. EUR
  { id: "MYAGM2JPM189S",   faktor: 1 / 155  },   // Japan, Mrd. JPY
  { id: "MYAGM2CNM189N",   faktor: 1 / 7.2  },   // China, Mrd. CNY
];

async function fredReihe(id, key) {
  const u = `https://api.stlouisfed.org/fred/series/observations`
    + `?series_id=${id}&api_key=${key}&file_type=json&observation_start=2010-01-01`;
  const res = await fetch(u, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  const json = await res.json();
  const out = new Map();
  for (const o of json.observations || []) {
    const v = parseFloat(o.value);          // fehlende Werte kommen als "."
    if (isFinite(v)) out.set(o.date, v);
  }
  return out;
}

async function routeM2(request, env) {
  const key = env.FRED_API_KEY;
  if (!key) {
    return new Response("FRED_API_KEY fehlt (wrangler secret put FRED_API_KEY)", {
      status: 500,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let reihen;
  try {
    reihen = await Promise.all(M2_REIHEN.map(r => fredReihe(r.id, key)));
  } catch (e) {
    return new Response(String(e.message || e), {
      status: 502,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Nur Monate nehmen, für die ALLE vier Reihen einen Wert haben. Sonst
  // entstehen Stufen, die nur daher rühren, dass ein Land noch nicht
  // veröffentlicht hat — das sähe im Chart wie ein echter Einbruch aus.
  const [erste, ...rest] = reihen;
  const zeilen = [];
  for (const [datum, wert] of erste) {
    let summe = wert * M2_REIHEN[0].faktor;
    let vollstaendig = true;
    for (let i = 0; i < rest.length; i++) {
      const v = rest[i].get(datum);
      if (v == null) { vollstaendig = false; break; }
      summe += v * M2_REIHEN[i + 1].faktor;
    }
    if (vollstaendig) zeilen.push([datum, summe]);
  }
  zeilen.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  if (!zeilen.length) {
    return new Response("Keine gemeinsamen M2-Monate gefunden", {
      status: 502,
      headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // CSV date,value — genau das, was data.js erwartet.
  const csv = "date,value\n"
    + zeilen.map(([d, v]) => `${d},${v.toFixed(2)}`).join("\n");

  return new Response(csv, {
    headers: {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Einbau in den bestehenden Worker
//
// In deinem vorhandenen fetch-Handler VOR der Gold-Route ergänzen:
//
//   export default {
//     async fetch(request, env, ctx) {
//       const pfad = new URL(request.url).pathname;
//
//       if (request.method === "OPTIONS") {
//         return new Response(null, { headers: CORS });
//       }
//       if (pfad === "/stooq") return routeStooq(request);
//       if (pfad === "/m2")    return routeM2(request, env);
//
//       // ... hier bleibt deine bestehende /goldhistory-Route unverändert
//     },
//   };
//
// Danach prüfen:
//   curl "https://pantarey.rey-gafner.workers.dev/stooq?s=^spx" | head -3
//   curl "https://pantarey.rey-gafner.workers.dev/m2" | head -3
//
// Erwartet:
//   Date,Open,High,Low,Close,Volume
//   date,value
// ─────────────────────────────────────────────────────────────────────────

export { routeStooq, routeM2, CORS };
