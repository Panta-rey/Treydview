# TreydView — HANDOFF

Übergabe-Dokument für künftige Claude-Sessions oder andere Entwickler.

**Stand: Juli 2026. Letzter stabiler Commit: "Vergleich: Canvas-basiert, eigene %-Achse, Auto-Scaling, reaktives Rebaselining"**

---

## Projekt-Kontext

TradingView-artiges Chart-Cockpit für Rey Gafner (GitHub: Panta-rey). Rein statische Web-App, kein Build-Step, GitHub Pages.

- **Repo:** github.com/Panta-rey/Treydview
- **Live:** https://panta-rey.github.io/Treydview/
- **Lokal:** `C:\Users\rey_g\projects\treydview` (Windows, PowerShell)
- **Deploy:** `git add -A && git commit -m "..." && git push`, dann Ctrl+F5
- **User-Kontext:** Kommunikation Deutsch (de-CH, ss statt ß). Git-Anfänger → Befehle einzeln, copy-paste-fertig. Nur geänderte Dateien liefern, kein ZIP. HANDOFF nur auf Anfrage.

---

## Architektur

```
index.html        Layout, CDN-Tags, Overlay-Menü-HTMLs
css/style.css     Terminal-Theme (dark, Gold #e8b64c, IBM Plex Mono)
js/config.js      Zentrale Konfig: Worker-URL, Symbole, TFs,
                  Indikator-Registry (inputs+plots), Draw-Tools, hexToRgba()
js/indicators.js  Custom-Indikatoren (registerIndicator)
js/overlays.js    Custom-Zeichenwerkzeuge (registerOverlay)
js/data.js        Datenlayer: Binance REST/WS + Gold-Adapter (ms-Timestamps)
js/settings.js    Settings-Modal: Tabs Inputs/Style, localStorage "tv4_ind_<key>"
js/app.js         Alles andere: Chart-Init, State, UI, Canvas-Systeme
```

**Chart-Engine:** KLineCharts 9.8.12 (CDN, UMD, `window.klinecharts`). Apache 2.0.

---

## KRITISCHER BUG-HINTERGRUND — vor indicators.js-Änderungen lesen

**Crash `Cannot read properties of undefined (reading '0')`** → Chart friert ein.

Ursache: KLineCharts liest intern `styles.dashedValue[0]` beim Linien-Merge. Fehlt `dashedValue`, crasht der Renderer.

**Regel: JEDER `styles()`-Callback und jeder `lineStyle`-Block MUSS vollständige Objekte liefern:**
```js
{ style: "solid", color: "...", size: 1, smooth: false, dashedValue: [2, 2] }
```

`plotStyle()` in indicators.js enthält den Fix. Neue figures/lineStyle-Blöcke: immer `dashedValue: [2, 2]` dazugeben.

**headless jsdom-Test kann diesen Crash nicht reproduzieren** — tritt nur im echten Browser auf. Bei Freeze: F12 → Console → Fehlermeldung mit Dateizeile weitergeben.

---

## Indikator-System

### Custom-Indikatoren (indicators.js)

| Name | pane | Beschreibung |
|------|------|--------------|
| MNOODLE | main | Money Noodle: EMA 12/21/35 + ATR-Band. **Unsichtbare Plots dürfen KEINE Datenpunkte ausgeben** (würde Merge crashen). Sichtbarkeit via `indicator.extendData.plots[key].visible` prüfen, bei false → Wert weglassen. |
| BMSB | main | Bull Market Support Band: 20 SMA + 21 EMA auf Chart-TF, Close. Kein Wochen-Resampling. |
| HULL | main | Hull Suite 55, trendgefärbt. |
| RVWAP | main | Rolling VWAP 365d. Auf 15m/1h leer (Fenster > 1000 Candles) — bewusst. |
| GC | main | Gaussian Channel 144/1.414/4. **Hat `draw`-Callback** für Kanal-Fill (grün/rot trendgefärbt). Nutzt `indicator.result` für Koordinaten. |
| STOCHRSI | sub | K/D (blau/orange) + konstante Referenzlinien 20/50/80 als figure-Serien. |
| COMPARE | main | **Nicht mehr aktiv genutzt** — registriert in indicators.js, aber der Compare-Modus läuft jetzt vollständig als Canvas (`drawCompare()` in app.js). Kann entfernt werden. |

**Built-in KLC** (direkt via `chart.createIndicator`): EMA, BOLL, RSI, VOL. Styles via `create.styles.lines[]` in `buildCreate()` — `dashedValue` nicht vergessen.

### Settings-Schema (config.js)
Jeder Indikator hat `inputs` (Berechnungsparameter) und `plots` (Darstellung). `Settings.get(key)` liefert:
```js
{ inputs: { period: 14 }, plots: { line: { hex: "#c792ea", opacity: 100, color: "rgba(...)", width: 2, visible: true } } }
```

---

## Canvas-Systeme (app.js)

Drei eigenständige Canvas-Overlays über `#mainChart`, alle nach dem gleichen Muster:

### VRVP-Canvas (`state.vrvpCanvas`, `drawVrvp()`)
- Aufgerufen bei: `onVisibleRangeChange`, Live-Updates, Resize
- Preis→Pixel: `chart.convertToPixel({ value }, { paneId: "candle_pane", absolute: true })`
- Clip auf Pane: `chart.getSize("candle_pane")` → `{top, height}`
- Abstand Preisachse: `rightGap = 96px`

### Compare-Canvas (`_compareCanvas`, `drawCompare()`)
Vollständiger Relative-Performance-Modus. **Kein KLC-Indikator mehr.**

**Aktivierung** (`applyCompareIndicator`):
- KLC-Kerzen/Achse unsichtbar: `candle.type = "area"`, alles transparent, yAxis-Beschriftung auf `rgba(0,0,0,0)`
- `drawCompare()` zeichnet alles selbst

**`drawCompare()` — Logik:**
1. Sichtbaren Bereich holen: `chart.getVisibleRange()` → `{realFrom, realTo}`
2. `fromIdx = realFrom` = erster sichtbarer Bar = **0%-Referenzpunkt** für alle Assets
3. Für jedes Asset (Hauptasset + Vergleiche): Referenzpreis = Close am `fromIdx`
4. Alle sichtbaren Prozentwerte berechnen → **Auto-Scaling**: Min/Max mit 5% Padding → Y-Achse dynamisch
5. Eigene Prozent-Beschriftung rechts auf Canvas zeichnen (USD-Achse ist unsichtbar)
6. `drawLine()` zeichnet jede Linie: Bar-Index → Pixel via `chart.convertToPixel({ dataIndex: i }, ...)`
7. 0%-Linie gestrichelt

**Reaktivität:** `onVisibleRangeChange` → `requestAnimationFrame(drawCompare)` → neuer Referenzpunkt, neues Auto-Scaling, sofort neu gezeichnet.

**Deaktivierung:** `chart.setStyles(baseStyles())` stellt Kerzen/Achse wieder her, Canvas wird geleert.

**Wichtiger Bug-Fix (Juli 2026):** Python-Regex-Ersetzung hatte alten `onVisibleRangeChange`-Handler-Code nicht entfernt → doppeltes `});` → IIFE schloss zu früh → `state is not defined`. Fix: alten Restcode manuell entfernt. Bei zukünftigen Python-Regex-Ersetzungen: immer Klammern zählen danach.

### FRVP-Canvas (kein eigenes Canvas)
FRVP ist ein KLC-Overlay (`registerOverlay`, name: `"frvp"`). Zeichnet via `createPointFigures`. Candle-Daten via `window.__tvGetDataList = () => chart.getDataList()`.

---

## Zeichenwerkzeuge

12 Tools in config.js (`DRAW_TOOLS`): segment, rayLine, horizontal/verticalStraightLine, priceLine, priceChannelLine, parallelStraightLine, fibonacciLine, rectangle, priceRange, dateRange, **frvp**.

**Rechtsklick-Verhalten** (in `startTool()`):
- FRVP → `openFrvpMenu()`: volles Einstellungs-Panel (Rows, VA%, Breite, VAH/VAL/POC ein/aus + Farben)
- Alle anderen → `openOverlayMenu()`: kleines Menü mit nur "✕ Löschen"

**Keyboard:** ESC = laufendes Zeichnen abbrechen. Entf/Backspace = selektiertes Overlay löschen.

**Magnet-Modi:** normal / weak_magnet / strong_magnet (Button ⌖ in Toolbar).

**Pin-Modus:** Werkzeug bleibt nach Zeichnung aktiv (Button 📌).

### FRVP-Overlay (overlays.js)
- `needDefaultPointFigure: false` — kein automatisches Verbindungsrechteck
- Unsichtbare Hitbox (`ignoreEvent: false`, `color: rgba(0,0,0,0)`) über dem ganzen Profil → überall klickbar
- VAH/VAL = durchgezogene Linien über ganzen Zeitbereich (xLeft → xRight)
- POC = gestrichelte weisse Linie über ganzen Zeitbereich
- Kein VA-Highlight auf den Histogramm-Balken (entfernt auf User-Wunsch)
- `chart.overrideOverlay({ id, extendData })` aktualisiert Einstellungen

---

## Multi-Asset-Vergleich

- "+Vergleich"-Button in Topbar → Dropdown mit Suchfeld
- Max 6 Assets (`COMPARE_COLORS`)
- Nur Binance-USDT-Symbole (brauchen Kline-Endpoint)
- Bei Symbol-/TF-Wechsel: `reloadAllCompareData()` lädt alle Vergleiche neu
- State: `state.compareAssets = [{ id, label, color, data: [{timestamp, close}] }]`

---

## Workspace-Persistenz

`saveWorkspace()` / `loadWorkspace()` → `localStorage "tv_workspace"`:
```js
{ symbol, timeframeId, active: [...], chartType, legendCollapsed }
```
Indikator-Settings separat: `"tv4_ind_<key>"` (via settings.js). Läuft automatisch, kein Button.

---

## Gold / Worker

- Worker-URL in `js/config.js` → `WORKER_BASE_URL`
- Endpoint `/goldhistory` (Stooq XAU/USD, Daily)
- Gold nur Daily — andere TFs im Dropdown deaktiviert
- Toleranter Parser `normalizeGoldRow()` in data.js: JSON-Arrays, Wrapper, Stooq-CSV
- CORS: Worker muss `Access-Control-Allow-Origin` setzen

---

## Bekannte Grenzen / offene Roadmap

- **Zeichnungen nicht persistiert** — KLC-Overlays gehen bei Reload verloren. Nächster Schritt: `chart.getOverlays()` → JSON → localStorage → Restore.
- **FRVP VAH/VAL/POC nicht erweiterbar nach rechts** — Linien enden am rechten Ankerpunkt. TV hat "Extend Right"-Option.
- **Imbalance / Fair Value Gap** — noch nicht gebaut.
- **Orderblocks** — noch nicht gebaut.
- **Realised Price (On-Chain)** — braucht Worker-Endpoint `/realizedprice` (CoinMetrics), Worker-Code nicht geschrieben.
- **Mehrere Layouts** — aktuell nur ein Workspace (letzter Stand). Mehrere benannte Layouts wären nächster Schritt.
- **%-Suffix auf Y-Achse** — KLC hat keinen nativen Value-Formatter für Suffixe. Die Achse zeigt Prozentzahlen ohne "%" (z.B. "+23.4" statt "+23.4%"). Workaround: eigene Beschriftung auf dem Compare-Canvas.
