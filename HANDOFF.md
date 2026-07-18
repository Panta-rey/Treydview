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
