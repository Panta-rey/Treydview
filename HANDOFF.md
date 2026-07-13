# TreydView — HANDOFF

Übergabe-Dokument für künftige Arbeits-Sessions (Claude-Chat, Claude Code, oder andere Entwickler). Stand: v0.4.1, Juli 2026.

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

## v0.4.1 — kritischer Fix + Feature-Runde

**Freeze-Bug behoben (war der wichtigste):** In v0.4 fror das Chart nach dem Laden ein — kein Scroll/Zoom/Symbolwechsel. Ursache: EMA/BOLL/RSI waren KLineCharts-Built-ins, und das Überschreiben von `create.styles.lines` mit einem Positions-Array kollidierte mit deren internem Renderer (`TypeError: reading '0'` in jedem Draw-Frame). **Lösung:** EMA, BOLL, RSI sind jetzt EIGENE registrierte Indikatoren (in indicators.js, v0.4.1-Block) mit Styling über `extendData.plots` wie alle Custom-Indikatoren. NICHT zu Built-ins zurückwechseln.

Ausserdem in v0.4.1:
- **RSI-Referenzlinien** 20/50/80 als konstante Figures im RSI-Indikator (gestrichelt), Skala fix 0–100 via minValue/maxValue.
- **Eigene einklappbare Legende** (`.chart-legend` in index.html, `updateLegend()` in app.js) statt KLC-Tooltip. Folgt dem Crosshair, Pfeil-Toggle links. KLC-Tooltip ist global auf `showRule:"none"`.
- **Chart-Typ-Dropdown** Kerzen/Linie (`state.chartType`, `candle_solid`/`area`).
- **Screenshot** (`chart.getConvertPictureUrl` → Download) und **Auto-Zoom**-Button oben rechts.
- **VRVP mit rightGap=64px** Abstand zur Preisskala (vorher bündig → Preise unlesbar).
- **Draw-Stil-Popover** (🎨 in Toolbar): Farbe, Deckkraft, Stärke, Linienart; wird als `styles` an `createOverlay` übergeben. Draw-Buttons auf 38px vergrössert.

## OFFEN — Punkt 8: Multi-Asset-Vergleich ("Watch High"-Stil)

User will mehrere Assets überlagert vergleichen (Screenshot: ETH + TAO/AERO/NEAR/HYPE, prozentual normalisiert, je eigene Linie/Farbe). **KLineCharts kann das NICHT nativ.** Umsetzungsplan:
- Custom-Indikator "COMPARE" der N zusätzliche Symbole via Binance lädt.
- Alle Serien prozentual auf gemeinsamen Startpunkt normalisieren ((close/close[0]−1)×100).
- Als überlagerte Linien in einem eigenen Pane mit Prozent-Y-Achse ODER als Overlay im candle_pane mit sekundärer Achse.
- Detailfragen: Timeframe-Alignment zwischen Assets, fehlende Candles (unterschiedliche Listing-Daten), "+"-Button-UI zum Hinzufügen, Farb-Zuweisung, Legende pro Asset, Live-Update aller Streams.
- Aufwand: eigener Durchgang. Nicht nebenbei.

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



## v0.5-Änderungen (wichtig)

- **KRITISCHER BUGFIX (Chart-Freeze):** Ursache war `plotStyle()` in indicators.js — unvollständige Style-Objekte (`{color, size}`) brachten KLineCharts' internen Linien-Merge zum Absturz (`coordinates[1]` undefined → Render-Exception → eingefrorenes Chart, kein Scroll/Zoom/Wechsel). Fix: `plotStyle()` gibt IMMER vollständige Objekte zurück (`style, color, size, smooth, dashedValue`). Regel für die Zukunft: **jeder figure-`styles()`-Callback MUSS ein vollständiges Objekt liefern.** Headless mit jsdom+node-canvas reproduziert (siehe /home/claude/klc-repro, nicht im Repo).
- **Altlast bereinigt:** indicators.js hatte über Sessions einen zweiten IIFE-Block mit `plotStyle2` und custom EMA/BOLL/RSI-Nachbauten angesammelt. Entfernt — EMA/BOLL/RSI nutzen jetzt wieder die nativen KLineCharts-Indikatoren (via `create.styles.lines[]` in buildCreate).
- **Stochastic RSI** neu (STOCHRSI in indicators.js): K/D-Linien blau/orange, gestrichelte Referenzlinien bei 20/50/80 (als konstante figure-Serien), Pine-konform (rsi → stoch → SMA(K) → SMA(D)). RSI 14 bleibt bewusst schlicht ohne Bänder.
- **Eigene einklappbare Legende** (`updateLegend`, `.chart-legend`) ersetzt KLineCharts-Tooltips (die sind auf `showRule:"none"`). Pfeil-Toggle oben links; folgt dem Crosshair (zeigt OHLC unter dem Cursor). Löst das "Beschriftung ragt in den Chart"-Problem.
- **Chart-Typ-Umschalter** (Kerzen/Linie) via `state.chartType` + `chart.setStyles({candle:{type}})`.
- **Screenshot** (`chart.getConvertPictureUrl` → Download) + **Auto-Zoom** (`chart.zoomAtCoordinate`/fitContent) oben rechts.
- **Draw-Stil-Popover:** Farbe, Linienart (solid/dashed), Deckkraft, Stärke — wird auf neue Overlays angewendet (`state.drawStyle`). Zeichentools grösser.
- **VRVP mit Gap:** Balken enden 64px vor der Preisskala (`rightGap`), damit Chart UND Achse lesbar bleiben.

## NOCH OFFEN (vom User gewünscht, NICHT gebaut)

- **Multi-Asset-Vergleich** ("Watch High"): mehrere Symbole auf gemeinsamer Prozent-Basis normalisiert überlagern, mit Farb-Legende + Plus-Button zum Hinzufügen. Grösster offener Posten, architektonisch eigener Block (mehrere Datenserien, Normalisierung). War als v0.6 vorgesehen.

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
