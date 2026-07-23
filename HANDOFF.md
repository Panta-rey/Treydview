# TreydView — HANDOFF.md
**Stand: 23. Juli 2026**
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
- Einziges Backend: Cloudflare Worker für Golddaten
  `WORKER_BASE_URL: "https://pantarey.rey-gafner.workers.dev"` — nie überschreiben
- Alle anderen Daten: Browser → Exchange-API direkt (CORS)
- Persistenz: nur localStorage (key "tv_workspace")
- Deployment: git push → GitHub Pages

---

## Dateistruktur

```
index.html          — Haupt-HTML, alle Script-Tags, UI-Panels, Zyklus-Ampel
js/
  config.js         — CONFIG-Objekt (Symbole, Timeframes, Exchanges, Indikatoren)
  data.js           — DataLayer (Binance/Coinbase/Kraken/Bybit/Gold fetch + WS)
  settings.js       — Settings-Panel (Inputs/Style pro Indikator, localStorage)
  indicators.js     — KLC-Indikator-Registrierungen (EMA, HULL, GC, RVWAP, AVWAP etc.)
  overlays.js       — KLC-Overlay-Registrierungen (FRVP, Fib, smcZone, Polyline, avwap)
  patterns.js       — PatternEngine (16 Muster, Nullmodell, Block-Permutation, p-Wert, R-Backtest)
  smc.js            — SMC-Modul: FVG + Order Block Erkennung (isoliert, entfernbar)
  gridbot.js        — Grid-Bot-Modul (Regime, Tiers, Sizing, viability)
  derivatives.js    — Derivate/Sentiment (Funding, OI, L/S, Fear&Greed)
  app.js            — Haupt-App (~4100 Zeilen, IIFE)
css/
  style.css         — Alle Styles inkl. Dark/Light, Mobile, Zyklus-Ampel, Bottom-Sheets
klinecharts.min.js  — KLineCharts 9.8.12 (LOKAL GEPATCHT: Zoom-Grenze var St=0.2)
```

---

## Kritisches Wissen

### KLineCharts (KLC)
- Version 9.8.12, lokal gepatcht: `var St=0.2` (Zoom-Mindestgrenze)
- Bei KLC-Updates: Patch muss erneut manuell im minified Bundle gesetzt werden
- `lastValueMark` ist NUR global setzbar — deshalb eigener Canvas-Tag-Renderer
- `indicatorData`-Zugriff: `data.current.indicatorData.<key>`
- `bar`-Figures brauchen `style:"fill"` (nicht "solid")
- `dashedValue` MUSS bei jedem `styles()`-Callback vollständig sein (sonst Chart-Freeze)
- KLC verwaltet Touch/Pinch-Zoom (X-Achse) intern via `_initPinch()`
  - Registriert `touchstart` mit `{passive:true}` und `touchmove` auf `document.documentElement`
  - **KLC hat keinen nativen Y-Achsen-Zoom für Touch** (im Bundle verifiziert)
  - Y-Drag implementiert: Ein-Finger-Drag auf Preisskala, Desktop-Algorithmus nachgebaut
  - Formel: `scale = pageY/startY`, `newRange = base.range × scale`, symmetrisch verteilt
  - `setRange` braucht ALLE Felder: `{from, to, range, realFrom, realTo, realRange}`
  - Nach `setRange` zwingend `chart.adjustPaneViewport(false, true, true, true)` für Redraw
  - Doppeltipp auf Preisskala = Auto-Fit

### app.js (IIFE, window-Scope)
- `window.__tvState` — state aus Konsole erreichbar (Debug)
- `window.__tvDebug = true` — alle `quiet()`-Aufrufe loggen Fehler in Konsole
- `quiet(fn, label)` — zentraler Error-Wrapper, ersetzt alle `catch(e){}`
- `window.__tvGetDataList` — Bridge für overlays.js (FRVP)
- `window.__tvCompareAssets` — Bridge für indicators.js
- `window.__tvSizing` — Bridge für overlays.js (Positions-Tool)
- `window.__tvAnchorVwap` / `window.__tvRemoveAnchorVwap` — AVWAP-Bridge
- `window.__tvOpenFibMenu` — Fibonacci-Menü
- `window.__tvTestBybit(sym, interval)` — Debug: Bybit API-Test aus Konsole

### Indikator-Tag-Mapping (TAG_RESULT_KEY in drawIndicatorTags)
Config-Plot-Key → Ergebnis-Key (indicators.js):
- EMA: e1→ema1, e2→ema2, e3→ema3, e4→ema4
- RVWAP: line→rvwap
- GC: upper→gcUpper, midUp→gcMid, lower→gcLower (midDown bewusst kein Tag)
- Hull: up→mhull (down/band bewusst kein Tag)
- GC midUp: trendabhängige Farbe via lastRow.gcUp
- Hull up: trendabhängige Farbe via lastRow.up

### Money Noodle (config.js) — KRITISCH
Diese Zeile darf NIE falsch formatiert werden:
```js
key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle", noTags: true,   // Kommentar ans Ende
```
`name`, `pane`, `label` MÜSSEN vor dem `//` stehen. Dahinter = auskommentiert = Money Noodle unsichtbar.

### EMA(21) — dreifach im Standard
Money Noodle `med` (21), BMSB `ema21`, EMA `p1=21` zeichnen alle EMA(21).
Labels jetzt: `"Medium EMA (21)"` und `"21 EMA (= EMA p1)"` — nicht als Bestätigungen zählen.

### Exchange-Integration
- **Binance**: USDT/USDC/BTC/USD, Status TRADING, kein Volumenfilter
- **Coinbase**: /products, status "online", ALLOWED_QUOTES
- **Kraken**: /AssetPairs, status "online", X/Z-Prefix-Normalisierung
- **Bybit**: /v5/market/tickers?category=spot, Volumenfilter 1M turnover24h
- IDs: Kraken `${key}_KR`, Bybit `${sym}_BY`
- Defaults immer vorne, nie dupliziert (seen-Set)
- Kein Live-WS für Kraken/Coinbase/Bybit
- Exchange-APIs von Sandbox blockiert → nur im Browser testbar

### Vergleichsmodus
- Nur gleiche Quote-Währung (renderCompareList filtert auf activeQuote)
- Beim Aktivieren entfernt: Indikatoren, VRVP, Grid-Bot-Bänder, Muster, SMC, state.drawings
- IDs in `state._hiddenDrawingIds`, beim Verlassen via `restoreDrawings` wiederhergestellt
- VRVP: onVisibleRangeChange + Live-Stream prüfen `compareAssets.length === 0`

### Canvas-Schichtung (z-index)
1. KLineCharts Canvas (intern)
2. VRVP Canvas (z-index 10)
3. Tag/Compare Canvas (z-index 11)

### Workspace-Persistenz (saveWorkspace)
Gespeicherte Felder: active, activeWatchlist, chartStyle, chartType, currentLayout,
**drawStyle** (früher fehlte das), drawings, frvpDefaults, gbActiveTier, gbCapital,
gbCollapsed, gbHeight, gbOpen, gbProfile, gbThresholds, gbTiers, indOrder,
legendCollapsed, patternOpts, **smcOpts** (früher fehlte das), symbol, theme,
timeframeId, watchlistOpen, watchlists
localStorage-Quota-Fehler wird sichtbar gemeldet (nicht mehr still geschluckt).

### SMC-Modul (smc.js)
**FVG-Erkennung:**
- Filter: `minGapAtr: 0.1` — Lücke muss > 0,1 × ATR sein (ATR-relativ, nicht % vom Preis)
- `fvgFillRule: "touch"` — erste Berührung mitigiert

**OB-Erkennung:**
- `lastCandleOnly: true` — NUR die letzte Gegenkerze vor dem Impuls ist der OB
  (3 aufeinanderfolgende Abwärtskerzen → 1 OB, nicht 3)
- `obDisplaceMult: 1.5` — Displacement > 1,5 × ATR
- `obLookahead: 3` — Kerzen nach dem OB für Impuls-Check

**Exports:** `{ DEFAULTS, detectFVG, detectOrderBlocks, atrAt, nullTest }`

**nullTest:** `SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))`
Block-Permutation, 20 Läufe, p-Wert, Interpretation — identische Methodik wie patterns.js.

**Framing:** Kontext, kein Signal — kein Stop, kein Ziel, keine Bestätigung.
`showFilled` ist standardmässig **true** (Bilanz der getesteten Zonen sichtbar).

### Grid-Bot (gridbot.js)
**viability(tier, lev, direction, holdDays, fundingAvg8h, erScore)**
- `erScore` neu: koppelt Füllrate ans Regime
  - ER < 0.3 (Range): 100% Füllrate
  - ER 0.3–0.5 (Übergang): 65%
  - ER ≥ 0.5 (Trend): 30%
  - Label: `⚠️ Ertrag > Kosten (Regime: 30% Füllrate)` statt blindem ✅ im Trend
- Neutral-Grid: Liquidationsprüfung auch bei Neutral (zeigt `⚠️ Liq. ~X% entfernt`)
- Netto wächst weiterhin mit Hebel (kein Risikoterm in der Formel) — `liqDist` als
  separater Risikohinweis im Return-Objekt

**Hebel-Leitplanke:** Mayer > 2 ODER FNG > 80 → Zwang auf 1×, unabhängig vom Profil.
Das ist Marks als ausführbare Regel.

### Zyklus-Ampel (Topbar)
Drei Pills `cycleMayer`, `cycleFng`, `cycleFund` neben dem Bot-Button.
- Grün = günstig (Akkumulation), Gelb = neutral, Rot = teuer/gierig
- Befüllt via `updateCycleBar(r)` nach jedem `gbRefresh()`
- Klick öffnet Bot-Panel und lädt Daten bei Bedarf
- Verschwindet auf < 480px Screens

### Mobile / Touch
- Long-Press (~500ms) → contextmenu-Event (Rechtsklick-Menü)
- X-Pinch-Zoom: KLC nativ (nicht anfassen)
- Y-Achsen-Zoom: Ein-Finger-Drag auf Preisskala (rechts ~80px), Doppeltipp = Auto-Fit
- Alle Context-Menüs: `placeMenu()` — auf Touch + ≤720px als Bottom-Sheet (`.as-sheet`)
- Watchlist: auf Mobile Overlay (von rechts), standardmässig geschlossen bei Erstbesuch
- Drawbar: auf Mobile horizontal am unteren Rand, Fly-Outs klappen nach oben
- Media Query: `(max-width: 720px)` + `(pointer: coarse)`

---

## Aktuelle Datei-MD5 (Stand Handoff)

| Datei | MD5 | Zeilen |
|---|---|---|
| app.js | 92c22153db682b75f62ea0b5a522416b | 4143 |
| config.js | fc6cff7fab290a246c255349f13a8fd8 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| index.html | 7ef95875a0b5e5a30574ba3d52953bc3 | 891 |
| style.css | cde4a86649e2281f4cae1f4337cf7c54 | 685 |

Unverändert (nicht in outputs, direkt aus Repo):
- settings.js, patterns.js, derivatives.js, klinecharts.min.js

---

## Features: Vollständig implementiert

### Chart & Navigation
- KLineCharts 9.8.12 (gepatcht)
- Kerzen / Linie / Hollow, Dark/Light Theme
- Lazy Loading (alle 4 Exchanges, rückwärts)
- Auto-Zoom Button
- Screenshot (JPEG)

### Indikatoren (14)
EMA, SMA, Bollinger, Gaussian Channel, Hull Suite, Rolling VWAP 365d,
Money Noodle, BMSB, MyRSI, StochRSI, MyVol, MACD, ATR,
VRVP (Canvas), AVWAP (1 Anker aktiv)

Preis-Tags: eigener Canvas-Renderer, pro Linie schaltbar, TAG_RESULT_KEY-Mapping korrekt.

### Overlays / Zeichenwerkzeuge
Alle Standard-KLC-Overlays + Freihand, Polyline (klickbasiert, Enter/Rechtsklick/Doppelklick),
FRVP (inkl. Extend Right), Anchored VWAP, smcZone, Positions-Tool (R-Rechnung + Sizing)

### Exchanges & Symbole
Binance + Coinbase + Kraken + Bybit, Quote-Filter USDT/USDC/USD/BTC,
gleiche Quote für Vergleich erzwungen, Zyklus-Ampel befüllt nach gbRefresh.

### Smart Money Concepts (smc.js)
FVG + OB, ATR-relativ, lastCandleOnly, nullTest, showFilled=true,
„Kontext, kein Signal" beschriftet.

### Muster-Erkennung (patterns.js)
16 Muster mit SVG, Nullmodell, Block-Permutation, p-Wert, R-Backtest.
Standard-Sorgfalt: Massstab für alle neuen Module.

### Grid-Bot
Regime-sensitive viability, Neutral-Liq-Check, Zyklus-Ampel,
Hebel-Leitplanke (Mayer/FNG), Profil-Risikobudgets, Positions-Tool verknüpft.

### Multi-Asset-Vergleich
Canvas-basiert, %-Performance, alle Preis-basierten Elemente beim Aktivieren entfernt.

### Mobile / Touch
Long-Press, Y-Drag-Zoom, X-Pinch nativ, Bottom-Sheets, Watchlist als Overlay.

### System-Qualität
- `quiet(fn, label)` + `window.__tvDebug` für Fehler-Sichtbarkeit
- localStorage-Quota sichtbar gemeldet
- VRVP: Spread durch Schleifen ersetzt (kein Stack-Crash bei 65k Kerzen)
- Toter Code entfernt (tsToX in drawCompare)
- drawStyle + smcOpts persistent gespeichert

---

## PENDING / OFFEN

### 1. Y-Achsen-Zoom Mobile — Status: implementiert, ungetestet
Code ist eingebaut (Ein-Finger-Drag auf Preisskala, `adjustPaneViewport` nach setRange).
Konnte nicht im Browser verifiziert werden. `__tvDebug = true` in Konsole zeigt
`"yDrag start"` / `"yDrag move"` via `quiet()` wenn es feuert.
Falls es nicht funktioniert: `quiet()`-Log auslesen, dann gezielt nachbessern.

### 2. AVWAP — nur ein Anker aktiv
Mehrere gleichzeitige AVWAPs: KLC erlaubt pro Pane nur eine Indikator-Instanz
pro Name. Workaround nötig (dynamische Namen oder Sub-Panes).

### 3. Exchange-APIs — ungetestet von Sandbox
Coinbase, Kraken, Bybit: APIs von Sandbox blockiert. Im Browser testen:
- `__tvState.allSymbols.filter(s=>s.type==="bybit").length` — Bybit geladen?
- `__tvTestBybit("BTCUSDT","D")` — API erreichbar?

### 4. FVG/OB — Nullmodell auf echten Daten noch nicht ausgewertet
`SMC.nullTest()` ist gebaut. Noch nie auf echten BTC-Daten ausgeführt.
```js
SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))
```
Wenn p-Wert > 0.05: Detektor unterscheidet sich nicht von Rauschen → Schwellen nachschärfen.

### 5. Journal / Trade-Log / R-Buchhaltung
Fehlt komplett. `/cryptocouncil` hat es als wichtigstes fehlendes Feature bezeichnet.
Bewusst aus Scope A–E herausgelassen (Rey: „brauche ich nicht" für F).
Rückwirkung: `calibration: 1` im Grid-Bot zeigt auf externes Excel-Journal.

### 6. FVG/Orderblocks — Opus-Session für Verfeinerung
Nullmodell auf echten Daten ausführen (Punkt 4), dann:
- Kreuzbörsen-Prüfung (Lücke auf Binance UND Coinbase UND Bybit?)
- Derivate-Bestätigung (OI-Einbruch + Funding-Umschwung bei OB?)

### 7. System-Review — /council Empfehlungen
Alle Sonnet-Punkte umgesetzt. Offene Opus-Punkte aus dem System-Review:
- Zyklusdaten an Akkumulations-Ansicht anbinden (E erledigt Sichtbarkeit, nicht Analyse)
- Mayer/FNG als Sparentscheid-Signal (nicht nur Bot-Hebel) explizit dokumentieren

---

## Arbeitsweise mit Rey

- Nur geänderte Dateien liefern (kein ZIP)
- MD5 immer mitliefern
- `WORKER_BASE_URL` nie überschreiben
- `node -c` nach jeder Änderung
- Immer auf echten Dateien via `cp uploads/ outputs/` + `str_replace` arbeiten
- Bei grossen Blöcken: Python-Replace (`python3 << 'EOF'`)
- Exchange-APIs von Sandbox blockiert → Konsole im Browser nutzen
- `window.__tvState` für Debug, `window.__tvDebug = true` für Fehler-Log

## PowerShell Deploy-Vorlage
```powershell
cd C:\Users\rey_g\projects\treydview
Copy-Item "$env:USERPROFILE\Downloads\<datei>" ".\js\<datei>" -Force
# style.css: ".\css\style.css"
# index.html: ".\index.html"
git add -A
git commit -m "<nachricht>"
git push
```
HANDOFF.md nur lokal speichern — nicht committen, nicht pushen.
