# TreydView — HANDOFF.md
**Stand: 24. Juli 2026**
Repo: github.com/Panta-rey/Treydview
Live: https://panta-rey.github.io/Treydview/
Eigentümer: Rey Gafner / Panta-rey
Arbeitssprache: Deutsch (de-CH, ss statt ß)

---

## Projekt-Charakteristik

Zero-Build Vanilla JS SPA, GitHub Pages, kein Build-Step, kein Framework.
- Browser-native APIs: fetch, WebSocket, Canvas, localStorage, requestAnimationFrame
- Einziges Backend: Cloudflare Worker für Golddaten
  `WORKER_BASE_URL: "https://pantarey.rey-gafner.workers.dev"` — NIE überschreiben
- Exchange-Daten: direkt via Browser → CORS (Sandbox blockiert → nur im Browser testbar)
- Persistenz: localStorage (key "tv_workspace")
- Deployment: git push → GitHub Pages

---

## Dateistruktur

```
index.html          — HTML, UI-Panels, Mobile-Info-Bar, Draw-Sheet, Zyklus-Ampel
js/
  config.js         — CONFIG-Objekt (Symbole, Timeframes, Exchanges, Indikatoren)
  data.js           — DataLayer (Binance/Coinbase/Kraken/Bybit/Gold fetch + WS)
  settings.js       — Settings-Panel (Inputs/Style pro Indikator, localStorage)
  indicators.js     — KLC-Indikator-Registrierungen
  overlays.js       — KLC-Overlay-Registrierungen (FRVP, Fib, smcZone, AVWAP etc.)
  patterns.js       — PatternEngine (16 Muster, Nullmodell, Block-Permutation, p-Wert)
  smc.js            — SMC: FVG + OB (ATR-relativ, lastCandleOnly, nullTest)
  gridbot.js        — Grid-Bot (Regime, Tiers, viability, Zyklus-Ampel-Daten)
  derivatives.js    — Derivate/Sentiment (Funding, OI, L/S, Fear&Greed)
  app.js            — Haupt-App (~4370 Zeilen, IIFE)
css/
  style.css         — Styles inkl. Dark/Light, Mobile-Redesign, Zyklus-Ampel, Sheets
klinecharts.min.js  — KLineCharts 9.8.12 (LOKAL GEPATCHT: Zoom-Grenze var St=0.2)
```

---

## Aktuelle Datei-MD5

| Datei | MD5 | Zeilen |
|---|---|---|
| app.js | 56a40fadfa6d720a02908badd3c8134b | 4371 |
| config.js | fc6cff7fab290a246c255349f13a8fd8 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| index.html | 87b9c7736f33d652006090c02047bb82 | 1017 |
| style.css | adcf5966a48c490bd4c4ceef576e03dc | 859 |

Unverändert (direkt aus Repo): settings.js, patterns.js, derivatives.js, klinecharts.min.js

---

## Kritisches Wissen

### KLineCharts (KLC)
- Version 9.8.12, gepatcht: `var St=0.2` (Zoom-Mindestgrenze) — bei Updates erneut setzen
- `lastValueMark` nur global setzbar → eigener Canvas-Tag-Renderer (`drawIndicatorTags`)
- `dashedValue` MUSS bei jedem `styles()`-Callback vollständig sein (sonst Freeze)
- **KLC hat keinen nativen Y-Zoom für Touch** (im Bundle verifiziert)
  - Y-Drag: Ein-Finger-Drag auf Preisskala (~80px rechts), Desktop-Algorithmus nachgebaut
  - Formel: `scale = pageY/startY`, `newRange = base.range × scale`, symmetrisch
  - `setRange` braucht ALLE Felder: `{from, to, range, realFrom, realTo, realRange}`
  - Nach `setRange` zwingend `chart.adjustPaneViewport(false, true, true, true)` für Redraw
  - Doppeltipp auf Preisskala = Auto-Fit
- X-Pinch-Zoom: KLC nativ via `_initPinch()` — nicht anfassen

### app.js (IIFE, window-Scope)

**Debug-Bridges:**
- `window.__tvState` — state (63 Felder) aus Konsole erreichbar
- `window.__tvDebug = true` — alle `quiet()`-Aufrufe loggen Fehler
- `quiet(fn, label)` — zentraler Error-Wrapper statt `catch(e){}`
- `window.__tvGetDataList` — Bridge für overlays.js
- `window.__tvCompareAssets` — Bridge für indicators.js
- `window.__tvSizing` — Bridge für overlays.js (Positions-Tool)
- `window.__tvAnchorVwap` / `window.__tvRemoveAnchorVwap` — AVWAP
- `window.__tvOpenFibMenu` — Fibonacci-Menü
- `window.__tvStartTool` — Draw-Sheet-Zugriff (= startTool)
- `window.__tvTestBybit(sym, interval)` — Bybit API-Debug

**Indikator-Tag-Mapping (TAG_RESULT_KEY):**
- EMA: e1→ema1, e2→ema2, e3→ema3, e4→ema4
- RVWAP: line→rvwap
- GC: upper→gcUpper, midUp→gcMid, lower→gcLower
- Hull: up→mhull

### Money Noodle — KRITISCH
```js
key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle", noTags: true,  // Kommentar ans Ende
```
`name`, `pane`, `label` MÜSSEN vor dem `//` stehen. Dahinter = auskommentiert = unsichtbar.

### EMA(21) — dreifach im Standard-Chart
Money Noodle `med` (21), BMSB `ema21`, EMA `p1=21` zeichnen alle dieselbe Linie.
Labels: `"Medium EMA (21)"` und `"21 EMA (= EMA p1)"` — bewusst nicht als 3 Bestätigungen lesen.

### Exchange-Integration
- **Binance**: USDT/USDC/BTC/USD, Status TRADING, kein Volumenfilter
- **Coinbase**: /products, status "online"
- **Kraken**: /AssetPairs, X/Z-Prefix-Normalisierung (XXBT→BTC, ZUSD→USD)
- **Bybit**: /v5/market/tickers?category=spot, Volumenfilter 1M turnover24h
- IDs: Kraken `${key}_KR`, Bybit `${sym}_BY`
- Vergleich: nur gleiche Quote-Währung (renderCompareList filtert activeQuote)

### Grid-Bot ATR — Wichtig
`gbMarketData(dailyD)` rechnet ATR/SMA/ER immer auf Tages-Kerzen:
- `gbRefresh()` holt 210 Tagesdaten separat (Binance `1d`, Bybit `D`, Kraken `1440`)
- Damit sind Grid-Ranges unabhängig vom aktiven Chart-Timeframe (4h vs 1D)
- `market.dailyDataUsed` im gbResult = Debug-Flag
- Fallback auf Chart-Kerzen wenn Fetch fehlschlägt (Coinbase, kein Netz)

### Grid-Bot viability
`viability(tier, lev, direction, holdDays, fundingAvg8h, erScore)`
- ER-Regime koppelt Füllrate: ER < 0.3 → 100%, ER 0.3–0.5 → 65%, ER ≥ 0.5 → 30%
- Label: `⚠️ Ertrag > Kosten (Regime: 30% Füllrate)` statt blindem ✅ im Trend
- Neutral-Grid: Liquidationsprüfung `⚠️ Liq. ~X% entfernt`
- Hebel-Leitplanke: Mayer > 2.0 ODER FNG > 80 → Zwang auf 1×

### Zyklus-Ampel (5 Pills)
**Reihenfolge: F&G → OI → Fund → M → ER**
Pills zeigen nur Kürzel + Farbe. Klick öffnet Popover (5s Auto-Close).

Farblogik:
- **F&G**: < 35 grün · 35–80 gelb · > 80 rot
- **OI Δ30T**: < −10% grün · −10 bis +10% gelb · > +10% rot
- **Fund 8h**: < −0.01% grün · −0.01 bis +0.05% gelb · > +0.05% rot
- **M (Mayer)**: < 0.9 grün · 0.9–2.0 gelb · > 2.0 rot
- **ER**: < 0.3 grün · 0.3–0.5 gelb · > 0.5 rot

Datenquellen: `r.derivatives.fng`, `r.derivatives.oiChange30`, `r.derivatives.funding8h`,
`r.mayer`, `r.market.er`

Auto-Load beim Start: nach erstem `loadData()` startet `gbRefresh(false)` nach 800ms.
Auf Mobile ausgeblendet (kein Platz) — Werte trotzdem geladen, im Bot-Panel erreichbar.

### SMC-Modul (smc.js)
- FVG-Filter: `minGapAtr: 0.1` (ATR-relativ, nicht % vom Preis)
- OB: `lastCandleOnly: true` — nur letzte Gegenkerze vor Impuls
- `showFilled: true` — gefüllte Zonen sichtbar (Bilanz bewertbar)
- `nullTest`: `SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))`
- Framing: „Kontext, kein Signal" — kein Stop, kein Ziel

### FAQ-Struktur (10 Sektionen)
start · chart · draw · ind · pat · pos · gridbot · **zyklus** (neu) · ws · limits

Zyklus-Ampel-Block ist eigenständige Sektion, NICHT im Grid Bot.
SMC-Block ist in der Indikatoren-Sektion (nicht Draw).

### Workspace-Persistenz
Gespeichert: active, activeWatchlist, chartStyle, chartType, currentLayout,
drawStyle, drawings, frvpDefaults, gbActiveTier, gbCapital, gbCollapsed,
gbHeight, gbOpen, gbProfile, gbThresholds, gbTiers, indOrder, legendCollapsed,
patternOpts, smcOpts, symbol, theme, timeframeId, watchlistOpen, watchlists.
localStorage-Quota wird sichtbar gemeldet (kein stilles Schlucken).

---

## Mobile-Redesign (≤720px / pointer:coarse)

**Desktop bleibt unverändert.** Alle Mobile-Änderungen über CSS `@media` + `.mobile-only`.

### Topbar auf Mobile
Ausgeblendet: Screenshot-Button, Kerzen-Dropdown, SMC-Dropdown (→ in Indikatoren), Drawbar
Komprimiert: `+ Vergleich` → `+`, Indikatoren → Lupen-Icon, Zyklus-Ampel-Pills

**Sichtbar auf Mobile:**
`+ | 🔍 (Ind) | ✏️ (Draw) | 🤖 (Bot) | 👁 (WL) | ⟳ (Zoom) | 🌙 | ❓`

### Mobile Info-Bar
Direkt unter Topbar, im `.chart-col`:
`BTC/USDT (Binance) [Tap] | 1h [Tap] | 64'892 | +0.04%`
- Tap Asset → öffnet Asset-Dropdown
- Tap TF → öffnet TF-Dropdown
- Synchron über `updatePriceHeader()`

### Draw-Bottom-Sheet
Ein Stift-Icon öffnet Sheet von unten mit allen 14 Tools im 4-Spalten-Grid:
Linie, Horizontal, Vertikal, Preislinie, Ray, Rechteck, Kanal, Polylinie,
Fibonacci, FRVP, AVWAP, Preisbereich, Notiz, L/S Position.
`startTool(key)` → `window.__tvStartTool` Bridge.

### SMC auf Mobile
SMC-Checkboxen und Buttons erscheinen am Ende des Indikatoren-Fly-Outs.
Sync via `initSmcIndSync()` — Änderungen spiegeln sich bidirektional.

### Panel-Limits
- Grid Bot: `max-height: 75vh`, `overflow-y: auto`, `width: 100vw`
- Alle Dropdowns: `max-width: 100vw − 16px`, `max-height: 60vh`
- Watchlist: volle Breite als Bottom-Overlay

### Touch-Gesten
- X-Pinch: KLC nativ (nicht anfassen)
- Y-Drag: Ein-Finger auf Preisskala → Y-Zoom
- Doppeltipp Preisskala → Auto-Fit
- Long-Press (~500ms) → Kontextmenü (= Desktop Rechtsklick)
- Menüs auf Mobile als Bottom-Sheet (`.as-sheet` Klasse via `placeMenu()`)

---

## PENDING / OFFEN

### 1. Y-Achsen-Drag — implementiert, im Browser nicht verifiziert
Code ist drin. `__tvDebug = true` in Konsole → `"yDrag start"` / `"yDrag move"` erscheinen wenn es feuert.

### 2. Mobile: Ein-Finger-Pan auf dem Chart
KLC verwaltet einen Finger horizontal nativ. Falls es auf dem Handy nicht funktioniert:
prüfen ob unsere `touchstart`-Listener mit KLC-Internals kollidieren. Bisher nicht gemeldet.

### 3. Mobile Topbar — offene Punkte aus Diskussion
- Zyklus-Ampel auf Mobile: aktuell ausgeblendet. Möglichkeit: 3 wichtigste Pills (F&G, M, ER)
  in kompakterer Form anzeigen wenn die Topbar Platz hat
- FAQ-Icon ragt evtl. noch rechts über Bildrand — zu verifizieren

### 4. Exchange-APIs von Sandbox blockiert
Coinbase, Kraken, Bybit: nur im Browser testbar.
```js
__tvState.allSymbols.filter(s=>s.type==="bybit").length
__tvTestBybit("BTCUSDT","D")
```

### 5. SMC nullTest auf echten Daten noch nicht ausgeführt
```js
SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))
```
Wenn p-Wert > 0.05: Detektor unterscheidet nicht von Rauschen → Schwellen nachschärfen.

### 6. Grid Bot Netto-Anzeige: Risikoterm
Netto wächst linear mit Hebel, kein Risikoterm in der Formel. `liqDist` ist als
separater Risikohinweis im Return-Objekt — wird aber noch nicht im UI angezeigt.

### 7. AVWAP — nur ein Anker aktiv
KLC erlaubt pro Pane nur eine Instanz pro Name. Mehrere gleichzeitige AVWAPs
brauchen dynamische Namen oder Sub-Panes.

---

## Arbeitsweise

- Nur geänderte Dateien liefern
- `node -c` nach jeder Änderung (Syntaxprüfung)
- `WORKER_BASE_URL` nie überschreiben
- Bei grossen Blöcken: Python-Replace (`python3 << 'PYEOF'`)
- Exchange-APIs von Sandbox blockiert → Konsole im Browser

### PowerShell Deploy
```powershell
cd C:\Users\rey_g\projects\treydview
Copy-Item "$env:USERPROFILE\Downloads\app.js"     ".\js\app.js"     -Force
Copy-Item "$env:USERPROFILE\Downloads\style.css"  ".\css\style.css" -Force
Copy-Item "$env:USERPROFILE\Downloads\index.html" ".\index.html"    -Force
# config.js / smc.js / gridbot.js: ".\js\<datei>"
git add -A
git commit -m "<nachricht>"
git push
```
HANDOFF.md nur lokal — nie committen, nie pushen.
