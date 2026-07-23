# TreydView — HANDOFF.md
**Stand: 22. Juli 2026**
Repo: github.com/Panta-rey/Treydview
Live: https://panta-rey.github.io/Treydview/
Eigentümer: Rey Gafner / Panta-rey
Arbeitssprache: Deutsch (de-CH, ss statt ß)

---

## Projekt-Charakteristik

Zero-Build Vanilla JS Single Page Application, gehostet als statische Site auf GitHub Pages.
- Kein Build-Step, kein Bundler, kein Framework, kein Transpiler
- Modulisolation via IIFE-Pattern
- Browser-native APIs: fetch, WebSocket, Canvas, localStorage, requestAnimationFrame
- Einziges Backend: Cloudflare Worker für Golddaten (WORKER_BASE_URL: https://pantarey.rey-gafner.workers.dev)
- Alle anderen Daten: Browser → Exchange-API direkt (CORS)
- Persistenz: nur localStorage (key "tv_workspace")
- Deployment: git push → GitHub Pages

---

## Dateistruktur

```
index.html          — Haupt-HTML, alle Script-Tags, UI-Panels
js/
  config.js         — CONFIG-Objekt (Symbole, Timeframes, Exchanges, Indikatoren)
  data.js           — DataLayer (Binance/Coinbase/Kraken/Bybit/Gold fetch + WS)
  settings.js       — Settings-Panel (Inputs/Style pro Indikator, localStorage)
  indicators.js     — KLC-Indikator-Registrierungen (EMA, HULL, GC, RVWAP, etc.)
  overlays.js       — KLC-Overlay-Registrierungen (FRVP, FibRetracement, smcZone, etc.)
  patterns.js       — PatternEngine (Chart-Muster-Erkennung, 16 Muster)
  smc.js            — SMC-Modul: FVG + Order Block Erkennung (NEU, isoliert)
  gridbot.js        — Grid-Bot-Modul
  derivatives.js    — Derivate/Sentiment (Funding, OI, L/S, Fear&Greed)
  app.js            — Haupt-App (3800+ Zeilen, IIFE)
css/
  style.css         — Alle Styles inkl. Dark/Light Theme, Mobile Media Queries
klinecharts.min.js  — KLineCharts 9.8.12 (LOKAL GEPATCHT: Zoom-Grenze var St=0.2)
```

---

## Kritisches Wissen

### KLineCharts (KLC)
- Version 9.8.12, lokal gepatcht: `var St=0.2` (Zoom-Mindestgrenze)
- Bei KLC-Updates: Patch muss erneut manuell im minified Bundle gesetzt werden
- `lastValueMark` ist NUR global setzbar — deshalb eigener Canvas-Tag-Renderer (`drawIndicatorTags`)
- `indicatorData`-Zugriff: `data.current.indicatorData.<key>` (nicht `data.current.<key>`)
- `bar`-Figures brauchen `style:"fill"` (nicht "solid")
- `dashedValue` MUSS bei jedem `styles()`-Callback vollständig sein (sonst Chart-Freeze)
- KLC verwaltet Touch/Pinch-Zoom (X-Achse) komplett intern via `_initPinch()`
  - Registriert `touchstart` mit `{passive:true}` auf dem Element
  - Registriert `touchmove` auf `document.documentElement` mit `{passive:false}`
  - Eigener `pinchEvent` ruft `getTimeScaleStore().zoom()` auf (nur X)
  - `stopPropagation()` / `preventDefault()` aus eigenem Handler stört KLC

### app.js (IIFE, window-Scope)
- `state`-Objekt ist IIFE-lokal → Debug via `window.__tvState = state` (bereits eingebaut)
- `window.__tvGetDataList` — Bridge für overlays.js (FRVP braucht Candle-Daten)
- `window.__tvCompareAssets` — Bridge für indicators.js
- `window.__tvSizing` — Bridge für overlays.js
- `window.__tvAnchorVwap` / `window.__tvRemoveAnchorVwap` — AVWAP-Bridge
- `window.__tvOpenFibMenu` — Fibonacci-Menü
- `window.__tvTestBybit(sym,interval)` — Debug: Bybit API-Test aus Konsole

### Indikator-Tag-Mapping (TAG_RESULT_KEY in drawIndicatorTags)
Config-Plot-Key → Ergebnis-Key (indicators.js):
- EMA: e1→ema1, e2→ema2, e3→ema3, e4→ema4
- RVWAP: line→rvwap
- GC: upper→gcUpper, midUp→gcMid, lower→gcLower (midDown bewusst kein Tag)
- Hull: up→mhull (down/band bewusst kein Tag)
- GC midUp: trendabhängige Farbe via lastRow.gcUp
- Hull up: trendabhängige Farbe via lastRow.up

### Exchange-Integration
Alle vier Exchanges in config.js + data.js + app.js:
- **Binance**: USDT/USDC/BTC/USD, Status TRADING, kein Volumenfilter (TRADING = liquide genug)
- **Coinbase**: /products Endpoint, status "online", ALLOWED_QUOTES
- **Kraken**: /AssetPairs, status "online", X/Z-Prefix-Normalisierung (XXBT→BTC, ZUSD→USD)
- **Bybit**: /v5/market/tickers?category=spot, Volumenfilter 1M turnover24h
- IDs: Kraken `${key}_KR`, Bybit `${sym}_BY` (Präfix verhindert Kollisionen)
- Defaults immer vorne in state.allSymbols, nie dupliziert (seen-Set)
- CANDLE_LIMIT: 5000 (paginiert), LAZY_LOAD_CHUNK: 1000
- Kein Live-WebSocket für Kraken/Coinbase/Bybit (zeigt Exchange-Name statt "Live")

### Vergleichsmodus (+Vergleich)
- Nur gleiche Quote-Währung vergleichbar (renderCompareList filtert auf activeQuote)
- Beim Aktivieren werden KOMPLETT entfernt: alle Indikatoren, VRVP-Canvas,
  Grid-Bot-Bänder (gbClearBands), Chart-Muster (clearPatterns), SMC-Zonen (clearSMC),
  alle state.drawings-Overlays inkl. FRVP (IDs in state._hiddenDrawingIds)
- Beim Verlassen: alles wiederhergestellt via applyIndicator + gbDrawBands + restoreDrawings
- Y-Achse zeigt %, Preis-Tags deaktiviert
- VRVP: onVisibleRangeChange prüft `compareAssets.length === 0` vor drawVrvp()

### Canvas-Schichtung (z-index)
1. KLineCharts Canvas (intern)
2. VRVP Canvas (z-index 10)
3. Tag/Compare Canvas (z-index 11)

### settings.js
- `showLast`-Checkbox nur bei Plots ohne `noWidth` (im `if (!p.noWidth)`-Block)
- `noTags: true` am Indikator → Tag-Checkbox versteckt
- Money Noodle hat `noTags: true` (User-Wunsch, keine Preis-Tags)

### Money Noodle (config.js)
ACHTUNG: Diese Zeile ist kritisch und darf nie wieder falsch formatiert werden:
```js
key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle", noTags: true,   // Kommentar ans Ende
```
`name`, `pane`, `label` MÜSSEN vor dem `//`-Kommentar stehen. Wenn sie dahinter stehen,
sind sie auskommentiert → Money Noodle unsichtbar und zeigt "undefined".

---

## Aktuelle Datei-MD5 (Stand Handoff)

| Datei | MD5 | Zeilen |
|---|---|---|
| app.js | f9a03200b6ef660ad206d81ce614e050 | 4008 |
| config.js | 793b7ecdd2a9941b6e5bd2d8ca2b0b81 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | ff369fb9fdbd508c95095731255346eb | 176 |
| index.html | 017f2075c42653a080652ab5f9db8af9 | 879 |
| style.css | 10222ae9c21c8ae4404e3045d24a67f2 | 569 |

Unverändert seit letztem Stand (nicht in outputs, direkt aus Repo nutzen):
- settings.js, gridbot.js, patterns.js, derivatives.js, klinecharts.min.js

---

## Features: Implementiert und funktionierend

### Chart & Navigation
- KLineCharts 9.8.12 mit gepatched Zoom-Minimum
- Kerzen / Linie / Hollow (umschaltbar)
- Lazy Loading beim Zurückscrollen (alle 4 Exchanges)
- Auto-Zoom Button (Y-Achse)
- Screenshot (JPEG)
- Dark / Light Theme

### Indikatoren
EMA, SMA, Bollinger Bands, Gaussian Channel, Hull Suite, Rolling VWAP 365d,
Money Noodle, Bull Market Support Band, MyRSI, StochRSI, MyVol, MACD, ATR,
VRVP (Canvas, sichtbarer Bereich), AVWAP (Anchored VWAP, ein Anker aktiv)

Preis-Tags: eigener Canvas-Renderer, pro Linie schaltbar, immer zuoberst.
EMA/RVWAP/GC/Hull: Key-Mapping korrekt implementiert (TAG_RESULT_KEY).

### Overlays / Zeichenwerkzeuge
Segment, Horizontale/Vertikale Linie, Preislinie, Rechteck, Ray, Preis-/Datumskanal,
Parallele Linien, Polylinie (klickbasiert, Enter/Rechtsklick beendet),
Fibonacci Retracement/Extension, Preis-/Datumsbereich,
Freihand (klickbasiert), Positions-Tool, Notiz (simpleAnnotation),
FRVP (Fixed Range Volume Profile, inkl. Extend Right, Einstellungen per Rechtsklick),
Anchored VWAP (1 Anker aktiv, lila Linie ab Ankerpunkt),
smcZone (programmatisch, für FVG/OB)

Alle Overlays: in Layouts gespeichert, beim Restore wiederhergestellt.

### Exchanges & Symbole
Binance, Coinbase, Kraken, Bybit — alle mit dynamischem Symbol-Loading.
Quote-Filter: USDT, USDC, USD, BTC.
CONFIG.DEFAULT_SYMBOLS immer enthalten, keine Duplikate.
Vergleich: nur gleiche Quote-Währung.
Getestete Symbols: BTC/Binance ✓, ETH/Binance ✓, AERO/Coinbase ✓,
AERO/Bybit ✓ (bis Dez 2024), BTC/Kraken ✓, RENDER/USDT ✓

### Multi-Asset-Vergleich
Canvas-basiert, relative %-Performance, eigene Y-Achse.
Beim Aktivieren: alles Preis-basierte wird entfernt (Indikatoren, VRVP,
Grid-Bot, Muster, FVG/OB, Overlays/FRVP).
Beim Verlassen: alles wiederhergestellt.

### Smart Money Concepts (smc.js — NEU, isoliertes Modul)
- Fair Value Gaps (bullish/bearish): 3-Kerzen-Imbalance
- Order Blocks (bullish/bearish): letzte Gegenkerze vor Displacement > 1.5× ATR
- Optionen: gefüllte/mitigierte zeigen, Extend Right
- Hover zeigt Details in Statuszeile
- Erkennungslogik via Node.js getestet: 8/8 Asserts bestanden
- Entfernen: smc.js löschen + Script-Tag in index.html entfernen

### Chart-Muster (patterns.js)
16 Muster mit SVG in der FAQ. Alle haben Inline-SVGs.
PatternEngine: Nullmodell-Kalibrierung, strenge Defaults.

### Grid Bot
Integriert, mit Tier-System, Bänder auf Chart.
Beim Vergleichsmodus: Bänder entfernt, beim Verlassen wiederhergestellt.

### Mobile / Touch
- Long-Press (~500ms) → Rechtsklick-Menü (contextmenu-Event)
- X-Pinch-Zoom: KLC nativ (funktioniert)
- CSS Media Query: grössere Touch-Targets, scrollbare Panels

### Layouts
Speichern/Laden von Symbol, Timeframe, Indikatoren, Zeichnungen, Chart-Typ.

### Watchlist
Mehrere Watchlisten, MiniTicker-Stream, Live-Preise.

---

## PENDING / OFFEN

### 1. Y-Achsen-Zoom Mobile (OPUS benötigt)
**Status:** Nicht implementiert / mehrfach fehlgeschlagen.
**Problem:** KLC verwaltet Touch-Pinch vollständig intern via `_initPinch()`.
Registriert `touchstart` mit `{passive:true}` und `touchmove` auf
`document.documentElement` mit `{passive:false}`. Eigene Handler konkurrieren
und blockieren KLC's nativen X-Zoom.
**Was versucht wurde:**
- `passive:false` + `preventDefault()` → bricht KLC's X-Zoom
- `stopPropagation()` → KLC hört auf anderem Level, hilft nicht
- `setTimeout(0)` nach KLC → autoScaleY überschreibt setRange sofort
- `setAutoCalcTickFlag(false)` + `setRange` → wird bei nächstem onVisibleRangeChange überschrieben
- Separater passiver Listener nur für Y-Achse → setRange-Aufrufe haben keinen sichtbaren Effekt
**Ansatz für Opus:**
Tiefer in KLC's `getDrawPaneById("candle_pane").getAxisComponent()` schauen.
Prüfen ob `_autoCalcTickFlag` und `_range` nach `setRange` wirklich gesetzt sind
(direkt via `yAxis._range` in Konsole prüfen). Möglicherweise braucht es einen
`chart.update()` oder `pane.update()` Call nach `setRange` um den Redraw zu triggern.
Alternativ: KLC's nativen `mouseWheelVertEvent` via synthetisches WheelEvent auf
der Y-Achse triggern (Desktop-Y-Zoom-Mechanismus für Touch emulieren).

### 2. AVWAP — nur ein Anker aktiv
Mehrere gleichzeitige AVWAPs: KLC erlaubt pro Pane nur eine Indikator-Instanz
pro Name. Workaround nötig (dynamische Indikator-Namen oder Sub-Panes).

### 3. Exchange-Erweiterung (ungetestet von Sandbox aus)
Kraken, Coinbase, Bybit — APIs von der Sandbox blockiert, nur im Browser testbar.
Bisher getestet: Kerzen erscheinen für BTC/ETH auf allen drei. AERO/Bybit ✓.

### 4. FVG/Orderblocks — Opus-Session geplant
SMC-Modul ist gebaut und Erkennungslogik getestet. Rendering im Browser noch
nicht vollständig verifiziert (Zone-Darstellung, Farben, Hover).

### 5. System-Review (pausiert)
Geplantes Council-Review: Architektur, Performance, Code-Qualität, UX.
Wurde pausiert zugunsten Feature-Entwicklung.

---

## Arbeitsweise mit Rey

- Nur geänderte Dateien liefern (kein ZIP)
- MD5 immer mitliefern
- WORKER_BASE_URL nie überschreiben: `https://pantarey.rey-gafner.workers.dev`
- `node -c` nach jeder Änderung (Syntaxprüfung)
- Immer auf echten Dateien via `cp` + `str_replace` arbeiten (keine Rekonstruktionen)
- Exchange-APIs von Sandbox blockiert → im Browser testen, Konsole nutzen
- Bei grossen Blöcken: Python-Replace statt str_replace (sicherer bei Sonderzeichen)
- Auf Uploads aufbauen: erst `cp uploads/ outputs/`, dann patchen
- `window.__tvState` für Konsolen-Debug (bereits in app.js eingebaut)

## PowerShell Deploy-Vorlage
```powershell
cd C:\Users\rey_g\projects\treydview
Copy-Item "$env:USERPROFILE\Downloads\<datei>" ".\js\<datei>" -Force
git add -A
git commit -m "<nachricht>"
git push
```
Neue Dateien (smc.js): `".\js\smc.js"` — muss zusätzlich ins `js/`-Verzeichnis.
