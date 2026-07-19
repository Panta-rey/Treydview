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

- **`chart.getOverlayStore()` EXISTIERT NICHT** in 9.8.12 — Versuche laufen still in den catch-Block. `chart.removeOverlay()` OHNE Argument löscht ALLE Overlays (so macht es `clearAllDrawings`).
- **Cursor:** KLineCharts setzt `cursor:crosshair` als Inline-Style auf einen inneren Container. Style auf `#mainChart` verliert immer → CSS-Klasse mit `!important` (`#mainChart.cursor-pointer *{cursor:pointer!important}`).
- **`setScrollEnabled(false)` / `setZoomEnabled(false)`** existieren — nötig für Freihand, sonst pannt der Chart statt zu zeichnen. Zusätzlich `capture:true` beim eigenen mousedown-Handler.
- **`lastValueMark.text.color` (Preis-Beschriftung an der Y-Achse) ist NUR GLOBAL setzbar, NICHT pro Indikator.** Das war zwei Runden lang falsch verstanden. Der Renderer im Bundle:
  ```
  var defaultStyles = chartStore.getStyles().indicator;   // GLOBAL
  var lastValueMarkTextStyles = defaultStyles.lastValueMark.text;
  ...
  styles: __assign({}, lastValueMarkTextStyles, { backgroundColor: figureStyles.color })
  ```
  Der Hintergrund kommt pro Linie aus der Linienfarbe, der Text aus EINER globalen Einstellung. `create.styles.lastValueMark` am Indikator wird **stillschweigend ignoriert**. Konsequenz:
  - Textfarbe GLOBAL in `applyTheme()` gesetzt: `lastValueMark.text.color = "#0d1117"` (dunkel), `size: 12`.
  - Damit umgekehrt: JEDE Linienfarbe in config.js muss gegen den dunklen Text Kontrast ≥ 4.5 haben. Gemessen über alle 54 Linienfarben: mit weissem Text scheitern 49, mit dunklem nur 8. Die 8 zu dunklen wurden aufgehellt (#7e57c2→#a98fdb, #787b86→#9aa3b0, #2962ff→#5a8dff, #b71c1c→#e05555).
  - `textForLines()` / `textOn()` / `contrastRatio()` bleiben in config.js als Helfer (WCAG-Luminanz, Schwelle 0.42), werden aber für lastValueMark NICHT mehr gebraucht. Kommentar in config.js dokumentiert die Kontrast-Pflicht neu.
  - **Vor dem Hinzufügen einer neuen Linienfarbe:** Kontrast gegen #0d1117 prüfen, sonst wird das Preis-Label unlesbar.
- **Zoom-Grenze:** `BarSpaceLimitConstants = {MIN:1, MAX:50}`. Im minified Bundle als `var St=1,Ct=50` — **der Minifier benennt um**. Auf `St=0.2` gepatcht → 4697/5000 Kerzen sichtbar statt 1200. `setBarSpace(<MIN)` wird sonst kommentarlos ignoriert.
- **Overlay-Daten auslesbar:** `chart.getOverlayById(id)` liefert `{name, points:[{timestamp,value}], extendData, styles}`. Punkte via `createOverlay` mit denselben `{timestamp,value}` exakt wiederherstellbar (gegen echte API verifiziert). Basis für Zeichnungs-Persistenz.
- **`onRemoved`-Callback im Overlay feuert** bei `removeOverlay(id)` — nötig, um das eigene Zeichnungs-Register sauber zu halten (sonst verwaisen Einträge).
- **Rechtsklick-Menüs:** KLineCharts-Klickkoordinaten (`event.pointerCoordinate` / `event.x`) sind **chart-relativ**. Menüs mit `position:fixed` brauchen den Container-Offset (`getBoundingClientRect().left/top`), sonst systematischer Versatz. Zentral in `menuPosition(event, menuW, menuH)` in app.js — von Overlay-Menü UND FRVP-Menü genutzt. Häufige Fehlerquelle war zusätzlich der Aufruf mit falscher Argumentzahl (`openOverlayMenu(e)` statt `openOverlayMenu(e.overlay, e)`).

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

**Layouts:** Button oben rechts (4 Quadrate), localStorage `"tv_layouts"`. Name → speichern, Klick → laden, einzeln löschbar. Snapshot: symbol/tf/active/chartType/legend/watchlist/theme/chartStyle/**drawings**.

**Zeichnungs-Persistenz (eigenes Register, weil getOverlayStore fehlt):**
- `SAVED_OVERLAYS`-Set listet die Overlay-Typen, die gespeichert werden (Zeichenwerkzeuge, Fib, FRVP, Freihand, positionTool). NICHT dabei: gridBands, pattern, channelPattern — die erzeugen ihre Module selbst neu.
- `registerDrawing()` bei jedem fertigen Overlay (via `captureDrawing()` nach `onDrawEnd`, das die echten Punkte aus `getOverlayById` holt — 30 ms Delay, sonst sind die Punkte noch leer).
- `unregisterDrawing()` im `onRemoved`-Handler jedes Overlays.
- `state.drawings` wandert in Workspace UND Layout-Snapshot (ohne `id`, die vergibt KLineCharts neu).
- `restoreDrawings()` baut sie neu auf.
- **KRITISCHER TIMING-FIX:** `applyNamedLayout` ist jetzt `async` und macht `await loadData()` VOR `restoreDrawings()`. Vorher lief `loadData()` (async) ohne await, gefolgt von `setTimeout(220)`. Dauerte der Netzwerk-Fetch länger als 220 ms, wurden Zeichnungen auf der Zeitachse des VORHERIGEN Assets platziert und sprangen dann. Ursache für „Linien verlaufen beim Laden woanders".

**Preis-Markierungen (chartStyle-Menü):** Sektion `csmPriceSection` gilt für Kerzen UND Linie. Steuert `priceMark.last` (Preislinie an/aus, Preis-Label an/aus + Grösse) und `priceMark.high/low` (lokale Hochs/Tiefs im Sichtbereich, an/aus + Grösse). State-Felder in chartStyle: `lastLine/lastText/lastSize/hiLoShow/hiLoSize`, mit Migrations-Fallback für bestehende Workspaces. **Rechtsklick nahe der aktuellen Preislinie** (±10px in Y, via `convertToPixel`) öffnet das chartStyle-Menü direkt. priceMark-Linienfarbe folgt zwingend `up/downColor` — nicht separat setzbar.

**Chart-Stil-Menü:** Zahnrad pro Chart-Typ im typeDropdown. Kerzen: Up/Down-Farbe + Hohl-Option. Linie: Farbe/Stärke/Fläche/Deckkraft. `baseStyles()` nutzt `state.chartStyle`.

**Historie + Lazy Loading:** CANDLE_LIMIT 5000 (Pagination, Binance max 1000/Request). Lazy Loading via `chart.setLoadDataCallback`. **Verfügbarkeit:** BTC ab Aug 2017 → 1D ~3250, 4h ~19700, 1h ~78800. 40k nur ab 1h abwärts. Performance-Engpass: RVWAP/GC sind O(n×period).

**Touch:** Pinch-to-Zoom (2 Finger) in `initTouch()`.

**syncLabels():** setzt Asset/TF/Typ-Labels beim Start aus dem State. Nötig, weil die HTML-Labels statische Defaults sind.

---

## Pattern-Erkennung (js/patterns.js) — 16 Muster, drei Familien

### Familie 1: Pivot-Muster
`findPivots()` (ZigZag) → `alternate()` (H-L-H-L) → Detektoren. Vergleichen einzelne Pivots.
Double Top/Bottom (3 Pivots), Triple Top/Bottom (5), Head & Shoulders + Inverse (5, schräge Neckline durch P2/P4).

### Familie 2: Trendlinien-Muster
Brauchen eine **Gerade durch mehrere Hochs** und eine durch mehrere Tiefs — erst deren Verhältnis definiert das Muster.
- `fitLine()` — lineare Regression → Steigung/Achsenabschnitt/R²
- `analyzeChannel()` — zwei Geraden + Konvergenz, prüft dass sie sich nicht kreuzen
- `findBreakout()` — Bruch durch eine der fortgeschriebenen Linien
- `detectTriangles` (asc/desc/sym), `detectWedges` (rising/falling), `detectRectangles`

### Familie 3: Fortsetzung mit Impuls-Kontext
`detectFlags()` → bullFlag/bearFlag/bullPennant/bearPennant.
**Neue Zutat:** brauchen einen **Fahnenmast** VOR der Formation (`minPoleMove` 12 %, `maxPoleBars` 30). Ohne Mast ist eine Flagge nur ein kleiner Kanal — davon gibt es überall welche. Der Mast macht das Muster selten.
Flagge = paralleler Kanal GEGEN die Impulsrichtung. Wimpel = konvergierendes Dreieck. Nur Ausbruch in Impulsrichtung zählt; Bruch dagegen widerlegt (`failed` → verworfen).

### NULLMODELL-BEFUNDE (methodisch zentral)
GARCH(1,1) mit echten Vola-Clustern, 40 Läufe à 500 Bars, DEFAULTS:

| Stand | Fehlalarme/500 Bars |
|---|---|
| 6 Pivot-Muster | 0.60 |
| + 6 Trendlinien (R2 .75, conv .35, piv 5) | **2.52** ← Vervierfachung |
| + verschärft (R2 .90, conv .50, **piv 6**) | 1.00 |
| + 4 Flaggen/Wimpel | 1.20 |

**Kernbefund:** Trendlinien-Muster sind strukturell weniger selektiv — durch fast jede Punktwolke lassen sich zwei konvergierende Geraden legen. **`minPivots: 6` war der wirksamste Hebel** (1.90 → 1.00), nicht R² oder Konvergenz.

Defaults bewusst NICHT die schärfste Variante (R2 .93/conv .55 → 0.80): Testmuster sind perfekt konstruiert, echte unsauberer. Overfitting-Falle auf synthetische Daten.

Rangfolge nach Seltenheit im Rauschen (= Aussagekraft):
- **Nie:** Triple Top, Triple Bottom
- **Selten:** H&S (0.07), asc. Dreieck (0.03), Flaggen (0.07)
- **Häufiger:** Bull-Wimpel (0.25), Keile (0.13–0.20), Double Top (0.15)

### dedupe()
`rank`: H&S/Flaggen 4 > Wedge/Triangle 3, rectangle 3 > Triple 2 > Double 1.
Rectangle auf 3, weil es Triple Top UND Triple Bottom zusammenfasst.
**Bei Gleichstand gewinnt das LÄNGERE Muster.** Kritisch für Trendlinien: dieselbe Range wird in vielen Teilfenstern gefunden, gemeint ist die grösste zusammenhängende. Fiel bei Pivot-Mustern nie auf (deren Länge ist fix).

### KRITISCHER FIX: Slice→Vollindex-Rückmapping in scan()
`scan()` arbeitet auf einem `data.slice(from, to)` (nur Sichtbereich). Am Ende müssen ALLE Indizes auf den vollen Datensatz zurückgerechnet werden — nicht nur `points`/`confirmedAt`:
- `p.channel.from/to` und `p.pole.from/to` MÜSSEN `+= from`.
- Die Geraden-Funktionen `channel.upper.at()` / `channel.lower.at()` rechnen mit SLICE-Indizes → umhängen auf `(i) => origAt(i - from)` BEVOR from/to verschoben werden.
- Wird das vergessen, greift das Rendering mit einem Slice-Index in den vollen Datensatz → Dreiecke/Keile/Flaggen werden ganz links ausserhalb des Sichtfelds gezeichnet. War die Ursache für „Muster erscheinen im nicht sichtbaren Bereich". Verifiziert: bei Scan über [300,440] ist channel.from=347 statt 47.

### Rendering
`scanPatterns()` (app.js) schneidet auf `getVisibleRange()` und unterscheidet:
- `p.channel` → `channelPattern`-Overlay
- sonst → `pattern`-Overlay (Pivot-Kette)

Punkt-Reihenfolge channelPattern: `[ul, ur, ll, lr, (brk wenn hasBreak), (poleA, poleB wenn pole)]` — `extendData.hasBreak`/`.pole` steuern die Indizes.

**Labels ins Sichtfeld geklemmt:** beide Overlays bekommen `bounding.width` und klemmen die Label-X-Position auf `[60, W-60]`. Sonst liegt der Label-Anker (Mitte zwischen erstem/letztem Pivot) beim Rausscrollen ausserhalb → nur Punkte ohne Bezeichnung sichtbar.

**Muster-Name beim Hover:** `showPatternHint(p)` / `clearPatternHint()` in den `onMouseEnter/Leave`-Handlern beider Overlays schreiben Label + Richtung + bestätigt/unbestätigt + Sym% in die Statuszeile (merkt sich vorherigen Text). Nötig, weil bei kurzen/überlappenden Mustern das gezeichnete Label nicht lesbar ist.

**Qualität heisst "Sym X%"** — misst Symmetrie, NICHT Trefferwahrscheinlichkeit.

### Backtest (User führt in der Konsole aus)
- `PatternEngine.backtest(data, opts)` → `{n, hitRate, avgR, totalR, byType, rows}`
- `PatternEngine.backtestVsNull(data, opts, runs, blockLen)` → block-permutiert, p<0.05 = echt besser
- `PatternEngine.thresholdFrequency(series, threshold, dir)` → `{pct, hits, quantiles}`


## Grid Bot (js/derivatives.js + js/gridbot.js)

**Zwei Excel-Quellen, zwei Modelle — WICHTIG:**
- `Cockpit.xlsx` = einfacher Bias (Trend + Derivate), war die erste Portierung.
- `BTCUSDT_Dashboard_Claude.xlsx` = komplexes **Marks-Zyklus-Dashboard**, das die FAQ/Parameter/Q&A-Dokumente beschreiben. Dieses Modell ist jetzt massgeblich.

Der Grid Bot beantwortet NICHT „Long oder Short", sondern **„Wo im Zyklus, und ist ein Grid überhaupt das richtige Werkzeug?"** — Zyklus-Kalibrierung nach Howard Marks. Die alte Bias-Logik läuft im Hintergrund weiter (Konfluenz, Extremfilter, Squeeze), aber die eigentliche Empfehlung steht darüber.

### Zwei zentrale Metriken (in app.js gbMarketData berechnet, gegen Dashboard-Excel verifiziert)
- **Mayer Multiple = Preis / SMA200** (exakt auf 15 Stellen). Die Zyklus-Position: <0.9 = Akkumulation (traf jeden Boden seit 2015), >2.0 = teuer.
- **ER = Kaufman Efficiency Ratio, Periode 20** = |Netto-Bewegung| / Summe der Einzelschritte (exakt 0.457176 gegen Excel). Sagt, ob ein Grid etwas zu ernten hat: ≥0.5 = Trend (Grid riskant), <0.3 = Range (ideal).

### CYCLE-Schwellen (FEST, Object.freeze) — NICHT editierbar
Aus der Parameter-Referenz: *„Schwellen nie direkt ändern (fest in Formel). Aggressivität über Profil steuern."* Werte: mayerCheap 0.9, mayerExpensive 2.0, mayerBullish 1.0, fngFear 35, fngGreed 80, erTrend 0.5, erRange 0.3, minNetPerGrid 0.15.

**Warum fest:** eine Schwelle, die zehn Jahre gehalten hat, ist kein Regler. Wer sie hochdreht, weil „Defensiv" erscheint, senkt nicht das Risiko, nur die Warnung.

### PROFILES — ein Schalter statt drei Zahlen (Excel I16)
Konservativ {lev 1, risk 1%, gap 8%}, Moderat {2, 2%, 5%}, Risikofreudig {3, 3%, 3%}. Setzt Hebel-Cap, Risiko-Budget und Gap-Puffer gemeinsam. Konservativ = kleinste Positionen.

### recommendation(mayer, fng, er, suit) — 5 Stufen (Excel B39, alle wortgleich verifiziert)
1. ⛔ **Defensiv** (Mayer>2 | FNG>80): kein neuer Bot, Leitplanke zwingt 1×.
2. 🟢 **Akkumulation** (Mayer<0.9 & FNG<35): bei ER≥0.5 → Spot/DCA (Grid wartet auf Range), sonst → Makro-Grid.
3. ⚡ **Kurzfrist** (saubere Range): neutral pendeln.
4. 🔵 **Long-Bias** (Mayer<1): gerichtetes Grid.
5. 🟡 **Beobachten**: kein Extrem, keine Range → warten.

### Hebel-Leitplanke (Excel B27, äusserer MIN-Wrapper) — GESPERRT
Bei Mayer>2 ODER FNG>80 wird der Hebel ZWINGEND auf 1× gedeckelt, unabhängig von Profil/Bot-Cap. `guardActive` im computeTier. In Euphorien darf kein Profil vollen Hebel rechtfertigen. Verifiziert: alle Tiers → 1×.

### computeTier — die Reihenfolge IST die Logik
`Range aus ATR → Hebel = MIN(bot-cap, profil-cap, floor(1/(atrFrac×f + maintMargin/100 + slippage/100))) → Leitplanke → Stop → Size = MIN(stakeCap, (capital×risk)/(lev×(stopDist + gap/100)))`. Hebel folgt aus der Grid-Breite, Grösse folgt aus dem Risiko. Beides keine freie Wahl.

Tiers: short (atr14, 1.5, 0.8%, cap3, 7d), swing (atr90, 3.5, 1.4%, cap3, 30d), macro (atr200, 5.5, 2.0%, cap10, 180d) — `holdDays` für die Funding-Rechnung.

### viability(tier, lev, dir, holdDays, funding) — Excel B45–B48
Grid-Ertrag − Funding-Kosten. Ertrag = Füllungen/Monat × Tage/30 × (Ziel-Profit − Gebühr) × Hebel × Kalibrierung. Funding = sign × Hebel × Ø-Rate × Tage × 3. Neutral zahlt netto 0. Wird die Netto-Erwartung rot, frisst Funding den Ertrag.

### KRITISCHER BUG-FIX: riskPct-Default
`const riskPct = opts.riskPct ?? 1` überschrieb das Profil-Risikobudget mit 1 — alle drei Profile rechneten dieselbe Grösse, Konservativ hatte PARADOX grössere Positionen als Risikofreudig. Fix: `?? null`, dann greift im computeTier `riskPct != null ? riskPct : prof.riskBudget`. Verifiziert: 263 → 283 → 330 USDT (Konservativ→Moderat→Risikofreudig).

### Datenschicht (derivatives.js)
Vier CORS-freie Endpoints: Funding (`fapi/v1/fundingRate`), OI (`openInterestHist?period=1d`), L/S (`globalLongShortAccountRatio`), F&G (`api.alternative.me/fng`). `Promise.allSettled`, Cache 5 min. Binance zahlt Funding alle 8h → täglich ×3. **NICHT im Browser verifiziert** (Sandbox kommt nicht an Binance).

### Marktdaten
`gbMarketData()` rechnet Preis, SMA50/200, RSI14, ATR14/90/200, **Mayer, ER** selbst aus `chart.getDataList()` — nicht aus Indikator-Instanzen (die existieren nur wenn aktiviert). Braucht 200+ Kerzen.

### UI (radikal vereinfacht — User-Vorgabe: kompakt, Zahlen im Hintergrund)
Roboter-Icon, zweistufig. Statuszeile: Empfehlungs-Pill + Mayer + ER + F&G + RSI (grün/rot).
- **Strategie-Tab:** Empfehlungs-Box (`gbRecoBox`) RECHTS neben der Tabelle (`.gb-strat-row`, weil die Leiste breit statt hoch ist). Tabelle nur 8 Zeilen (Range oben/unten, Grids, Hebel, Investment, Stop, Sicherheit, Netto-Erwartung). Empfohlener Tier mit ★.
- **Einstellungen: nur 4 Felder** (Kapital, Gebühr, Füllungen + Profil-Dropdown). Alle Schwellen fest, mit Erklär-Notiz. `gbRenderSettings()` erzeugt das HTML dynamisch — **statisches HTML im Pane wurde entfernt** (Doppel-Definition der Funktion hatte vorher die neue überschrieben; alte gelöscht).
- **Layout:** Flex-Kind in `.chart-col`, grenzt an Drawbar/Watchlist. Höhe per `#gbResize`.
- **Daten/Einstellungen:** Flex + `max-content` statt `auto-fit`+`1fr` (sonst Spalten über volle Breite gestreckt → Bezeichnung und Wert auseinandergerissen).
- **Grid-Bänder überleben das Schliessen der Leiste.** Overlay `gridBands`.
- **Grid-Bot-FAQ ist ins Haupt-FAQ verschoben** (Sektion `data-sec="gridbot"`, 15 Blöcke). Der eigene FAQ-Tab in der Grid-Bot-Leiste wurde entfernt.

### Long / Short Position
Overlay `positionTool`, eigener Button in der Drawbar. Drei Klicks: Einstieg, Stop, Ziel → CRV + Positionsgrösse. **Gemeinsame Sizing-Quelle:** `window.__tvSizing()` liest jetzt Kapital aus `state.gbCapital` und Risiko aus dem PROFIL (`GridBot.profileValues().riskBudget`), nicht mehr aus entfernten Feldern.

### Suite-Overlap (bewusste Entscheidung, dokumentiert)
TreydViews Grid Bot dupliziert Mayer/ER/Funding/RSI aus Panta Rey + Stromschnelle mit anderen Methoden. User-Entscheidung: **(c) TreydView = Chart + Grid-Rechner.** Die Marks-Empfehlung BLEIBT drin, der Widerspruch zu Panta Rey (das Mayer mit Gewicht 0.30 gegen 5 Achsen rechnet statt harter Schwelle) wird hingenommen. Stromschnelle-Philosophie („keine Pionex-Parameter, kein LONG/SHORT-Signal") steht bewusst im Gegensatz — TreydView gibt genau das. Suite-Link zu Panta Rey nur wenn stabile URL (Stromschnelle = Netlify Drop, instabil) — noch NICHT umgesetzt.

## Bekannte Grenzen / offene Roadmap
- **Zeichnungs-Persistenz: ERLEDIGT** (eigenes Register, siehe „Weitere Systeme"). Zeichnungen sind jetzt in Workspace + Layouts.
- **Indikator-FAQ: ERLEDIGT** — alle 14 Indikatoren einzeln beschrieben (Aussage + Berechnung) in FAQ-Sektion `data-sec="ind"`.
- **FRVP "Extend Right"** fehlt
- **Anchored VWAP** — in Drawbar als Icon, nicht implementiert
- **Imbalance/FVG, Orderblocks** — nicht gebaut
- **Realised Price** — braucht Worker-Endpoint `/realizedprice` (CoinMetrics)
- **%-Suffix auf Compare-Y-Achse** — KLC hat keinen Value-Formatter; eigene Canvas-Beschriftung als Workaround
- **Polylinie/Path-Werkzeug** — mehrfach als offen notiert, noch nicht gebaut
- **Rohwert-neben-Perzentil** (aus Stromschnelle-Council übernommen als Idee) — nicht relevant für TreydView, nur falls Score-Anzeige käme
- **Order-Book Wall-Detector / Heatmap** — DREIMAL ABGELEHNT. Cross-Exchange braucht Backend; Single-Exchange-Walls unzuverlässig (Spoofing); keine historische Tiefe (1.3 GB/Tag, localStorage reicht 5 min); Zeitebene Sekunden vs. Zyklus. VRVP = realisiertes statt behauptetes Volumen, robuster.

## Config-Notizen

- **`WORKER_BASE_URL` in config.js ist PLATZHALTER** (`https://DEIN-WORKER.workers.dev`). Reys echte URL (`pantarey.rey-gafner.workers.dev`) steht NUR lokal bei ihm — beim Kopieren der ausgelieferten config.js darf sie NICHT überschrieben werden. Immer explizit erwähnen.
- Gold (XAU/USD): Worker `/goldhistory`, nur Daily. `normalizeGoldRow()` tolerant (JSON-Arrays, Wrapper, Stooq-CSV). Braucht CORS.
- **Gold-Fehlerdiagnose (präzisiert):** Die Fehlermeldung unterscheidet jetzt nach HTTP-Status. HTTP 5xx = „Worker antwortet, wirft aber Fehler → Cloudflare-Logs prüfen, NICHT die URL". HTTP 4xx = „Route nicht gefunden → Pfad prüfen". Sonst = „nicht erreichbar/CORS". Claude sieht den Worker nicht — bei HTTP 500 muss der User die Cloudflare-Logs prüfen; die URL ist dann korrekt.

## WebSocket Zombie-Reconnect (gelöst Juli 2026)

**Symptom:** Beim Wechsel auf Gold (oder anderes Symbol) tauchte in der Konsole ein WS-Fehler zum ALTEN Symbol auf (`ethusdt@kline_1d ... Ping received after close`).

**Ursache:** In `openBinanceStream` UND `openMiniTickerStream` (data.js) setzte `ws.onclose` einen `setTimeout(connect, 3000)`, ohne ihn bei `close()` abzubrechen. Zwischen Timer-Setzen und Feuern wurde der Stream geschlossen (Asset-Wechsel), aber 3 s später verband sich das alte Symbol klammheimlich neu.

**Fix:** `retryTimer` in beiden Streams, `clearTimeout` im Close-Callback, plus doppelter `closed`-Check (`if (!closed) retryTimer = setTimeout(() => { if (!closed) connect(); }, ...)`). Der Gold-WS-Fehler kam NICHT vom Worker, sondern von diesem Zombie.


## GitHub Pages Deployment (gelöst Juli 2026)

**Symptom:** Push erfolgreich, `git status` clean — Server liefert trotzdem alte Version.

**Ursache:** Pages lief mit **Jekyll**. Jekyll rendert das Repo als Blog, lädt ein Theme, rendert `HANDOFF.md` zu HTML und ruft die GitHub-API für Metadaten. Der API-Aufruf bekam 503 → Build scheitert → kein Deploy. Vorher trat dasselbe als 403 bei `FinalizeArtifact` auf.

**Lösung:** Leere Datei **`.nojekyll`** im Repo-Root.
```powershell
echo $null > .nojekyll
git add -f .nojekyll
```

**Diagnose bei "Änderungen nicht sichtbar":**
1. `document.getElementById('faqBtn')` in der Console → `null` = alte HTML im Browser
2. `view-source:` auf die Live-URL, Ctrl+F nach neuem Marker → steht es dort: Browser-Cache
3. Actions-Tab: läuft der Build durch?
4. `git ls-files js/lib/` → kennt Git die Datei?

**Wiederkehrend:** User kopiert falsche Dateien (alle Builds heissen gleich: `app.js`, `app(1).js`, …). **MD5 mitliefern**, Prüfung via `certutil -hashfile <datei> MD5`.

## Order Book Heatmap — abgelehnt (Juli 2026, zweite Anfrage)

Bereits als Wall-Detector abgelehnt, erneut als Heatmap angefragt. Gemessene Gründe:
- **Binance liefert keine historische Orderbuch-Tiefe.** Nur Snapshot (REST) oder Live ab Verbindung (WS).
- Selbst sammeln: 15.6 KB/Snapshot → **1.3 GB/Tag**. localStorage (5–10 MB) reicht **5 Minuten**.
- **Inhaltlich:** Orderbuch = *behauptetes* Volumen (stornierbar, Spoofing). VRVP = *realisiertes*. Für "wo liegt echter Widerstand" ist VRVP härtere Evidenz.
- Zeitebene Sekunden vs. Reys Zyklus-Prozess.

Falls doch gewünscht: Live-Depth-Profil als vertikales Overlay rechts, `@depth20@100ms`, kein Verlauf.


## Code-Audit Juli 2026 (Reverse-Engineering-Durchgang)

Systematische Analyse aller Dateien. Gefundene und behobene Fehler:

### Echte Bugs (behoben)
1. **Funding-Faktor-90-Fehler (gridbot.js):** `viability()` erwartet die 8h-Rate und rechnet selbst `× Tage × 3`. Übergeben wurde aber `fundingAvg30` — bereits auf den MONAT hochgerechnet (× 90). Folge: Funding-Kosten Faktor 90 zu hoch (Makro-Bot: 972 % statt 10.8 %), jede gerichtete Position sah massiv unrentabel aus. Fiel nicht auf, weil Neutral-Bots (sign=0) nicht betroffen waren. Fix: `/90` vor der Übergabe. Verifiziert: 2×0.02×180×3 = exakt 21.6 %.
2. **Watchlisten gingen beim Reload verloren:** `saveWorkspace` speicherte `state.watchlist` (Getter auf die AKTIVE Liste), nie `state.watchlists`/`state.activeWatchlist`. Wer eine zweite Liste anlegte und neu lud, verlor sie. Fix: beide Felder im Snapshot.
3. **Muster-Strenge ging verloren:** `patternOpts` (streng/mittel/locker) wurde geladen, nie gespeichert.
4. **Zeichnungen nach Reload unsichtbar:** im Workspace gespeichert, aber beim Seitenstart nie wiederhergestellt (nur beim Layout-Laden). Fix: `loadData().then(() => restoreDrawings(state.drawings))` in der Init-Sequenz.
5. **Race Condition bei schnellem Asset-Wechsel:** BTC→ETH→SOL startet drei parallele fetches; die langsamste Antwort gewann und der Chart zeigte ein anderes Asset als das Label. Fix: Sequenznummer `_loadSeq`, veraltete Antworten werden verworfen.

### Aufgeräumt
- **96 Zeilen Duplikat entfernt:** `gbDrawBands`, `gbInitResize`, `gbApplyHeight`, `gbToggleBar`, `gbSetCollapsed` existierten identisch doppelt (Rest der gbRenderSettings-Umbauten). JS nutzt durch Hoisting die letzte — harmlos im Verhalten, aber Ballast und Verwechslungsgefahr beim Editieren.
- `tooltipStyle()` entfernt (nie aufgerufen).
- 8 tote CSS-Regeln entfernt (u.a. `gb-tier-grid`/`gb-th-grid` — Reste der alten 20-Felder-Einstellungen).

### Optimiert
- **Scroll-Redraw koalesziert:** `onVisibleRangeChange` feuert beim Scrollen mehrfach pro Frame; VRVP/Compare stapelten identische rAF-Callbacks. Jetzt ein Flag, ein Redraw pro Frame.

### Geprüft und für sauber befunden
- Alle Render-Funktionen resetten per `innerHTML =` vor dem Anhängen von Handlern (keine Listener-Leaks).
- `_fetchKlineChunk` prüft `res.ok`; Chunk-Loop hat Endlosschleifen-Guard.
- Keine `setInterval` ohne Cleanup; `dashedValue`-Regel überall eingehalten.
- Hebel-Leitplanke: `ctx.fng` wird korrekt übergeben (Fehlalarm des Analyse-Skripts bei mehrzeiligem Objekt).
- `restoreDrawings` reassigniert statt mutiert — doppelte Aufrufe sicher.

### Audit-Methodik (für künftige Durchgänge)
Tote Funktionen: definierte vs. referenzierte Namen. Duplikate: Counter über `^function`-Matches. Fehlende IDs: getElementById-Argumente vs. HTML-IDs (Achtung: dynamisch erzeugte via `pop.id = ...` sind False Positives). State-Konsistenz: saveWorkspace-Felder vs. `_ws?.`-Initialisierungen — Asymmetrie = Persistenz-Bug. Schnittstellen: ctx-Nutzung in computeTier vs. ctx-Konstruktion in compute.

**DREI Regex-Fehlalarme in diesem Audit — Lehre: jeden Befund am Code verifizieren, BEVOR gefixt wird:**
1. `ctx.fng` „fehlt" — mehrzeiliges Objekt-Literal brach den Regex; fng war da.
2. `res.ok` „ungeprüft" — der Check sass in `_fetchKlineChunk`, eine Ebene tiefer als gesucht.
3. FAQ-Button „start" „fehlt" — `faq-navbtn" data-sec=` übersah `class="faq-navbtn active"`. Folge: ein Button wurde doppelt eingefügt und musste wieder entfernt werden. Bei Klassen-Matching IMMER `[^"]*` vor dem schliessenden Anführungszeichen.


## Feinschliff-Runde Juli 2026 (Indikator-Style, FRVP, Overlays, Magnet, Sortierung, Layouts)

### Indikator-Style-System (settings.js + indicators.js + app.js)
- **Deckkraft-Regler: 5%-Schritte** (`op.step = 5`) statt 1%.
- **Gestrichelte Linien (1.2):** neues `dashed`-Flag pro Plot. `plotStyle()` in indicators.js setzt `style: dashed ? "dashed" : "solid"` mit `dashedValue [5,4]`. Die beiden Hull-Sonderfälle (mhull/shull, dynamische Auf/Ab-Farbe) und GC wurden mitgezogen.
- **Preis-Tag pro Indikator ein/aus (1.3):** neues `showLast`-Flag pro Plot. `buildCreate()` setzt `create.styles.lastValueMark.show` = true, sobald mindestens ein Plot seinen Tag will (KLineCharts kann lastValueMark nur je Indikator schalten, nicht je Linie).
- **Preis-Tag von Deckkraft entkoppelt (1.4):** KLineCharts spiegelt die Linienfarbe (`figureStyles.color`) 1:1 in den Y-Achsen-Tag, inklusive Alpha. `plotStyle()` gibt der Linie deshalb jetzt `p.hex` (volle Deckkraft) statt `p.color` (mit Alpha) — der Tag bleibt immer zu 100 % lesbar. Die Deckkraft-Einstellung wirkt weiter auf **Flächen** (BMSB/Gaussian-Bänder), die `p.color` direkt lesen (nicht über plotStyle).

### FRVP (2.1)
Deckkraft-Regler (10–100 %, 5er-Schritte) im FRVP-Menü. `ext.opacity` steuert `hexToRgba(colorUp/Down, opacity)`. Default 55 (wie bisher hartcodiert).

### Overlay-Kontextmenü erweitert (Punkt 3)
Rechtsklick auf Zeichnungen bietet jetzt Farbe, Deckkraft (5er-Schritte), Dicke und gestrichelt — nicht nur Löschen. **Live-Vorschau:** jede Änderung sofort via `overrideOverlay({ id, styles: { line } })` (gegen echte API verifiziert). Der Stil wird ins Zeichnungs-Register gespiegelt (`rec.styles`), damit Layouts ihn behalten. Neuer Helfer `parseColor(c)` zerlegt hex/rgba in `{hex, alpha%}`. Betrifft alle Linien-Overlays (segment/ray/priceLine/horizontal/priceChannel/parallel/fib); Rechteck hat keine line-Komponente.

### Magnet an OHLC (Punkt 4)
KLineCharts' Magnet snappt bereits an alle vier OHLC-Werte — aber nur innerhalb `modeSensitivity` Pixeln (Default 8, kaum spürbar). Deshalb wirkte nur das Einrasten nahe der Mitte. Fix: `modeSensitivity: strong_magnet ? 40 : 18` in der Overlay-Config. Kein eigener Snap-Code nötig.

### Sortierbare Indikator-Liste (Punkt 6)
Drag & Drop via HTML5 draggable. Neuer State `indOrder` (Array von Keys, leer = Config-Reihenfolge). `orderedIndicators()` sortiert; neue/unbekannte Keys landen hinten. Griff-Icon `⠿`, `.dragging`/`.drag-over`-Klassen. `indOrder` in Workspace UND Layout-Snapshot.

### Layout-Wechsel repariert (Punkt 5) — DREI Bugs
1. **`drawings` stand DOPPELT im Snapshot:** einmal korrekt via `.map(({id, ...rest}) => rest)` (ohne id), einmal roh `drawings: state.drawings` (mit id). Das zweite überschrieb das erste → beim Wiederherstellen kollidierten alte IDs. Doppeltes Feld entfernt.
2. **Race Condition beim schnellen Doppelwechsel A→B:** `await loadData()` in applyNamedLayout konnte fertig werden, nachdem der User schon Layout B geöffnet hatte → A's `restoreDrawings` malte auf B. Fix: `if (state.currentLayout !== name) return;` nach dem await.
3. Zusammen mit dem `_loadSeq`-Guard aus dem Audit (veraltete fetch-Antworten) ist der Wechsel jetzt deterministisch. Voller Zyklus (speichern → löschen → wiederherstellen) gegen echte API verifiziert: Anzahl, Punkte, Styles, Position identisch.

### KLineCharts-API-Ergänzungen (für HANDOFF-Wissensteil)
- `overrideOverlay({ id, styles: { line: {...} } })` funktioniert pro Overlay (Farbe/Größe/style/dashedValue).
- Magnet: `modeSensitivity` (Pixel-Fangbereich) ist der entscheidende Parameter; ohne ihn ist weak_magnet praktisch unsichtbar.
- `lastValueMark.show` ist pro Indikator via `create.styles` schaltbar (im Gegensatz zur Textfarbe, die global bleibt).


## Feinschliff-Korrektur Juli 2026 (Regressionen aus voriger Runde + Layout-Preis + FRVP-Defaults)

### KORREKTUR zur „1.4 Preis-Tag-Entkopplung" (voriger Eintrag war FALSCH)
Der Versuch, die Linie mit `p.hex` (voller Deckkraft) zu zeichnen, damit der Tag lesbar bleibt, hatte zwei ungewollte Folgen:
- **Punkt 2 kaputt:** Der Deckkraft-Regler hatte keine Wirkung mehr, weil die Deckkraft in `p.color` (rgba mit Alpha) steckt, `plotStyle` aber `p.hex` (ohne Alpha) zurückgab.
- **Punkt 1 nie gelöst:** Der per-Indikator `create.styles.lastValueMark.show` ist WIRKUNGSLOS. Im Bundle verifiziert: `IndicatorLastValueView.drawImp` liest `chartStore.getStyles().indicator.lastValueMark` — rein GLOBAL. Es gibt KEINE per-Indikator- oder per-Plot-Steuerung des Preis-Tags. Linie und Tag teilen zwingend `figureStyles.color`.

**Endgültige, verlässliche Lösung:**
- `plotStyle` gibt wieder `p.color` (mit Deckkraft) zurück → Regler wirkt (Punkt 2). Tag erbt dieselbe Deckkraft — akzeptiert, da untrennbar.
- Preis-Tag (Punkt 1) läuft über `applyIndicatorTags()`: setzt GLOBAL `lastValueMark.show` = true, sobald ein sichtbarer Plot eines aktiven Indikators `showLast !== false` hat; sonst false. Aufgerufen nach Settings-Apply, Indikator-Toggle und in applyAllActive. `setStyles` merged, die globale Textfarbe `#0d1117` aus applyTheme bleibt erhalten.
- **Bekannte Grenze (klar an User kommuniziert):** Der Tag ist damit effektiv global, nicht echt pro Indikator. KLineCharts lässt nichts Feineres zu. Die beiden Hull-Sonderfälle und GC wurden ebenfalls auf `p.color` zurückgesetzt.

### Layout-Wechsel: Preis blieb hängen (Punkt 3)
Nach `await loadData()` fehlte `updateLegend()` — die Legende/der Preis zeigte weiter den letzten Wert des vorherigen Assets, obwohl der Graph schon gewechselt hatte. Jetzt nach dem await: `autoScaleY()` + `updateLegend()` + `restoreDrawings()` + `applyIndicatorTags()`. Der Datenfluss (Snapshot liest state.drawings, restoreDrawings(l.drawings)) war korrekt; nur die Anzeige lief nicht nach.

### FRVP-Defaults (Punkt 4)
Neuer State `frvpDefaults` (persistiert). Beim FRVP-Apply werden die Einstellungen als Vorlage gemerkt (`state.frvpDefaults = {...newExt}`); ein neu gezeichnetes FRVP nutzt sie statt der eingebauten Defaults. Apply spiegelt auch ins Zeichnungs-Register (rec.extendData), damit Layouts es behalten.

### Lehre
Zweimal in Folge an derselben KLineCharts-Grenze (lastValueMark ist global) vorbeigebaut. Bei Chart-Engine-Eigenheiten IMMER erst den Renderer im Bundle lesen, BEVOR eine Lösung gebaut wird — nicht die API-Signatur (die akzeptiert styles.lastValueMark klaglos, ignoriert sie aber).


## E2E-Debugging Juli 2026 — die wahre Ursache des Layout-Bugs

**Symptome (2 Runden lang falsch behandelt):** Layout laden → Graph wechselt, aber Preis bleibt beim alten Asset, Zeichnungen (Linien + FRVP) erscheinen nicht.

**Wahre Ursache (per E2E-Test gefunden, e2e-layout.js im Harness):** `ReferenceError: retryTimer is not defined` in data.js `openMiniTickerStream`. Beim Zombie-Reconnect-Fix wurde die Zuweisung per Regex eingefügt, aber die DEKLARATION nicht — der Funktionskopf lautete `let ws = null, closed = false;` (eine Zeile), der Regex suchte `let closed = false;` als eigene Zeile. Der Cleanup `if (retryTimer)` warf beim ersten close() → `restartWatchlistStream` → `applyNamedLayout` starb VOR `await loadData()` → alte Daten blieben (Preis hängt), restoreDrawings lief nie (Zeichnungen weg). Fix: `let ws = null, closed = false, retryTimer = null;`.

**Lehre (dritter Regex-Vorfall):** Nach jedem Regex-Edit nicht nur Syntax prüfen, sondern den BETROFFENEN PFAD ausführen. Der neue E2E-Test (zeichnen → speichern → Symbol wechseln → Layout laden, mit gemocktem Binance: BTC 60000 / ETH 2500) deckt genau das ab und gehört vor jede Auslieferung. `unhandledRejection`-Handler im Harness machte den stillen async-Tod sichtbar.

## Preis-Tags: applyTheme-Konflikt behoben

`applyTheme()` hardcodete `lastValueMark.show:true` und überschrieb jede Abwahl beim nächsten Theme-Durchlauf. Jetzt EINE Quelle: `indicatorTagsWanted()` (Tag an, solange irgendein sichtbarer Plot eines aktiven Indikators ihn will) — genutzt von applyTheme UND applyIndicatorTags. E2E Schritt 6 verifiziert: alle abgewählt → show:false, applyTheme() → bleibt false, einer wieder an → true. Tooltip an der Checkbox erklärt die globale Wirkung (KLC-Grenze). applyIndicatorTags setzt nur noch `show` (nicht text.show) — schont color/size beim Merge.


## Umbau-Runde Juli 2026: Eigener Tag-Renderer + 7 Feinschliff-Punkte + Engine-Ausbau

### Eigener Preis-Tag-Renderer (ERSETZT den globalen KLC-Ansatz komplett)
Der User forderte echte Pro-Linie-Kontrolle — der globale lastValueMark-Ansatz wurde GELÖSCHT (indicatorTagsWanted/applyIndicatorTags existieren nicht mehr). Stattdessen:
- **ensureTagCanvas** (z-index 11, über VRVP), **scheduleTagDraw** (rAF-koalesziert via _tagQueued), **drawIndicatorTags** in app.js.
- Werte: `chart.getIndicatorByPaneId(paneId, ind.name).result` — Array, letzter Eintrag, keyed nach figure-keys (= unsere plot-keys). API-verifiziert.
- Position: `convertToPixel({timestamp, value}, {paneId, absolute:true})` — absolute:true liefert chart-weite Y auch für Sub-Panes (verifiziert: RSI-Pane y=505 bei 600px Chart).
- Pro Plot: skip wenn `!state.active`, `ind.noTags`, key vrvp, `pl.visible===false` oder `pl.showLast===false`. Farbe `pl.hex` (voll deckend) → Deckkraft-Entkopplung nebenbei gelöst.
- **Aktueller Preis wird ZULETZT gezeichnet = immer zuoberst** (Punkt 3). Farbe up/down aus chartStyle, Grösse cs.lastSize. KLC: `indicator.lastValueMark.show:false` fix, `candle.priceMark.last.text.show:false` (Linie bleibt KLC).
- Trigger: applyAllActive, loadData (nach applyNewData), Live-Tick, onVisibleRangeChange (koaleszierter Block), applyTheme (+30ms), Indikator-Toggle, Settings-Apply, applyNamedLayout.
- **MNOODLE: `noTags:true` in config** — komplett tagfrei, settings.js versteckt die Checkbox (`indDef.noTags`).

### Feinschliff-Punkte 4–7
- **Menü-Klemmung:** `clampMenuToViewport(menu)` misst nach dem Einblenden die ECHTE Grösse und klemmt an den Viewport — menuPosition schätzt nur (FRVP-Menü war höher als die Schätzung → "Übernehmen" unerreichbar). In openFrvpMenu + openOverlayMenu.
- **Compare-Beschriftungen:** 11→13px (Achse) und 10→12px (Chips).
- **Layout-Altlasten (Punkt 6, E2E-verifiziert):** In applyNamedLayout nach `state.active = new Set(...)`: `clearAllDrawings(); drawVrvp();`. Zwei Ursachen: (1) clearAllDrawings lief nur beim SYMBOL-Wechsel — bei gleichem Symbol (BTC-Layout→Vergleichs-Layout) blieben FRVPs/Linien stehen. (2) removeIndicator("vrvp") ruft drawVrvp, während vrvp NOCH im alten state.active steckt → malte das Profil frisch. Der zweite drawVrvp-Aufruf nach dem Set-Wechsel cleart wirklich. Dazu gbRenderTiers()-Nachzug (clearAllDrawings nullt gbActiveTier — sonst zeigt ein Button "Im Chart ✓" ohne Band).
- **AERO (Punkt 7):** loadData unterscheidet jetzt Binance-HTTP-4xx: "Binance kennt AEROUSDT nicht — Paar dort nicht (mehr) gelistet." AERO ist vermutlich nicht auf Binance Spot — User prüft die Meldung nach Deploy.

### Pattern-Engine-Ausbau (aus Gemini-Review + eigenen Funden)
- **Scan-Marge (Gemini c):** scanPatterns scannt `from-150` bis to, filtert dann `rightIdx(p) >= from` (rightIdx = confirmedAt ?? channel.to ?? letzter Pivot). Angeschnittene Muster links werden erkannt, gezeichnet wird nur was im Sichtfeld endet.
- **"Sym" → "Form"** überall (overlays-Label, Hover, Statuszeile, FAQ) — ein Prozentwert namens "Sym" wirkt wie eine Trefferquote.
- **volRatio (patterns.js):** nach dem Rückmapping, am VOLLEN Datensatz: Volumen der Bestätigungskerze / Mittel der 20 Bars davor. NUR Information im Hover ("Vol 1.6×" / "(dünn)") — bewusst KEIN Filter, damit die Nullmodell-Kalibrierung unverändert bleibt.
- **FAQ-Konsole-Befehl gefixt:** `PatternEngine.backtest(window.__tvGetDataList())` — das frühere `chart.getDataList()` scheiterte (chart ist nicht global, IIFE).

### Muster-FAQ neu (User-Vorgaben: 10 SVGs nur für gerichtete, nur qualitativ, keine Nullmodell-Zahlen je Block)
20 Blöcke: Intro (erwähnt Schlusskurs-Bestätigung + Scan-Marge), 14 Muster-Blöcke (10 mit Inline-SVG: Double Top/Bottom, H&S/iH&S, auf-/absteigendes Dreieck, steigender/fallender Keil, Bull/Bear-Flagge; textlich mit Verweis: Triple, Wimpel, sym. Dreieck, Rechteck), Warn-Block (Erwartung≠Wahrscheinlichkeit, deckt Gemini a+b ab), Strenge, Seltenheits-Sammelblock, Vol-Hover-Erklärung, Selbst-nachmessen. SVG-Konvention: Muster stroke var(--text-dim), Erwartungs-Pfeil gestrichelt var(--up)/var(--down) mit Spitze, Hilfslinien var(--accent) dash. CSS: .pat-fig float:right 140×76.

### E2E-Harness erweitert (e2e-layout.js)
Neuer Schritt 5b: leeres Layout nach BTC-Layout laden → alte Overlay-IDs müssen tot sein, drawings/active leer (Punkt-6-Regression). Tag-Test prüft: KLC-Tags global false, applyTheme lässt sie aus, drawIndicatorTags wirft nicht. Hook `window.__T` wird beim Kopieren vor das schliessende `})();` injiziert.
