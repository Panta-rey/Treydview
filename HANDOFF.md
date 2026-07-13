# TreydView — HANDOFF

Übergabe-Dokument für künftige Claude-Sessions oder andere Entwickler. Immer dann aktualisieren, wenn eine neue Session wesentliche Architekturentscheide trifft.

**Stand: Juli 2026 (nach ~15 Sessions). Letzter bekannter stabiler Commit: "Fix: Kerzen/Linie, Prozent-Achse Vergleich, FRVP-Menü"**

---

## Projekt-Kontext

TradingView-artiges Chart-Cockpit für Rey Gafner (GitHub: Panta-rey). Rein statische Web-App, kein Build-Step, direkt auf GitHub Pages. Teil der Panta-Rey-Suite (neben Metronom, BTTF, Stromschnelle).

- **Repo:** github.com/Panta-rey/Treydview
- **Live:** https://panta-rey.github.io/Treydview/
- **Lokal:** `C:\Users\rey_g\projects\treydview` (Windows, PowerShell)
- **Deploy:** `git add -A && git commit -m "..." && git push`, dann Ctrl+F5 im Browser

## Architektur-Überblick

```
index.html        Layout, CDN-Script-Tags, FRVP-Kontextmenü-HTML
css/style.css     Terminal-Theme (dark, Gold-Akzent #e8b64c)
js/config.js      Zentrale Konfiguration (Worker-URL, Symbole, TFs,
                  Indikator-Registry, Draw-Tools, Theme, hexToRgba)
js/indicators.js  Custom-Indikatoren (registerIndicator)
js/overlays.js    Custom-Zeichenwerkzeuge (registerOverlay)
js/data.js        Datenlayer: Binance REST/WS + Gold-Adapter
js/settings.js    Settings-Modal (Inputs/Style-Tabs, localStorage)
js/app.js         Verdrahtung: Chart-Init, State, alle UI-Logik
```

**Chart-Engine:** KLineCharts 9.8.12 via unpkg CDN (UMD, `window.klinecharts`). Apache 2.0, kein TradingView-Branding. Bewusste Wahl in v0.2.

**Timestamps:** KLineCharts erwartet Millisekunden. Binance liefert ms, Gold-Adapter konvertiert.

---

## Kritischer Bugfix-Hintergrund (lesen vor indicators.js-Änderungen)

**Der Crash `Cannot read properties of undefined (reading '0')`** (eingefrorenes Chart) passiert in KLineCharts' internem Linien-Merge (Zeile ~8028 im Bundle): `lastMergeLine.styles.dashedValue[0]`. Wenn irgendwo ein `styles`-Objekt **ohne `dashedValue`** zurückgegeben wird, crasht der Render-Loop und friert das Chart ein.

**Regel:** JEDER `styles()`-Callback in indicators.js UND jeder `lineStyle`-Block in buildCreate (app.js) MUSS vollständige Objekte liefern:
```js
{ style: "solid", color: "...", size: 1, smooth: false, dashedValue: [2, 2] }
```
Gemini hat das im Juli 2026 korrekt gefixt (dashedValue in plotStyle + allen lineStyle-Blöcken + Draw-Overlay-Styles). Mein headless jsdom-Test konnte diesen Crash nie reproduzieren — er tritt nur im echten Browser-Rendering auf.

**plotStyle()-Funktion** (indicators.js) enthält den Fix. Wenn du neue figures oder lineStyle-Blöcke hinzufügst: immer `dashedValue: [2, 2]` dazugeben.

---

## Indikator-System

### Registrierte Custom-Indikatoren (indicators.js)
| Name | KLC-Key | Pane | Beschreibung |
|------|---------|------|--------------|
| MNOODLE | `MNOODLE` | main | Money Noodle: EMA 12/21/35 + ATR-Band. **Fast-EMA default unsichtbar** — unsichtbare Plots NICHT als transparente Linie ausgeben (zersplittert Merge, friert ein). Sichtbarkeit via `extendData.plots[key].visible` steuern. |
| BMSB | `BMSB` | main | Bull Market Support Band: 20 SMA + 21 EMA auf Chart-TF, Close. Kein Wochen-Resampling. |
| HULL | `HULL` | main | Hull Suite 55, trendgefärbt. |
| RVWAP | `RVWAP` | main | Rolling VWAP 365 Tage. Auf 15m/1h leer (Fenster > 1000 Candles), bewusst. |
| GC | `GC` | main | Gaussian Channel 144/1.414/4 (Donovan Wall). **Hat `draw`-Callback** für den Kanal-Fill (grün/rot). Nutzt `indicator.result` für die Fill-Koordinaten. |
| STOCHRSI | `STOCHRSI` | sub | Stochastic RSI: K/D + konstante Referenzlinien 20/50/80 als figure-Serien. |
| COMPARE | `COMPARE` | main | Multi-Asset-Vergleich. Liest `window.__tvCompareAssets` (in app.js gepflegt). Gibt echte Preise aus — KLC percentage-Achse normalisiert selbst. |

**Built-in KLC-Indikatoren** (werden direkt via `chart.createIndicator` erstellt): EMA, BOLL, RSI, VOL. Ihre Styles werden über `create.styles.lines[]` in `buildCreate()` (app.js) gesetzt — auch dort `dashedValue` nicht vergessen.

### Settings-Schema (config.js)
Jeder Indikator hat `inputs` (Berechnungsparameter) und `plots` (Darstellung). Settings.get(key) liefert:
```js
{
  inputs: { period: 14, ... },
  plots: { line: { hex: "#c792ea", opacity: 100, color: "rgba(199,146,234,1)", width: 2, visible: true } }
}
```
Persistenz: `localStorage "tv4_ind_<key>"`.

---

## VRVP (Volume-at-Price)

**VRVP ist KEIN KLC-Indikator**, sondern ein transparentes Canvas-Overlay über `#mainChart` (`ensureVrvpCanvas()` + `drawVrvp()` in app.js). Gründe: KLC kann keine horizontalen Volume-Balken zeichnen.

- **Rendering**: `drawVrvp()` bei jedem `onVisibleRangeChange` (requestAnimationFrame, in try/catch)
- **Preis → Pixel**: `chart.convertToPixel({ value }, { paneId: "candle_pane", absolute: true })`
- **Clip-Region**: `chart.getSize("candle_pane")` liefert `{top, height}` → clip beschränkt VRVP auf candle_pane, ragt nicht in Sub-Panes
- **Abstand zur Achse**: `rightGap = 96px` (Balken wachsen von `rightEdge = w - 96` nach links)

---

## Multi-Asset-Vergleich (Compare)

Sobald Vergleichs-Assets aktiv sind:
1. `window.__tvCompareAssets = [{id, label, color, data: [{timestamp, close}]}]` gesetzt
2. `COMPARE`-Indikator auf `candle_pane` erstellt
3. `chart.setPaneOptions({ id: "candle_pane", axis: { name: "percentage" } })` → Y-Achse auf Prozent
4. Beim Entfernen aller Vergleiche: `axis: { name: "normal" }` zurück

Max 6 Assets (COMPARE_COLORS). Nur Binance-Symbole unterstützt (brauchen Kline-Endpoint). Vergleichsdaten gehen bei Symbol-/TF-Wechsel automatisch neu laden (`reloadAllCompareData()`).

**Warum echte Preise statt normalisierte im Indikator:** Im percentage-Modus normalisiert KLC selbst. Früher wurden die Preise auf die BTC-Skala projiziert (falsch) — Geminis app.js wechselt die Achse stattdessen global.

---

## FRVP (Fixed Range Volume Profile)

Custom-Overlay in overlays.js (`registerOverlay`, name: `"frvp"`). Zwei Punkte spannen Zeitbereich auf, Volumen-Histogramm wird in `createPointFigures` berechnet. Candle-Daten via `window.__tvGetDataList = () => chart.getDataList()`.

**Rechtsklick-Menü**: `onRightClick` in `startTool()` (app.js) verdrahtet → `openFrvpMenu()` → Panel mit Row Size, Value Area %, Breite %. Änderungen via `chart.overrideOverlay({ id, extendData })`.

---

## Workspace-Persistenz

`saveWorkspace()` / `loadWorkspace()` in app.js schreiben/lesen `localStorage "tv_workspace"`:
```js
{ symbol, timeframeId, active: [...], chartType, legendCollapsed }
```
Aufgerufen bei: Symbol-Wahl, TF-Wahl, Indikator-Toggle, Chart-Typ, Legende-Toggle. Indikator-Settings separat unter `"tv4_ind_<key>"` (via settings.js).

---

## Bekannte Bugs / Stolperstellen

1. **Double-Event-Handler:** Wenn app.js Code außerhalb der zentralen `initDropdowns()`-Funktion einen zweiten Click-Handler auf ein Dropdown-Trigger setzt, heben sie sich gegenseitig auf (Toggle-Effekt: öffnet sofort wieder zu). War Bug mit `initTypeDropdown` in Geminis Version. Fix: alle Dropdowns in `initDropdowns()` mit dem einheitlichen `["assetDropdown", "compareDropdown", "tfDropdown", "typeDropdown", "indDropdown"]`-Loop.

2. **headless jsdom-Test deckt Browser-Crashes nicht ab:** Der `dashedValue`-Crash und andere Rendering-Bugs treten nur im echten Browser auf. Wenn der Chart einfriert: Konsole öffnen (F12), Fehlermeldung mit Dateizeile weitergeben.

3. **Gold (XAUUSD) nur Daily:** Worker-Endpoint `/goldhistory` liefert nur Daily-Daten. Andere TFs im Dropdown deaktiviert, wenn Gold gewählt. Worker-URL muss in `js/config.js` gesetzt sein.

4. **RVWAP auf kurzem TF leer:** Rolling VWAP 365d braucht 365 Tage × Bars. Auf 15m/1h übersteigt das die 1000 geladenen Candles. Leer = bewusst, nicht Fehler.

5. **Zeichnungen sind flüchtig:** KLC-Overlays werden nicht persistiert. Sollen sie über Reload erhalten bleiben, müssen sie serialisiert (`chart.getOverlays()`) und restauriert werden — noch nicht gebaut.

6. **FRVP `overrideOverlay` Timing:** Nach `overrideOverlay` zeichnet KLC das Overlay neu. Falls `createPointFigures` zu diesem Zeitpunkt noch keine vollständige Daten hat, kann es leer bleiben. Workaround: Overlay nach kurzer Verzögerung neu abrufen (bisher kein gemeldetes Problem).

---

## User-Kontext

- Rey kommuniziert auf Deutsch (de-CH, **ss statt ß**)
- Git/PowerShell-Anfänger: Befehle immer einzeln, copy-paste-fertig
- Beim Entpacken von ZIPs geht `.git` verloren → `git init` + `--force`-Push nötig; besser: nur einzelne Dateien kopieren
- Immer nur geänderte Dateien liefern, kein ZIP. HANDOFF nur auf Anfrage.
- Referenz für Aussehen: TradingView-Screenshots. Er will TreydView schrittweise angleichen.

---

## Offene Roadmap (User-gewünscht, noch nicht gebaut)

- **Imbalance / Fair Value Gap**: 3-Candle-Pattern-Detection + Box-Rendering
- **Orderblocks**: Letzte Gegenkerze vor Impulsbewegung, Box-Rendering
- **Realised Price (On-Chain)**: Braucht Worker-Endpoint `/realizedprice` (CoinMetrics Community API, KV-Cache) — Worker-Code nicht geschrieben
- **Zeichnungen persistieren**: `chart.getOverlays()` → JSON → localStorage → Restore beim Start
- **FRVP VAH/VAL/POC-Linien**: Im Rechtsklick-Menü konfigurierbar (wie TradingView: VAH orange, VAL orange, POC weiss gestrichelt)
- **Mehrere Layouts speichern**: Aktuell nur ein Workspace (letzter Stand). Mehrere benannte Layouts mit Umschalter wären nächster Schritt
