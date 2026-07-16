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
js/config.js      CONFIG: Worker-URL, Symbole, TFs, INDICATORS-Registry,
                  DRAW_TOOLS, FIB_LEVEL_SETS (einzige Fib-Quelle), hexToRgba()
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

**Fibonacci** (overlays.js): `fibRetracement` (2 Punkte) und `fibExtension` (3 Punkte, Projektion A→B ab C). TradingView-Levels (0/0.236/0.382/0.5/0.618/0.786/1/1.618/2.618/3.618/4.236). Gemeinsame Helfer: `FIB_LEVELS`, `FIB_EXT_LEVELS`, `buildFibFigures()`, `hexA()`, `labelColors()`.

Labels sind **Chips mit Hintergrund** — `drawText` in KLC unterstützt `styles.backgroundColor` + `paddingLeft/Right/Top/Bottom` + `borderRadius`, gezeichnet via internem `drawRect`. Ohne Chip ist farbiger Text auf farbiger Füllung unlesbar. `labelColors()` liest `data-theme` und liefert passenden Chip-Hintergrund.

**Fib-Einstellungen:** Rechtsklick auf ein Fib-Overlay → `window.__tvOpenFibMenu` (Hook in app.js, `openFibMenu()`). Panel: Beschriftung (Level/Preis einzeln), Flächenfüllung + Deckkraft-Regler, Linienstärke, nach rechts verlängern, jedes Level einzeln an/abwählbar. Speichert via `chart.overrideOverlay({id, extendData})`. Optionen in extendData: `showLabels`, `showLevels`, `showPrices`, `showFill`, `fillOpacity`, `lineWidth`, `extendRight`, `hiddenLevels: {"0.236": true}`.

**Level-Quelle:** `FIB_LEVEL_SETS` in config.js. overlays.js (Zeichnen) und app.js (Menü) referenzieren sie beide — vorher standen zwei Kopien in beiden Dateien.

---

## Weitere Systeme

**Watchlist:** Panel rechts, Auge-Icon in Topbar. Live-Preise via `openMiniTickerStream` (ein WS `!miniTicker@arr` für alle Symbole). 24h-Änderung farbig. Klick → `switchSymbol()` (zentrale Funktion). Persistent.

**Theme:** Mond/Sonne-Button, `data-theme="light"|"dark"` CSS-Variablen, `applyTheme()` zieht Chart-Theme nach. Persistent.

**Achtung bei Light-Mode:** Hartcodierte Hintergründe wie `rgba(20,26,35,.85)` brechen im Hell-Modus (dunkler Text auf dunklem Grund). Betraf `.legend-toggle` und `.legend-body` — beide haben jetzt gar keinen Hintergrund mehr. Bei neuen Elementen immer CSS-Variablen nutzen, nie feste Farben.

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

**Erkannte Muster (6):**

| Muster | Pivots | Logik |
|---|---|---|
| Double Top/Bottom | 3 | P1≈P3 (`tolerance`%), P2 tiefer/höher (`minDepth`%) |
| Triple Top/Bottom | 5 | drei Extrema ≈ gleich hoch, zwei ähnliche Täler (Diff < `tolerance`×2.5) |
| Head & Shoulders | 5 | Kopf überragt beide Schultern (`minHeadPct`%), Schultern ≈ gleich (`shoulderTol`%), **schräge Neckline** durch P2/P4 |
| Inverse H&S | 5 | analog gespiegelt |

Bestätigung = Close jenseits der Neckline nach dem letzten Pivot. Kursziel = Neckline ∓ Musterhöhe. Bei H&S wird die Neckline als Gerade interpoliert (`necklineSlope`), Steigung auf `shoulderTol`×2 begrenzt.

`dedupe()` gewichtet nach Komplexität (H&S 3 > Triple 2 > Double 1), damit bei Überlappung das aussagekräftigere Muster gewinnt — ein H&S enthält strukturell oft ein Double Top.

**NULLMODELL-BEFUND (wichtig!):** 30× 500 Bars Zufallsrauschen mit BTC-artiger Volatilität, alle 6 Muster:

| Preset | Fehlalarme / 500 Bars | max. Qualität im Rauschen |
|---|---|---|
| locker (lookback 5, tol 2.0, depth 3.0) | 6.1 | 0.98 |
| mittel (lookback 7, tol 1.5, depth 5.0) | 2.4 | 0.99 |
| **streng = DEFAULTS (lookback 9, tol 1.0, depth 7.0, minQ 0.7)** | **0.6** | 0.88 |

Aufschlüsselung bei "streng": Double Top 0.33/Lauf, Inverse H&S 0.17, Double Bottom 0.07 — **Triple Top/Bottom und H&S kommen gar nicht vor.** Die Triple-Muster sind also deutlich selektiver als Double-Muster; ein Triple Top ist ein stärkeres Signal als ein Double Top.

Bei lockeren Einstellungen findet die Engine im reinen Rauschen Muster mit Qualität ~1.00. Deshalb sind die strengen Werte Default; die Presets "mittel"/"locker" zeigen eine Warnung in der UI.

**Rendering:** `scanPatterns()` in app.js scannt den sichtbaren Bereich, erzeugt pro Muster ein `pattern`-Overlay (overlays.js) mit `lock:true`. IDs in `state.patternOverlayIds`. Per Rechtsklick einzeln löschbar. Das Overlay verarbeitet 3- und 5-Punkt-Muster; der letzte Punkt ist der Bestätigungspunkt, `extendData.pivotCount` unterscheidet. `slantedNeckline:true` → Neckline wird durch P2/P4 interpoliert (H&S), sonst waagrecht. `hasHead:true` → Kopf grösser markiert.

**UI:** Dropdown in der Topbar (Zickzack-Icon): Strenge-Preset, sechs Muster einzeln an/abwählbar, Scannen- und Löschen-Button.

**Messfunktionen (Council-Ergebnis, für Ausführung mit echten Daten):**
- `PatternEngine.backtest(data, opts)` → `{n, hitRate, avgR, totalR, byType, rows}`. Einstieg am Bestätigungs-Bar, Stop hinter dem letzten Extrempunkt, Ziel = Neckline ∓ Höhe, Ergebnis in R. Konservativ: trifft eine Kerze Stop und Ziel, zählt der Stop. `avgR` ist die Expectancy.
- `PatternEngine.backtestVsNull(data, opts, runs, blockLen)` → block-permutierte Vergleichsläufe (behalten Vola-Clustering, zerstören Musterstruktur). `pValue` = Anteil der Zufallsläufe, die mindestens so gut waren. < 0.05 heisst: echte Daten deutlich besser als Zufall.
- `PatternEngine.thresholdFrequency(series, threshold, dir)` → `{pct, hits, quantiles}`. Misst, wie oft eine Schwelle feuert, ohne zu optimieren.

**In der Browser-Konsole:**
```js
PatternEngine.backtest(chart.getDataList())
PatternEngine.backtestVsNull(chart.getDataList(), {}, 20)
```

**GARCH-Nullmodell-Nachtrag:** Der Einwand, konstante Volatilität sei zu freundlich, wurde geprüft. GARCH(1,1) mit Vola-Clustering (ACF|r| = 0.198) und Fat Tails (Kurtosis 3.81) produziert **nicht mehr** Fehlalarme (0.38 statt 0.48 bei "streng"). Grund: Die Erkennung arbeitet mit relativen Preisdifferenzen; Vola-Cluster ändern die Häufigkeit von "zwei Tops auf ähnlicher Höhe" nicht systematisch. Die Defaults sind robuster als vermutet.

**Nächste Etappen (nicht gebaut):**
- Wedges, Triangle, Rectangle, Flags, Pennants — brauchen lineare Regression auf Pivot-Hochs/-Tiefs + Konvergenz-/Divergenz-Prüfung
- Cup & Handle — Rundungserkennung, keine saubere mathematische Definition, nur Heuristik
- **Vor jeder Erweiterung: Nullmodell-Test wiederholen.** Ein Muster, das im Rauschen genauso häufig auftritt wie auf echten Daten, ist wertlos.


---

## Grid Bot (js/derivatives.js + js/gridbot.js)

Portierung von `Cockpit.xlsx`. Das Excel bleibt die lesbare Referenz; jede Funktion in gridbot.js nennt ihre Zellbezüge im Kommentar.

### Datenschicht (derivatives.js)

Vier öffentliche Endpoints, alle mit `Access-Control-Allow-Origin: *` — kein Worker nötig:

| Feld | Endpoint |
|---|---|
| Funding 8h/täglich/monatlich/Ø30/Ø90 | `fapi.binance.com/fapi/v1/fundingRate?limit=270` |
| OI + Δ30T/Δ90T | `fapi.binance.com/futures/data/openInterestHist?period=1d&limit=90` |
| L/S Account Ratio | `fapi.binance.com/futures/data/globalLongShortAccountRatio` |
| Fear & Greed + Ø30/Ø90 | `api.alternative.me/fng/?limit=90` |

`fetchAll()` nutzt `Promise.allSettled` — einzelne Ausfälle reissen den Rest nicht mit, fehlende Blöcke kommen als `null` zurück und das Panel zeigt "–". Cache 5 Minuten (diese Werte ändern sich stündlich bis täglich; ohne Cache vier Requests pro Redraw).

**Binance zahlt Funding alle 8h** → täglich = 8h-Rate × 3, monatlich × 90. Genau wie im Cockpit.

### Logik (gridbot.js)

```
trendScore     = (Preis>SMA50 ? +1 : -1) + (Preis>SMA200 ? +1 : -1)      [E4]
oiInterpretation(oiΔ30, L/S)                                             [E22]
derivativeScore = Funding-Term + OI/LS-Term                              [E5]
extremeFilter(RSI, F&G) -> "Überverkauft" | "Überkauft" | "—"            [E6]
computeBias -> raw (E7) und final (B5, Filter sticht den Bias)
computeTier -> LP/UP/Hebel/Grids/SL/TP/Size/Liq-Check                    [B37-B46]
```

**Der Extremfilter ist der Kern:** Er überschreibt den Bias auf Neutral, egal was die Konfluenz sagt. Kein Short in die Kapitulation, kein Long in die Euphorie.

**Reihenfolge in computeTier ist die eigentliche Logik:** Range aus ATR → Hebel aus Range (`1/Breite`, gedeckelt) → Stop aus ATR → Size aus Risiko und Stop-Distanz. Der Hebel ist eine Folge der Grid-Breite, nicht eine freie Wahl. Die Grösse folgt aus dem Risiko, nicht umgekehrt.

**VERIFIZIERT:** Gegen die Werte aus Cockpit.xlsx getestet — Headline, Bias, Trend-Score (−2), Derivat-Score (+1), Extremfilter (Überverkauft) und alle drei Tiers stimmen exakt (Makro: LP 45'213, UP 76'557, 2×, 25 Grids, SL 44'155, Size 291).

### Schwellwerte

`DEFAULT_THRESHOLDS` in gridbot.js, im Panel unter "Einstellungen" editierbar, persistent in `state.gbThresholds`.

| Schwelle | Wert | Einschätzung |
|---|---|---|
| RSI 25/75 | enger als Standard 30/70 | bewusst gesetzt |
| F&G 15/85 | enger als üblich 20/80 | bewusst gesetzt |
| Funding −0.01/+0.05 | asymmetrisch, Faktor 5 | verteidigbar: BTC-Funding ist historisch überwiegend positiv, negatives Funding ist das seltenere und aussagekräftigere Signal |
| OI ±10 | runde Zahl | Kandidat für Häufigkeitsprüfung |
| L/S 0.45/0.55 | symmetrisch um 0.5 | Kandidat für Häufigkeitsprüfung |

**Nicht optimieren, messen.** `PatternEngine.thresholdFrequency(series, threshold, dir)` gibt Häufigkeit + Quantile. Wenn RSI≤25 an 3% der Bars gilt, ist es ein echtes Extrem; bei 18% ist es Normalbetrieb und der Filter blockiert grundlos. Optimieren auf Rendite wäre die Metronom-Falle (`compression=0.70`).

### Marktdaten

`gbMarketData()` in app.js rechnet Preis, SMA50/200, RSI14 (Wilder) und ATR14/90/200 selbst aus `chart.getDataList()` — **nicht** aus den Indikator-Instanzen. Grund: die existieren nur, wenn der User sie aktiviert hat. Der Grid Bot muss auch ohne aktiven ATR200 funktionieren. Braucht 200+ Kerzen.

### UI

Roboter-Icon in der Topbar. Zweistufig: kollabierte Statuszeile (Bias-Pill, Regime, RSI, Funding, F&G) ↔ aufgeklappt mit drei Tabs (Strategie / Daten / Einstellungen). Zustand persistent.

**Layout:** Die Leiste ist ein **Flex-Kind in `.chart-col`**, kein `position:absolute`. Dadurch grenzt sie links an die Drawbar und rechts an die Watchlist an, statt darüberzuliegen; der Chart schrumpft entsprechend. Höhe per Handle (`#gbResize`, ns-resize) verstellbar, persistent in `state.gbHeight`. Der Handle ist nur sichtbar, wenn die Leiste offen und nicht kollabiert ist.

**Tabellen-Layout:** `.gb-table` hat `width:auto`, **nicht** `100%`. Bei voller Breite zieht der Browser die Spalten auseinander und Bezeichnung und Wert verlieren den Zusammenhang. Zusätzlich: Zeilentrenner (`rgba(128,140,155,.09)`), Hover-Highlight, und Gruppenzeilen (Konfiguration / Grid / Ausstieg / Kapital) statt einer langen Liste. Alle drei Tabs nutzen 12px — vorher waren Daten und Einstellungen auf 11px.

**Die Grid-Bänder im Chart überleben das Schliessen der Leiste** — bewusst: sonst müsste man sie offen halten, nur um die Visualisierung zu sehen, und das hebelt den Zweck des Wegklappens aus.

Overlay `gridBands` (overlays.js): Range-Fläche, Grid-Linien (max. 60 gezeichnet, darüber nur noch Grau), LP/UP-Chips, gestrichelte SL-Linie, Tier-Label.

### Long / Short Position

Overlay `positionTool`, **Zeichenwerkzeug mit eigenem Button in der Drawbar** (`#posToolBtn`, direkt unter dem Stil-Wähler) — bewusst kein Untermenü. Es liefert Stop und Positionsgrösse, also die Zahlen, um die es beim Handeln geht; ein Dropdown davor wäre eine Hürde an der falschen Stelle. Zweiter Klick auf den Button bricht ab (gleiche Logik wie der ESC-Handler). Drei Klicks: Einstieg, Stop, Ziel → Risiko-/Gewinnzone, CRV, Positionsgrösse.

**Gemeinsame Sizing-Quelle:** `window.__tvSizing()` liest die Felder Kapital/Risiko% aus dem Grid-Bot-Panel. Eine Quelle, zwei Konsumenten — sonst hat man das Kapital an zwei Orten und irgendwann divergieren sie.

### Bewusst NICHT übernommen

- **Journal** — Excel ist dafür besser (Sortieren, Filtern, Pivot, Export). Eine localStorage-Kopie wäre schlechter.
- **Formeltransparenz** — im Excel nachschaubar. Deshalb sind aber alle Parameter (Faktor, Ziel-Profit, Hebel-Cap, alle 11 Schwellwerte) im Panel editierbar statt im Code vergraben.

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
