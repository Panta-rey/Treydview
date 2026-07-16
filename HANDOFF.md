# TreydView — HANDOFF

Übergabe-Dokument für künftige Claude-Sessions oder andere Entwickler.
**Stand: Juli 2026**

---

## Projekt-Kontext

TradingView-artiges Chart-Cockpit für Rey Gafner (GitHub: Panta-rey). Rein statische Web-App, kein Build-Step, GitHub Pages.

- **Repo:** github.com/Panta-rey/Treydview
- **Live:** https://panta-rey.github.io/Treydview/
- **Lokal:** `C:\Users\rey_g\projects\treydview` (Windows, PowerShell)
- **Deploy:** `git add -A && git commit -m "..." && git push`, dann Ctrl+F5
- **Engine:** KLineCharts 9.8.12 (CDN, UMD, `window.klinecharts`), Apache 2.0

**Arbeitsweise mit Rey:** Deutsch (de-CH, ss statt ß). Git-Anfänger → Befehle einzeln, copy-paste-fertig. **Nur geänderte Dateien liefern, kein ZIP.** HANDOFF nur auf Anfrage. Sammelt oft mehrere Punkte, bevor gebaut wird. Referenziert TradingView-Screenshots und Pine-Source als Spec. Prozess-orientierter Trader (Zyklus-/Monatsebene, kein Daytrading).

---

## Architektur

```
index.html        Layout, CDN-Tags, Menü-HTML (Overlay, Chart-Stil)
css/style.css     Terminal-Theme (dark + light via [data-theme]), Gold #e8b64c, IBM Plex Mono
js/config.js      CONFIG: Worker-URL, Symbole, TFs, INDICATORS-Registry
                  (inputs+plots-Schema), DRAW_TOOLS, THEME, hexToRgba() (global)
js/indicators.js  Custom-Indikatoren via registerIndicator (IIFE)
js/overlays.js    Custom-Zeichenwerkzeuge via registerOverlay (IIFE)
js/data.js        DataLayer: Binance REST/WS + Pagination + Gold + Watchlist-Ticker
js/settings.js    Settings-Modal: Inputs/Style-Tabs, select-Support, localStorage "tv4_ind_<key>"
js/app.js         Haupt-IIFE: Chart-Init, State, UI, Canvas-Systeme
```

---

## KRITISCHES WISSEN — vor Änderungen lesen

### 1. dashedValue-Crash (Chart-Freeze)
`Cannot read properties of undefined (reading '0')` → Chart friert ein. KLineCharts liest intern `styles.dashedValue[0]` beim Linien-Merge.

**Regel: JEDER `styles()`-Callback und jeder `lineStyle`-Block MUSS vollständige Objekte liefern:**
```js
{ style: "solid", color: "...", size: 1, smooth: false, dashedValue: [2, 2] }
```
`plotStyle()` in indicators.js enthält den Fix. **Headless jsdom kann diesen Crash NICHT reproduzieren** — nur echter Browser. Bei Freeze: User um Konsolenzeile (F12) bitten.

### 2. indicatorData-Zugriff
KLineCharts übergibt Werte im styles-Callback als:
```js
data.current.indicatorData.<key>    // RICHTIG
data.current.<key>                  // FALSCH — immer undefined
```
Falscher Zugriff → Wert undefined → MACD-Histogramm transparent, Hull-Trendfarbe immer rot. Betraf mal 7 Stellen, alle gefixt.

### 3. bar-Figures brauchen style:"fill"
`plotStyle()` liefert `style:"solid"` — für `type:"bar"`-Figures (VOL, MACD-Histogramm) unsichtbar. Diese brauchen `style:"fill"` in einem eigenen Callback.

### 4. Python-Regex-Replace-Fallen (MEHRFACH PASSIERT)
Vier Bugs entstanden, weil Replaces nicht griffen und **nicht verifiziert wurden**:
- config.js hatte EMA/RSI/VOL lange auf Ur-Stand (`name:"RSI"` statt `"MYRSI"` → lud built-in statt custom)
- doppelter `onVisibleRangeChange`-Handler → IIFE schloss zu früh → `state is not defined`
- `syncLabels` wurde beim Bar-Replay-Entfernen mitgelöscht → `syncLabels is not defined`

**Regel: nach jedem Replace verifizieren** — Klammerbilanz, `name:`-Felder, und den DOM-Test laufen lassen (siehe unten).

### 5. DOM-Test vor jeder Auslieferung
`/home/claude/klc-repro/realdom.js` lädt die **echte index.html**, führt alle Skripte in Reihenfolge aus und klickt die UI durch. Fängt: fehlende Funktionen, null-Referenzen, kaputte Handler. Mocks nötig für: ResizeObserver, getComputedStyle, WebSocket, fetch.

---

## KLineCharts-API-Erkenntnisse

- Sub-Indikatoren als PANES: `createIndicator(create, false, {id:"pane_<key>"})`
- `draw:`-Callback: `{ctx, kLineDataList, visibleRange, indicator, xAxis, yAxis}` — nutzt `indicator.result`, `xAxis/yAxis.convertToPixel()`. Für Band-Fills.
- `chart.convertToPixel({value},{paneId,absolute:true})` bzw. `{dataIndex:i}`
- `chart.getSize("candle_pane")` → `{top,height}` (Canvas-Clip)
- `chart.getVisibleRange()` → `{from,to,realFrom,realTo}`
- `chart.setLoadDataCallback(({type,data,callback})=>...)` für Lazy Loading (type "forward" = ältere). `applyMoreData` ist deprecated.
- **Y-Achse vertikal draggen:** geht nur wenn `autoCalcTickFlag === false`. Beim Start ist es `true` → blockiert. Fix: `chart.getDrawPaneById("candle_pane").getAxisComponent().setRange(yAxis.getRange())` übernimmt den Auto-Range als manuellen → Draggen frei. Siehe `unlockYAxis()` / `autoScaleY()` in app.js. **Interne API** — bei Versionswechsel prüfen.
- Overlay `onRightClick` existiert; `needDefaultPointFigure:false` verhindert Auto-Rechteck
- Overlay-APIs auf der Chart-Instanz: `createOverlay`, `getOverlayById`, `overrideOverlay`, `removeOverlay`, `updateOverlay`. **`getOverlays()` existiert NICHT**; `getCompleteOverlays()` liegt auf dem OverlayStore (`chart.getOverlayStore()`), nicht auf dem Chart. Relevant für Zeichnungs-Persistenz.
- `chart.createOverlay({name, points, lock, extendData})` erzeugt Overlays programmatisch. `lock:true` verhindert versehentliches Verschieben.
- `setPaneOptions` braucht `axisOptions:{name:"percentage"}`, nicht `axis:` (silent-ignore)

---

## Custom-Canvas-Systeme (app.js, über #mainChart)

Transparente Canvas-Overlays, redraw bei onVisibleRangeChange + Live + Resize.

**VRVP** (`drawVrvp()`, `computeVrvpMeta()`): **REAKTIV** — aggregiert nur sichtbare Kerzen (via getVisibleRange-slice). POC/VAH/VAL-Linien entfernt. rightGap=96px, Clip auf candle_pane.

**Compare** (`drawCompare()`): Vollständiger Relative-Performance-Modus, zeichnet alle Linien selbst. Kerzen unsichtbar (candle.type="area", transparent), KLC-yAxis transparent, eigene %-Achse rechts. `fromIdx=realFrom` = erster sichtbarer Bar = 0%-Referenz für ALLE Assets. Auto-Scaling: min/max +5% Padding. Reaktiv → neuer Referenzpunkt bei jedem Scroll. Formel: `(kurs-ref)/ref*100`. COMPARE-Indikator in indicators.js ist DEPRECATED.

---

## Indikator-Inventar (14)

**Main-Pane:** MYSMA (20/50/100/200), EMA (custom, 21/50/100/200), MNOODLE (EMA12/21/35 + ATR-Band, Fill via draw), BMSB (20SMA+21EMA, Fill), BOLL (Length/StdDev/MA-Typ/Offset, Fill), GC (Gaussian Channel 144/1.414/4, trendgefärbt), HULL (HMA/EHMA/THMA + lengthMult, MHULL + SHULL=HULL[2], Trendfarbe grün wenn HULL>HULL[2], Band-Fill), RVWAP (365d)

**Sub-Panes:** MYRSI (Wilder RMA, Hilfslinien 30/50/70, Fills, Smoothing-MA None/SMA/SMA+BB/EMA/SMMA/WMA/VWMA), STOCHRSI (K/D + 20/50/80), MYVOL (MA-Längen konfigurierbar, bar style:"fill"), MACD (12/26/9, 4-Farb-Histogramm), ATR (14, RMA/SMA/EMA/WMA)

**Mathe-Helfer:** rmaSeries (Wilder), wmaSeries, vwmaSeries, smaSeries2, maByType, trSeries, emaSeries

**DEFAULT_ACTIVE:** mnoodle, bmsb, ema, myrsi, myvol

---

## Zeichenwerkzeuge

**Drawbar-UI:** 5 Kategorie-Dropdowns mit SVG-Icons (36px Buttons, 20px Icons): Linien, Zonen&Profile, Fibonacci, Messwerkzeuge, Annotationen. **Fly-Out via `position:fixed`** — JS berechnet Viewport-Koordinaten aus `getBoundingClientRect`, weil `overflow-y:auto` auf der Sidebar sonst clippt (CSS-Spec: overflow-y≠visible ⇒ overflow-x wird auto).

**Rechtsklick:** FRVP → `openFrvpMenu()` (volles Panel), alle anderen → `openOverlayMenu()` (nur Löschen). ESC/Entf-Keyboard.

**FRVP** (overlays.js, `needDefaultPointFigure:false`): transparente Hitbox, VAH/VAL durchgezogen orange, POC gestrichelt weiss, über ganzen Zeitbereich. Candle-Daten via `window.__tvGetDataList`.

**Fibonacci** (overlays.js): `fibRetracement` (2 Punkte) und `fibExtension` (3 Punkte, Projektion A→B ab C). TradingView-Levels (0/0.236/0.382/0.5/0.618/0.786/1/1.618/2.618/3.618/4.236). Preis-Labels links im Format `0.618 (96'131.42)`. Flächenfüllung bei **5% Deckkraft** (dezent, auf Wunsch). Gemeinsame Helfer: `FIB_LEVELS`, `FIB_EXT_LEVELS`, `buildFibFigures()`, `hexA()`.

---

## Weitere Systeme

**Watchlist:** Panel rechts, Auge-Icon in Topbar. Live-Preise via `openMiniTickerStream` (ein WS `!miniTicker@arr` für alle Symbole). 24h-Änderung farbig. Klick → `switchSymbol()` (zentrale Funktion). Persistent.

**Theme:** Mond/Sonne-Button, `data-theme="light"|"dark"` CSS-Variablen, `applyTheme()` zieht Chart-Theme nach. Persistent.

**Layouts:** Button oben rechts (4 Quadrate), localStorage `"tv_layouts"`. Name → speichern, Klick → laden, einzeln löschbar. Snapshot: symbol/tf/active/chartType/legend/watchlist/theme/chartStyle.

**Chart-Stil-Menü:** Zahnrad pro Chart-Typ im typeDropdown. Kerzen: Up/Down-Farbe + Hohl-Option. Linie: Farbe/Stärke/Fläche/Deckkraft. `baseStyles()` nutzt `state.chartStyle`.

**Historie + Lazy Loading:** CANDLE_LIMIT 5000 (Pagination, Binance max 1000/Request). Lazy Loading via `chart.setLoadDataCallback`. **Verfügbarkeit:** BTC ab Aug 2017 → 1D ~3250, 4h ~19700, 1h ~78800. 40k nur ab 1h abwärts. Performance-Engpass: RVWAP/GC sind O(n×period).

**Touch:** Pinch-to-Zoom (2 Finger) in `initTouch()`.

**syncLabels():** setzt Asset/TF/Typ-Labels beim Start aus dem State. Nötig, weil die HTML-Labels statische Defaults sind.

---

## Pattern-Erkennung (js/patterns.js) — Etappe 1

Eigenständiges Modul, exportiert `window.PatternEngine`. Auch in Node testbar (`module.exports`).

**Schichten:**
1. `findPivots(data, lookback)` — ZigZag-Pivots: Kerze, deren High/Low höher/tiefer als alle im Fenster beidseits ist
2. `alternate(pivots)` — erzwingt H-L-H-L-Kette; bei zwei gleichartigen gewinnt der extremere (ohne das entsteht aus Rauschen Unsinn)
3. `detectDoubleTop()` / `detectDoubleBottom()` — Muster auf der Pivot-Sequenz
4. `PatternEngine.scan(data, range, opts)` — Einstiegspunkt, rechnet Indizes auf den vollen Datensatz zurück

**Erkennungslogik Double Top:** P1(H) – P2(L) – P3(H), wobei P1≈P3 (`tolerance` %), P2 deutlich tiefer (`minDepth` %), Abstand P1→P3 zwischen `minSpan` und `maxSpan`. Bestätigung = Close unter Neckline (P2) nach P3. Kursziel = Neckline − Musterhöhe.

**NULLMODELL-BEFUND (wichtig!):** Getestet auf 20× 500 Bars Zufallsrauschen mit BTC-artiger Volatilität:

| Konfiguration | Fehlalarme / 500 Bars | höchste Qualität im Rauschen |
|---|---|---|
| lookback 4, tol 3.0, depth 2.0 | 11.3 | 1.00 |
| lookback 5, tol 2.0, depth 3.0 | 8.3 | 1.00 |
| lookback 7, tol 1.5, depth 5.0 | 4.5 | 0.96 |
| **lookback 9, tol 1.0, depth 7.0, minQ 0.7** | **0.5** | 0.85 |

Die lockeren Einstellungen finden im reinen Rauschen Muster mit Qualität 1.00. Deshalb sind die strengen Werte `DEFAULTS` in patterns.js. Die UI-Presets "mittel"/"locker" zeigen eine Warnung.

**Rendering:** `scanPatterns()` in app.js scannt den sichtbaren Bereich, erzeugt pro Muster ein `pattern`-Overlay (overlays.js) mit `lock:true`. IDs in `state.patternOverlayIds`. Per Rechtsklick einzeln löschbar (nutzt das bestehende `openOverlayMenu`). Gezeichnet werden: Pivot-Verbindung, gestrichelte Neckline, Punktmarkierungen, Bestätigungspunkt, Label mit Qualität in %.

**UI:** Dropdown in der Topbar (Zickzack-Icon) mit Strenge-Auswahl, Scannen- und Löschen-Button.

**Nächste Etappen (nicht gebaut):**
- Triple Top/Bottom, Head & Shoulders + Inverse — gleiche Pivot-Basis, direkt machbar
- Wedges, Triangle, Rectangle, Flags, Pennants — brauchen lineare Regression auf Pivot-Hochs/-Tiefs + Konvergenz-Prüfung
- Cup & Handle — Rundungserkennung, keine saubere mathematische Definition, nur Heuristik
- **Vor jeder Erweiterung: Nullmodell-Test wiederholen.** Ein Muster, das im Rauschen genauso häufig auftritt wie auf echten Daten, ist wertlos.

---

## Bekannte Grenzen / offene Roadmap
- **Zeichnungen nicht persistiert** — `chart.getOverlays()` → localStorage wäre möglich
- **FRVP "Extend Right"** fehlt
- **Anchored VWAP** — in Drawbar als Icon, nicht implementiert
- **Imbalance/FVG, Orderblocks** — nicht gebaut
- **Realised Price** — braucht Worker-Endpoint `/realizedprice` (CoinMetrics)
- **%-Suffix auf Compare-Y-Achse** — KLC hat keinen Value-Formatter; eigene Canvas-Beschriftung als Workaround
- **Order-Book Wall-Detector** — bewusst ABGELEHNT (Juli 2026). Cross-Exchange-Aggregation braucht Backend; Single-Exchange-Walls sind per Definition unzuverlässig; Zeitebene (Sekunden) passt nicht zu Reys Zyklus-Prozess. VRVP ist für seine Ebene das robustere Werkzeug (realisiertes vs. behauptetes Volumen).

## Config-Notizen

- `WORKER_BASE_URL` in config.js ist Platzhalter — echte Cloudflare-Worker-URL wird bei Datei-Ersetzung überschrieben, muss neu gesetzt werden
- Gold (XAU/USD): Worker `/goldhistory`, nur Daily. `normalizeGoldRow()` tolerant (JSON-Arrays, Wrapper, Stooq-CSV). Braucht CORS.
