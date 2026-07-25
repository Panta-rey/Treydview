# TreydView — HANDOFF.md
**Stand: 25. Juli 2026 · Build m8**
Repo: github.com/Panta-rey/Treydview · Live: https://panta-rey.github.io/Treydview/
Arbeitssprache: Deutsch (de-CH, ss statt ß)

---

# ⚠️ OBERSTE REGEL: Die Desktop-Fassung ist unantastbar

Es gab eine Sitzung, in der die Mobile-Arbeit die Desktop-Ansicht zerstört hat:
Ψ-Logo entfernt, Topbar auf zwei Zeilen umgebaut, der Kerzen/Linie-Umschalter
komplett verschwunden. Wiederhergestellt wurde nur, weil Rey eine
Sicherungskopie hatte. **Das darf nie wieder passieren.**

## Die drei Gebote

**1. HTML: niemals bestehende Elemente umbauen, entfernen oder umbenennen.**
Nur ergänzen. Jedes neue Element bekommt `class="mobile-only"` oder eine
Basisregel `display:none`. Reihenfolge und Verschachtelung bestehender
Elemente bleiben, wie sie sind.

**2. CSS: jede neue Regel steht innerhalb einer `@media`-Abfrage.**
Einzige erlaubte Ausnahme: `display:none` für ein **neues** Element, dessen
Selektor nachweislich kein bestehendes Element trifft. Das muss geprüft werden.

**3. JavaScript: alles, was das Aussehen ändert, steht hinter `matchMedia`.**
Knöpfe werden nicht im HTML verschoben, sondern zur Laufzeit von
`applyMobileLayout()`. Auf dem Desktop läuft diese Funktion nie — das DOM
bleibt dort identisch zur Vorlage.

## Pflichtprüfung vor jeder Auslieferung

Diese vier Prüfungen sind nicht optional. Sie haben bereits mehrere Fehler
gefunden, bevor sie beim Nutzer ankamen.

### Prüfung 1 — Desktop-CSS unverändert
```python
def desktop_css(path):
    c = open(path, encoding='utf-8').read()
    out, depth, mq = [], 0, False
    for line in c.split('\n'):
        if '@media' in line and depth == 0: mq = True
        depth += line.count('{') - line.count('}')
        if mq and depth == 0: mq = False; continue
        if not mq: out.append(line)
    return out
# desktop_css(referenz) vs desktop_css(neu) diffen.
# Erlaubt sind nur Kommentare und display:none für neue Selektoren.
```

### Prüfung 2 — Desktop-DOM unverändert
Beide Fassungen in jsdom im **Desktop-Modus** (`matchMedia → false`) laufen
lassen und die Struktur vergleichen. Erlaubt sind nur Elemente mit
`mobile-only`. `#tbRow1` und `#bottomBar` müssen **null Kinder** haben.

### Prüfung 3 — jeder Selektor trifft ein reales Element
Alle Selektoren der Mobile-Schicht gegen ids und Klassen aus HTML **und**
zur Laufzeit erzeugte Klassen aus app.js abgleichen.
Dieser Test hat gefunden: `.gb-topbar` (heisst `.gb-status`), `.wl-row`
(heisst `.wl-item`), `.overlay-menu-item` (heisst `.om-row`),
`.sheet-backdrop` (heisst `.draw-sheet-backdrop`).

### Prüfung 4 — Mobil-Modus, jeder Knopf
jsdom mit `matchMedia → true`, jeden Knopf klicken und die **Wirkung** prüfen
(Zustand geändert? Panel offen?), nicht nur „kein Fehler".

Die Testdateien liegen unter `/home/claude/`: `harness.js`, `t-compare.js`,
`t-desktop.js`, `t-mobile.js`, `t-mobile2.js`. Sie stubben `settings.js` und
`derivatives.js` (liegen nicht im Arbeitsordner) sowie KLineCharts.

**Achtung bei den Stubs:** `Settings.get()` muss `{inputs:{},plots:[],style:{}}`
liefern, sonst meldet der Test Fehler, die es im Code nicht gibt.

---

## Projektcharakter

Zero-Build Vanilla JS, GitHub Pages, kein Bundler, kein Framework.
- Einziges Backend: Cloudflare Worker für Golddaten
  `WORKER_BASE_URL: "https://pantarey.rey-gafner.workers.dev"` — **nie überschreiben**
- Exchange-Daten direkt aus dem Browser (CORS). Von der Sandbox blockiert,
  nur im Browser testbar.
- Persistenz: localStorage, Schlüssel `tv_workspace`

## Dateien

```
index.html              HTML, Panels, Mobile-Ergänzungen
manifest.webmanifest    für «Zum Home-Bildschirm» (Vollbild-Ersatz auf iOS)
css/style.css           Desktop-Basis + Mobile-Schicht am Dateiende
js/config.js            CONFIG (Symbole, Zeitrahmen, Börsen, Indikatoren)
js/data.js              DataLayer (Binance/Coinbase/Kraken/Bybit + WS)
js/settings.js          Einstellungen je Indikator
js/indicators.js        KLC-Indikatoren
js/overlays.js          KLC-Overlays (FRVP, Fib, smcZone, AVWAP, Position)
js/patterns.js          16 Muster, Nullmodell, Block-Permutation, p-Wert
js/smc.js               FVG + Order Blocks
js/gridbot.js           Grid-Bot (Regime, Stufen, Tragfähigkeit)
js/derivatives.js       Funding, OI, L/S, Fear&Greed
js/app.js               Hauptanwendung, IIFE
js/lib/klinecharts.min.js  9.8.12, gepatcht: var St=0.2
```

## Datei-MD5 (Build m8)

| Datei | MD5 | Zeilen |
|---|---|---|
| index.html | 6fad18584a9e1220c2de02f9526b48d1 | 1036 |
| style.css | 4eab76f9e71744bb7d7a05c822b12bcd | 1112 |
| app.js | 111bca5c5016dcf8cd5902d03f499e65 | 4721 |
| manifest.webmanifest | f00d4e5b6341e6400f7b5dfb48b2e667 | 11 |
| config.js | fc6cff7fab290a246c255349f13a8fd8 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| patterns.js | e94d7c6a70b598fe1bfeecb67c4cc82c | — |

---

## Build-Abgleich — zuerst prüfen, wenn etwas „nicht wirkt"

Es gingen mehrere Runden verloren mit der Vermutung „der Browser hat gecacht".
Seitdem ist es messbar:

- `style.css` trägt `:root { --tv-build: "m8" }`
- `app.js` trägt `const TV_BUILD = "m8"`
- alle Skript- und CSS-Verweise in `index.html` tragen `?v=m8`

Beim Start liest das JS die CSS-Kennung aus:
- passt → grüne Zeile `[TreydView] Build m8 — CSS und JS aktuell.`
- passt nicht → deutliche Warnung mit beiden Ständen

**Bei jeder Auslieferung die Kennung an allen drei Stellen erhöhen.**

---

## Aufbau der Mobile-Fassung

### Hochformat
```
┌──────────────────────────────────────┐
│ F&G Fund OI    Layout WL 🌙 ⛶ ?      │  Zeile 1
│ Asset  1h  +        65'432  +0.24%   │  Zeile 2
├──────────────────────────────────────┤
│              Chart                   │
├──────────────────────────────────────┤
│  ⓘ   ✏️   🤖   📈   ▭   ↕          │  Bottom Bar
└──────────────────────────────────────┘
```

### Querformat
```
┌────┬──────────────────────────┬────┐
│    │ Asset · Intervall · Preis│    │
│ Z1 ├──────────────────────────┤ BB │
│    │          Chart           │    │
└────┴──────────────────────────┴────┘
```
Nur **Zeile 1** wird zur linken Leiste. Zeile 2 bleibt oben — dort ist sie
breit genug lesbar. Beide Seitenleisten halten Abstand über
`env(safe-area-inset-left/right)`, sonst verdeckt das Dynamic Island des
iPhone die linke Leiste. Dafür steht `viewport-fit=cover` im viewport-Meta.

Umgesetzt über feste Verankerung: `.topbar` bekommt `height:0`, die beiden
Reihen sind `position:fixed`. Variablen im Querformat-Block:
`--tv-lbar` (54px + safe-area), `--tv-rbar` (60px + safe-area), `--tv-row2` (38px).

### Wer verschiebt was
`applyMobileLayout()` in app.js, hinter `matchMedia`:
- **Zeile 1**: cycleBar · Lücke · layoutDropdown, wlToggleBtn, themeBtn,
  fullscreenBtn, faqBtn
- **Zeile 2**: assetDropdown, tfDropdown, compareDropdown · Lücke ·
  tb2Price, tb2Change
- **Bottom Bar**: indDropdown, drawSheetBtn, gridBotBtn, patternDropdown,
  smcDropdown, posToolTopBtn
- `cyclePopover` wandert an `document.body` — sonst hängt es im
  Stapelkontext der Topbar

`appendChild` verschiebt den Knoten; alle Ereignis-Handler bleiben daran.

Beschriftungen der Bottom Bar entstehen per CSS `::after` (`#indTrigger::after
{ content: "Indikatoren" }` usw.) — so bleibt das HTML der bestehenden Knöpfe
unverändert.

---

## Fallen, die schon Zeit gekostet haben

### Stapelkontext der Topbar
`.topbar` hat in der Basis `z-index:50; position:relative` und bildet damit
einen Stapelkontext. Panels darin werden auf Ebene 50 gedeckelt, der
Abdunkler auf Body-Ebene (615) legt sich darüber. Symptom: **„Der Bildschirm
wird nur dunkler, es erscheint kein Panel."**
Lösung: `.topbar { z-index: 630 }` innerhalb der Mobile-Abfrage.

### Weitergeleitete Klicks schliessen sich selbst
Ein Klick auf einen Stellvertreter-Knopf, der `trigger.click()` aufruft,
öffnet das Panel und steigt danach bis zum `document` weiter, wo der
Schliesser für Klicks ausserhalb greift — das Panel geht im selben Moment
wieder zu. **`e.stopPropagation()` ist zwingend.**

### Startabbruch legt alle folgenden Handler lahm
`renderTypeList()` schrieb auf `#typeList`, das beim Umbau entfernt worden
war. Die Ausnahme brach die Startsequenz ab, **alle** danach registrierten
Handler (Watchlist, Theme, FAQ, Vollbild, Grid Bot, L/S) fehlten.
Regel: Jede Render-Funktion steigt bei fehlendem Container still aus
(`if (!el) return;`).

### Angehängter Code landet ausserhalb der IIFE
`app.js` ist in eine IIFE gewickelt. Mit `cat >>` angehängter Code steht
**hinter** der schliessenden Klammer und sieht weder `state` noch `chart`
noch `startTool`. Neuer Code muss **vor** dem letzten `})();` eingefügt
werden. Prüfen: Klammertiefe an der Stelle muss ≥ 1 sein.

### Media-Query ohne schliessende Klammer
Ein Mobile-Block schloss nie — 353 Regeln steckten ungewollt darin, darunter
`.topbar-actions`, `.action-btn`, `.chart-legend`, `.watchlist`, `.gb-bar`
und der gesamte FAQ-Bereich. Auf dem Desktop galt davon nichts mehr.
Nach jeder CSS-Änderung: Klammerbilanz **und** „offene Media-Query am
Dateiende" prüfen.

### Klassennamen aus dem Gedächtnis
Mehrfach passiert: `.gb-topbar` statt `.gb-status`, `.wl-row` statt
`.wl-item`, `.overlay-menu-item` statt `.om-row`, `.sheet-backdrop` statt
`.draw-sheet-backdrop`. Die Regeln greifen ins Leere und niemand merkt es.
→ Prüfung 3 ist Pflicht.

### Erfundene Werkzeugnamen
Das Zeichenblatt hatte `ray`, `horizontalLine`, `verticalLine`,
`parallelChannel` — keiner davon existiert. Richtig sind `rayLine`,
`horizontalStraightLine`, `verticalStraightLine`, `parallelStraightLine`.
Das Blatt baut sich jetzt aus `DRAW_CATEGORIES`, derselben Quelle wie die
Desktop-Leiste. Nie wieder von Hand pflegen.

### Money Noodle in config.js
```js
key: "mnoodle", name: "MNOODLE", pane: "main", label: "Money Noodle", noTags: true,  // Kommentar ans Ende
```
`name`, `pane`, `label` **müssen vor** dem `//` stehen, sonst auskommentiert
und der Indikator ist unsichtbar.

---

## KLineCharts

- Version 9.8.12, lokal gepatcht: `var St=0.2` (Zoom-Untergrenze).
  Bei jedem Update erneut setzen.
- `lastValueMark` ist nur global setzbar → eigener Canvas-Renderer
  (`drawIndicatorTags`)
- `dashedValue` muss bei jedem `styles()`-Aufruf vollständig sein, sonst
  friert der Chart ein
- **Kein nativer Y-Zoom für Touch** (im Bundle verifiziert)
- `setRange` braucht alle Felder: `{from, to, range, realFrom, realTo, realRange}`
  und danach zwingend `chart.adjustPaneViewport(false, true, true, true)`
- X-Pinch macht KLC selbst via `_initPinch()` — nicht anfassen
- `convertFromPixel({x,y},{paneId})` liefert `{timestamp, dataIndex, value}`
- Vorhanden und genutzt: `getDrawPaneById`, `getAxisComponent`,
  `setAutoCalcTickFlag`, `convertToRealValue`, `getOverlayById`,
  `removeOverlay`, `createOverlay`

---

## Bedienung auf dem Handy

| Geste | Wirkung |
|---|---|
| Ein Finger waagrecht | Zeitachse verschieben (KLC selbst) |
| Ein Finger senkrecht | Preisbereich verschieben — folgt dem Finger |
| Zwei Finger | Zeitachse zoomen (KLC selbst) |
| Ein Finger auf der Preisskala | Preisachse zoomen |
| Doppeltipp auf die Preisskala | Auto-Anpassung |
| Langer Druck (~500 ms) | Kontextmenü, bei ausgewählter Zeichnung deren Stil-Menü |
| Doppeltipp bei ausgewählter Zeichnung | löschen |

**Richtung der Y-Verschiebung:** Der Chart folgt dem Finger. Nach unten
ziehen schiebt den Preisbereich nach oben, es kommen höhere Kurse ins Bild
(`from = r.from + shift`). Die erste Fassung war umgekehrt.

**Zeichnungs-Lupe:** Bei aktivem Werkzeug erscheint über dem Finger ein
88px-Ausschnitt mit 2,5-facher Vergrösserung und Fadenkreuz. Beim
Volumenprofil bewusst **unterdrückt** — dort führen die gestrichelten Linien.

**Volumenprofil (FRVP):** Finger aufsetzen, eine senkrechte gestrichelte
Linie folgt ihm, beim Anheben steht die erste Grenze. Dasselbe für die
zweite — danach wird das Profil gezeichnet. Die Handler nutzen
`stopPropagation`, damit KLC den Chart nicht mitzieht. Erstellt wird direkt
über `chart.createOverlay({name:"frvp", points:[...]})` statt über
nachgeahmte Mausereignisse.

**Vollbild:** Auf dem iPhone gibt es im Browser keine Vollbild-Schnittstelle
— weder in Safari noch in Brave. Der Knopf sagt das jetzt und verweist auf
«Teilen → Zum Home-Bildschirm». Von dort startet die App dank
`manifest.webmanifest` und der `apple-mobile-web-app-*`-Angaben ohne
Adressleiste und Reiter. Auf Android greift die echte Schnittstelle. Läuft
die App bereits ohne Browserrahmen, blendet sich der Knopf selbst aus.

---

## Grid-Bot

**ATR immer auf Tageskerzen.** `gbRefresh()` holt 210 Tageskerzen separat
(Binance `1d`, Bybit `D`, Kraken `1440`) und übergibt sie an
`gbMarketData(dailyD)`. Damit stimmen die Bereiche mit dem Excel überein,
unabhängig vom Chart-Zeitrahmen. Ohne das rechnete der Bot auf 4h-Kerzen und
lag um Faktor ~3 daneben. `market.dailyDataUsed` zeigt, ob es geklappt hat.

**Tragfähigkeit regime-abhängig.**
`viability(tier, lev, direction, holdDays, fundingAvg8h, erScore)`:
ER < 0.3 → 100 % Füllrate, 0.3–0.5 → 65 %, ≥ 0.5 → 30 %.
Vorher stand im Trend ein grüner Haken, obwohl `gridSuitability()` daneben
„Trend – Grid riskant" meldete.

**Hebel-Leitplanke:** Mayer > 2.0 oder F&G > 80 zwingt jeden Bot auf 1×.

**Abweichungen zu den Vorgaben sind meist gespeicherte Nutzerwerte**
(`state.gbTiers`), keine Fehler. Vor jeder Fehlersuche prüfen.

## Zyklus-Ampel

Reihenfolge **F&G · Fund · OI** (auf Mobile; Mayer und ER nur am Desktop).
Klick öffnet ein Popover mit Bezeichnung, Wert und Deutung, 5 s Anzeige.

| Kürzel | grün | gelb | rot |
|---|---|---|---|
| F&G | < 35 | 35–80 | > 80 |
| OI Δ30T | < −10 % | −10…+10 % | > +10 % |
| Fund 8h | < −0.01 % | −0.01…+0.05 % | > +0.05 % |
| Mayer | < 0.9 | 0.9–2.0 | > 2.0 |
| ER | < 0.3 | 0.3–0.5 | > 0.5 |

Quellen: `r.derivatives.fng / oiChange30 / funding8h`, `r.mayer`,
`r.market.er`. Nach dem ersten `loadData()` startet `gbRefresh(false)` nach
800 ms im Hintergrund, damit die Ampel ohne geöffnetes Bot-Panel Werte zeigt.

## SMC (smc.js)

- FVG-Schwelle **ATR-relativ** (`minGapAtr: 0.1`), nicht Prozent vom Preis —
  sonst ist der Filter bei 20k und 100k unterschiedlich streng
- `lastCandleOnly: true` — nur die letzte Gegenkerze vor dem Impuls ist ein
  Order Block. Drei Abwärtskerzen ergeben **einen** OB, nicht drei.
- `showFilled: true` — gefüllte Zonen sichtbar, damit die Trefferquote
  beurteilbar bleibt
- Nullmodell: `SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))`
- Rahmen: „Kontext, kein Signal" — kein Stop, kein Ziel

---

## Debug-Zugänge

```js
window.__tvDebug = true      // alle quiet()-Fehler in der Konsole
window.__tvState             // gesamter Zustand
window.__tvBuild             // JS-Kennung
window.__tvCssBuild          // tatsächlich geladene CSS-Kennung
window.__tvStartTool(name)   // Werkzeug starten
window.__tvFrvpReset()       // Volumenprofil-Geste zurücksetzen
window.__tvTestBybit(sym, interval)
```

`quiet(fn, label)` ist der zentrale Fehler-Umschlag. Mit `__tvDebug = true`
melden sich die Aussetzer mit Namen: `y-pan`, `frvp build`, `frvp gesture`,
`mobile layout`, `magnifier init`, `fullscreen`, `build check`.

---

## Offen

1. **Alles Mobile nur simuliert geprüft.** jsdom kennt kein echtes Layout.
   Rendering, Gesten und Querformat müssen auf dem Gerät nachgesehen werden.
2. **Volumenprofil-Geste**: `stopPropagation` soll KLC von der Geste
   fernhalten. Ob das auf dem Gerät durchgreift, ist offen —
   `__tvDebug = true` zeigt `frvp build`.
3. **Börsen-Schnittstellen** (Coinbase, Kraken, Bybit) von der Sandbox
   blockiert, nur im Browser prüfbar.
4. **SMC-Nullmodell** noch nie auf echten BTC-Daten gelaufen. Bei p > 0.05
   unterscheiden sich die Zonen nicht von Rauschen.
5. **Grid-Bot**: `liqDist` liegt im Ergebnis, wird im UI aber nicht gezeigt.
   Der Nettowert wächst weiterhin linear mit dem Hebel.
6. **AVWAP**: nur ein Anker gleichzeitig (KLC erlaubt eine Instanz je Name
   und Pane).
7. **Kein Journal.** Der `/cryptocouncil` nannte es das wichtigste fehlende
   Stück; Rey hat es bewusst zurückgestellt. `calibration: 1` im Grid-Bot
   zeigt deshalb auf ein Excel ausserhalb der App.

---

## Arbeitsweise

- Nur geänderte Dateien liefern, MD5 dazu
- `node -c` nach jeder JS-Änderung
- Grosse Blöcke mit Python ersetzen (`python3 << 'PYEOF'`), nicht mit
  str_replace
- Vor „das funktioniert" erst messen. Rey beschreibt Fehler sehr genau —
  „es wird nur dunkler" führte direkt zum Stapelkontext.

### Auslieferung
```powershell
cd C:\Users\rey_g\projects\treydview
Copy-Item "$env:USERPROFILE\Downloads\index.html"            ".\index.html"            -Force
Copy-Item "$env:USERPROFILE\Downloads\style.css"             ".\css\style.css"         -Force
Copy-Item "$env:USERPROFILE\Downloads\app.js"                ".\js\app.js"             -Force
Copy-Item "$env:USERPROFILE\Downloads\manifest.webmanifest"  ".\manifest.webmanifest"  -Force
git add -A
git commit -m "..."
git push
```
Bei Zurückweisung: `git pull --rebase origin main`, dann `git push`.

**HANDOFF.md bleibt lokal — nie committen.**
