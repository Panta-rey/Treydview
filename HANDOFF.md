# TreydView — HANDOFF

Übergabe-Dokument für künftige Arbeits-Sessions (Claude-Chat, Claude Code, oder andere Entwickler). Stand: v0.4, Juli 2026.

## Was ist TreydView

TradingView-artiges Chart-Cockpit für Rey (GitHub: Panta-rey). Rein statische Web-App (HTML/CSS/JS, kein Build-Step), gehostet auf GitHub Pages. Teil der Panta-Rey-Suite (neben Metronom, BTTF, Stromschnelle).

- **Repo:** github.com/Panta-rey/Treydview
- **Live:** https://panta-rey.github.io/Treydview/
- **Lokal beim User:** `C:\Users\rey_g\projects\treydview` (Windows, PowerShell)

## Architektur

- **Chart-Engine:** KLineCharts 9.8.12 via unpkg-CDN (UMD, global `klinecharts`). Apache 2.0, KEIN TradingView-Branding. Bewusster Wechsel von `lightweight-charts` in v0.2 (Attributionspflicht + fehlende Drawing-Tools).
- **Daten Krypto:** Binance REST (`/klines`, 1000 Candles) + WebSocket-Livestream mit Auto-Reconnect. Symbolliste dynamisch via `/exchangeInfo` (alle USDT-Paare).
- **Daten Gold:** Cloudflare Worker des Users, Endpoint `/goldhistory` (Stooq XAU/USD, Daily). Toleranter Parser in `data.js` (`normalizeGoldRow`): JSON-Arrays, `{data:[]}`-Wrapper, Nur-Close, Stooq-CSV. **Worker-URL muss in `js/config.js` gesetzt sein** — im Repo steht ein Platzhalter. CORS am Worker nötig.
- **Timestamps:** KLineCharts erwartet Millisekunden.

## Dateien

```
index.html        Layout: Topbar (3 Dropdowns), Drawbar links, Chart, Settings-Modal
css/style.css     Terminal-Theme (Blauschwarz + Gold #e8b64c), IBM Plex Mono / Archivo
js/config.js      ALLES Konfigurierbare: Worker-URL, Symbole, TFs, Indikator-Registry
                  (inputs + plots Schema), Draw-Tools, Theme. Plus hexToRgba()-Helfer.
js/indicators.js  Custom-Indikatoren via klinecharts.registerIndicator:
                  MNOODLE, BMSB, HULL, RVWAP, GC. Styles kommen dynamisch aus
                  indicator.extendData.plots (siehe plotStyle()-Helfer).
js/overlays.js    Custom-Zeichenwerkzeuge via registerOverlay:
                  rectangle, priceRange, dateRange. Rest ist KLineCharts-nativ.
js/data.js        DataLayer: fetchBinanceKlines, openBinanceStream, fetchGoldHistory
js/settings.js    Settings-Modal mit Tabs (Inputs/Style). Pro Plot: visible,
                  Farbe (hex), Deckkraft-Slider (0-100), Linienstärke.
                  Persistenz: localStorage "tv4_ind_<key>".
js/app.js         Verdrahtung: Chart-Init/Theme, buildCreate() (Settings→calcParams/
                  extendData/styles), VRVP-Canvas, Dropdowns, Drawbar, Live-Stream.
```

## Zentrale Design-Entscheide (nicht ohne Grund ändern)

1. **Sub-Indikatoren (RSI, VOL) laufen als Panes IM Hauptchart** (`createIndicator(create, false, {id:"pane_<key>"})`) — NICHT als separate Chart-Instanzen. Separate Instanzen waren v0.3-Bug: Zeitachsen liefen auseinander.
2. **VRVP ist KEIN KLineCharts-Indikator**, sondern ein transparentes Canvas-Overlay über `#mainChart` (`drawVrvp()` in app.js). Grund: KLC kann keine horizontalen Volume-at-Price-Balken. Neuzeichnen bei Zoom/Scroll via `subscribeAction("onVisibleRangeChange")`. Preis→Pixel via `chart.convertToPixel({value}, {paneId:"candle_pane", absolute:true})`.
3. **Indikator-Styles fliessen über `extendData.plots`** in die figures-styles-Callbacks (Custom-Indikatoren) bzw. über `create.styles.lines[]` (Built-ins EMA/BOLL/RSI). Unsichtbar = Farbe `rgba(0,0,0,0)`.
4. **BMSB rechnet auf Chart-Timeframe mit Close** (20 SMA + 21 EMA) — explizite User-Vorgabe nach Screenshot seiner TV-Einstellungen (Indicator Timeframe: Chart, Source: Close). Die frühere Wochen-Resampling-Version war falsch für seinen Workflow.
5. **Money Noodle** ist eine Übersetzung eines Pine Scripts das der User geliefert hat: EMA 12/21/35, Band = EMA35 ± ATR(20) × 0.0125 × 40. Fast EMA default unsichtbar.
6. **Gaussian Channel:** Ehlers-Filter als Kaskade aus P Ein-Pol-Filtern; beta = (1−cos(2π/N))/(2^(1/P)−1), alpha = −beta+√(beta²+2beta). Mid auf hlc3, Band auf True Range × mult. Params 144/1.414/4. Einschwingphase (~period Bars) wird ausgeblendet.

## User-Kontext (wichtig für Zusammenarbeit)

- Rey ist technisch versiert (Python, Trading-Domäne), aber **Git/PowerShell-Anfänger** — Befehle einzeln und copy-paste-fertig geben, PowerShell-Syntax (kein &&-Chaining in alten PS-Versionen).
- Kommunikation auf Deutsch (de-CH, **ss statt ß**), direkt, keine Weichspüler.
- Wiederkehrender Stolperstein: Beim Entpacken neuer ZIPs wird der `.git`-Ordner zerstört → `git init` + Force-Push nötig. Besser: nur Dateiinhalt ersetzen, `.git` in Ruhe lassen.
- Referenz für alles: seine TradingView-Screenshots. Er will TreydView schrittweise an sein TV-Setup angleichen.

## Roadmap (vom User priorisiert, offen)

1. **Fixed Range Volume Profile** (FRVP) — wie VRVP aber auf gezeichneten Zeitbereich begrenzt; als Custom-Overlay + Canvas-Logik.
2. **Fair Value Gap / Imbalance** — Pattern-Detection (3-Candle-Gaps) + Box-Rendering.
3. **Orderblocks** — letzte Gegenkerze vor Impulsbewegung, Box-Rendering.
4. **Realised Price** — On-Chain-Metrik, braucht neuen Worker-Endpoint `/realizedprice` (z.B. CoinMetrics Community API, KV-Cache analog `/goldhistory`). Worker-Code ist noch NICHT geschrieben.
5. Drawing-UX weiter angleichen (TV-Referenz): Linienstile-Editing bestehender Zeichnungen.

## Bekannte Grenzen

- RVWAP 365d bleibt auf 15m/1h leer (Fenster > geladene Candles) — bewusst.
- Gold nur Daily; andere TFs im Dropdown deaktiviert.
- localStorage-Settings sind pro Browser/Gerät, nicht synchronisiert.
- Kein Persistieren von Zeichnungen über Reload (KLC-Overlays sind flüchtig) — möglicher späterer Ausbau via localStorage-Serialisierung.

## Deploy-Routine

```powershell
cd C:\Users\rey_g\projects\treydview
git add -A
git commit -m "..."
git push
```
GitHub Pages deployt automatisch von main/root. Nach Push ~1 Min warten, hart neu laden (Ctrl+F5) wegen CDN-Cache.
