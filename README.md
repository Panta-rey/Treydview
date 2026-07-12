# TreydView — Chart-Cockpit (v0.4)

TradingView-artiges Chart-Cockpit als rein statische Web-App. Engine: **KLineCharts v9** (Apache 2.0, kein Attributions-Branding). Krypto live via Binance, Gold (XAU/USD, Daily) über den bestehenden Cloudflare Worker.

## Neu in v0.2 (Engine-Wechsel)

- Engine von `lightweight-charts` auf **KLineCharts 9.8.12** gewechselt — kein "Charting by TradingView" mehr
- **1M-Timeframe** ergänzt
- **Letzte Indikatorwerte an der Preisachse** aktiviert (`lastValueMark`)
- **Zeichenwerkzeuge** (linke Toolbar): Trendlinie, Strahl, Horizontale/Vertikale, Preislinie, Preiskanal, Parallele, Fibonacci Retracement, Rechteck, Price Range, Date Range, Alles-löschen
- **Neue Indikatoren:** EMA 21/100/200, Bull Market Support Band (echtes Wochen-Resampling: 20W SMA + 21W EMA, auf jedem TF), Hull Suite 55 (trendgefärbt), Rolling VWAP 365d, Gaussian Channel (Ehlers, 144 / 1.414 / 4 Pole), dazu BB 20/2, RSI 14, Volumen

## Setup

1. In `js/config.js` die Worker-URL eintragen:
   ```js
   WORKER_BASE_URL: "https://panta-rey.DEINNAME.workers.dev",
   ```
2. Lokal testen:
   ```bash
   python3 -m http.server 8080   # → http://localhost:8080
   ```

## Deploy

```bash
git init && git add . && git commit -m "TreydView v0.2 — KLineCharts-Rebuild"
git branch -M main
git remote add origin git@github.com:DEINNAME/treydview.git
git push -u origin main
```
Dann Settings → Pages → Source: `main` / root.

## Gold-Endpoint

Toleranter Parser in `js/data.js` (`normalizeGoldRow`): JSON-Arrays (lange oder kurze Keys), `{data:[...]}`/`{history:[...]}`-Wrapper, Nur-Close-Reihen, Stooq-CSV. Bei abweichendem Format nur `normalizeGoldRow()` anpassen. **CORS:** Worker muss `Access-Control-Allow-Origin` setzen.

## Struktur

```
treydview/
├── index.html          Layout, KLineCharts-CDN
├── css/style.css       Terminal-Theme + Drawing-Toolbar
└── js/
    ├── config.js       Worker-URL, Symbole, TFs, Indikator-Registry, Tools
    ├── indicators.js   Custom: BMSB, HULL, RVWAP, GC (registerIndicator)
    ├── overlays.js     Custom: rectangle, priceRange, dateRange (registerOverlay)
    ├── data.js         Binance REST/WS + Gold-Adapter (ms-Timestamps)
    └── app.js          Chart-Init, Theme, Toggles, Draw-Toolbar, Live-Stream
```

## Bewusste Grenzen & Roadmap

- **RVWAP 365d** braucht 365 Tage Daten im Fenster — auf 15m/1h übersteigt das die geladenen 1000 Candles, der Indikator bleibt dort bewusst leer statt falsch zu rechnen. Sinnvoll ab 4h/1D.
- **Gaussian Channel** blendet die Einschwingphase (~144 Bars) aus.
- **Noch nicht drin (nächste Stufen):** VRVP / Fixed Range Volume Profile, Fair Value Gap / Imbalance, Orderblocks (alle: Pattern-Detection + Box-Rendering, gestaffelt), Settings-Panel im UI (Parameter aktuell via `config.js`).
- **Realised Price** ist eine On-Chain-Metrik (Realized Cap ÷ Supply) und braucht eine externe Datenquelle — geplanter Weg: `/realizedprice`-Endpoint auf dem Cloudflare Worker (z.B. CoinMetrics Community API, KV-Cache), analog `/goldhistory`.

## Lizenz

MIT. KLineCharts ist Apache 2.0.
