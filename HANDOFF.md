# TreydView — HANDOFF.md
**Stand: 29. Juli 2026 · Build m16**
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
Selektor nachweislich kein bestehendes Element trifft.

> **Spezifitäts-Falle:** Eine Basisregel `#neuesElement { display:none }`
> schlägt eine Mobile-Regel `.neue-klasse { display:flex }`, weil ID stärker
> ist als Klasse. Das Mobile-Gegenstück muss dann ebenfalls die ID nennen.
> Genau das ist beim `#drawConfirmBar` passiert.

**3. JavaScript: alles, was das Aussehen ändert, steht hinter `matchMedia`.**
Knöpfe werden nicht im HTML verschoben, sondern zur Laufzeit von
`applyMobileLayout()`. Auf dem Desktop läuft diese Funktion nie.

## Pflichtprüfung vor jeder Auslieferung

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
```

### Prüfung 2 — Desktop-DOM unverändert
Beide Fassungen in jsdom im **Desktop-Modus** (`matchMedia → false`) laufen
lassen und die Struktur vergleichen. Erlaubt sind nur `mobile-only`-Elemente.
`#tbRow1` und `#bottomBar` müssen **null Kinder** haben.

### Prüfung 3 — jeder Selektor trifft ein reales Element
Alle Selektoren der Mobile-Schicht gegen ids und Klassen aus HTML **und**
zur Laufzeit erzeugte Klassen aus app.js abgleichen.
Gefunden hat dieser Test: `.gb-topbar` (heisst `.gb-status`), `.wl-row`
(heisst `.wl-item`), `.overlay-menu-item` (heisst `.om-row`),
`.sheet-backdrop` (heisst `.draw-sheet-backdrop`).
Falschmeldung: `#fff` aus `color:#fff` — kein Selektor.

### Prüfung 4 — Mobil-Modus, jeder Knopf
jsdom mit `matchMedia → true`, jeden Knopf klicken und die **Wirkung**
prüfen, nicht nur „kein Fehler".

Testdateien unter `/home/claude/`: `harness.js`, `t-compare.js`,
`t-desktop.js`, `t-mobile2.js`, `t-rebuild.js` (Fadenkreuz),
`t-rebuild2.js` (Auswahl/Verschieben), `t-rebuild4.js` (kein Drag ohne
Vorauswahl), `t-frvp-select.js`, `t-neu.js` (Magnet, Linien-Trefferzone,
Ein-Tap-Löschen, Polylinie, Long/Short).

**Stub-Fallen:** `Settings.get()` muss `{inputs:{},plots:[],style:{}}`
liefern. Der Canvas-Stub braucht `strokeRect` und `arc`. `getBoundingClientRect`
in jsdom liefert überall 0 — muss je Test überschrieben werden, sonst fällt
jeder Punkt in die Preisskala-Zone (`x > width - 80`).

---

## Projektcharakter

Zero-Build Vanilla JS, GitHub Pages, kein Bundler, kein Framework.
- Einziges Backend: Cloudflare Worker für Golddaten
  `WORKER_BASE_URL: "https://pantarey.rey-gafner.workers.dev"` — **nie überschreiben**
- Exchange-Daten direkt aus dem Browser (CORS), nur im Browser testbar
- Persistenz: localStorage, Schlüssel `tv_workspace`

## Datei-MD5 (Build m16)

| Datei | MD5 | Zeilen |
|---|---|---|
| index.html | 12e499fcc2751997d647739f5e77dbf3 | 1066 |
| style.css | e0b4adc2c93fc5d62942ad7d2bc4775c | 1255 |
| app.js | 7bafcefc60bc2107f60c7ce501b8f556 | 5493 |
| manifest.webmanifest | f00d4e5b6341e6400f7b5dfb48b2e667 | 11 |
| config.js | fc6cff7fab290a246c255349f13a8fd8 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| patterns.js | e94d7c6a70b598fe1bfeecb67c4cc82c | — |

## Build-Abgleich — zuerst prüfen, wenn etwas „nicht wirkt"

- `style.css`: `:root { --tv-build: "m16" }`
- `app.js`: `const TV_BUILD = "m16"`
- `index.html`: alle Verweise mit `?v=m16`

Beim Start liest das JS die CSS-Kennung aus und meldet grün oder warnt.
**Bei jeder Auslieferung an allen drei Stellen erhöhen.**

---

# Das Zeichen-System auf dem Handy

Über fünf Sitzungen hinweg gescheitert, weil Zeichnen, Auswählen und
Verschieben sich denselben Touch-Strom teilten und per Zeitfenster und
Bewegungsschwellen erraten mussten, welche Geste gemeint war. Jeder Fix an
einer Stelle verschob das Problem an eine andere.

**Die Lösung ist TradingViews Modell: die drei Zustände schliessen sich
strukturell aus.**

## 1. Neu zeichnen — `startMobilePointTool()`

`state.activeTool` ist gesetzt. Der Fadenkreuz-Canvas liegt über dem Chart,
alle vier Touch-Handler laufen in der **Capture-Phase mit
`stopPropagation`** — KLineCharts sieht den Finger nie.

- **Ziehen** bewegt nur das Fadenkreuz (120 px über dem Finger), committet nichts
- **Kurzer Tap** (Bewegung < 8 px) setzt den Punkt im Fadenkreuz-Zentrum
- Overlay entsteht erst am Ende über `chart.createOverlay({name, points})`

> **Kernpunkt:** KLCs eigener interaktiver Klick-Modus (`createOverlay` ohne
> `points`) wird auf dem Handy **nie** benutzt. Er hört auf dieselben
> Touch-Ereignisse wie jede App-Geste. Alle früheren Versuche, ihn mit
> synthetischen Maus-Ereignissen zu füttern, sind daran gescheitert, dass er
> parallel auf den echten Finger reagierte.

**Punktzahl je Werkzeug:** `TOOL_POINT_COUNT`. `polyline: Infinity` — wird
über den ✓-Knopf abgeschlossen, der ab dem zweiten Punkt erscheint.

**Optionen** (3. Argument): `needPoints` (weniger abfragen als das Overlay
bekommt), `hint` (Startmeldung), `expandPoints(pts)` (aus den gesammelten
Punkten die endgültigen machen), `done(id)`.

**Canvas-Position:** Das Canvas wird zur Laufzeit per `host.appendChild()` in
`#mainChart` gehängt. Als Geschwister im `.chart-col` bezöge sich sein
`position:absolute` auf dessen Kasten — inklusive Statusleiste — und das
Fadenkreuz läge senkrecht versetzt.

## 2. Auswählen — Tap auf eine Zeichnung

Kein Werkzeug aktiv. Ein Tap sucht über `findOverlayNear()` und zeigt den
Aktionsbalken (`#drawActionBar`) mit Stil- und Löschen-Symbol darüber.

## 3. Verschieben — nur bei bereits ausgewählter Zeichnung

**Der entscheidende Kniff:** Der Drag-Kandidat wird beim `touchstart` nur
gesetzt, wenn die berührte Zeichnung **schon vorher** ausgewählt war. Der
erste Kontakt mit einer unselektierten Zeichnung kann niemals verschieben,
egal wie stark die Bewegung. Damit gibt es nichts mehr zu erraten.

Trifft der Griff einen Punkt (≤ 20 px), wandert nur dieser; sonst die ganze
Zeichnung. Während des Drags sperrt `window.__tvChartLock(true)` Scroll und
Zoom über KLCs eigene Schnittstelle.

## `findOverlayNear(x, y, lineTol, pointTol)`

KLC bietet keine `getOverlays()`-API — die Funktion iteriert über
`state.drawings`, `patternOverlayIds`, `smcOverlayIds`, `gbBandIds`.

Drei Sonderfälle, weil die Ankerpunkte nicht dort liegen, wo man hintippt:

| Typ | Trefferzone |
|---|---|
| `frvp` | **Fläche** zwischen den Zeitgrenzen, Höhe egal — beide Ankerpunkte liegen auf der Bildschirmmitte, die Balken über dem ganzen Kursbereich |
| `horizontalStraightLine`, `priceLine`, `horizontalRayLine` | waagrechter Abstand egal, nur `|y − Linie|` |
| `verticalStraightLine`, `verticalRayLine` | senkrechter Abstand egal, nur `|x − Linie|` |
| `rayLine` | Segment nach vorn verlängert (`t ≥ 0`) |

## Magnet

Rastet **ausschliesslich auf der Preisachse** ein — auf H/L/O/C der Kerze
unter dem Fadenkreuz. Die Zeitachse bleibt frei am Finger.

`magnetSnapY(px, py)` läuft schon **während** der Fingerbewegung, damit das
Einrasten sichtbar ist. Eingerastet wechselt das Fadenkreuz von gelb
gestrichelt auf grün durchgezogen. Fangbereich: 18 px schwach, 40 px stark.

## Long/Short

Auf dem Handy: Tap auf L/S → Auswahl **Long** oder **Short** (`#lsChoice`) →
Fadenkreuz für den Einstieg → ein Tap erzeugt alle drei Punkte.

Stop und Ziel aus dem **Tages-ATR** (`state.gbResult.market.atr14`, derselbe
Wert wie im Grid-Bot). Verhältnis 1:2 — Stop 1×ATR, Ziel 2×ATR. ATR statt
Prozent, weil BTC je nach Phase sehr unterschiedlich schwankt.
Rückfall ohne Bot-Ergebnis: aus 14 sichtbaren Kerzen schätzen, sonst 2 %.

Punktreihenfolge des Overlays: `[Einstieg, Stop, Ziel]`. Die Richtung leitet
`positionTool` aus `stop < entry` ab.

Am Desktop bleibt der Weg mit drei Klicks unverändert.

## Knöpfe auf schwebenden Balken

`touchend` **und** `click` binden, im `touchend` `preventDefault` +
`stopPropagation`, und über ein `handled`-Flag (400 ms) doppeltes Auslösen
verhindern. Auf iOS feuert `touchstart` vor `click` — der Abwahl-Listener auf
`document` schloss den Balken sonst, bevor der Klick ankam. **Das war der
Grund, warum Löschen zwei Taps brauchte.**

---

## Fallen, die schon Zeit gekostet haben

### Stapelkontext der Topbar
`.topbar` hat `z-index:50; position:relative` und bildet einen Stapelkontext.
Panels darin werden auf Ebene 50 gedeckelt, der Abdunkler auf Body-Ebene
(615) legt sich darüber. Symptom: **„Der Bildschirm wird nur dunkler."**
Lösung: `.topbar { z-index: 630 }` in der Mobile-Abfrage.

### Weitergeleitete Klicks schliessen sich selbst
Ein Stellvertreter-Knopf, der `trigger.click()` aufruft, öffnet das Panel;
derselbe Klick steigt zum `document` und der Schliesser greift.
**`e.stopPropagation()` ist zwingend.**

### Startabbruch legt alle folgenden Handler lahm
`renderTypeList()` schrieb auf ein entferntes `#typeList`. Die Ausnahme brach
die Startsequenz ab, **alle** danach registrierten Handler fehlten.
Regel: Jede Render-Funktion steigt bei fehlendem Container still aus.

### Angehängter Code landet ausserhalb der IIFE
`app.js` ist in eine IIFE gewickelt. Mit `cat >>` angehängter Code steht
hinter der schliessenden Klammer und sieht weder `state` noch `chart`.
Neuer Code muss **vor** dem letzten `})();` stehen — Klammertiefe ≥ 1 prüfen.

### Media-Query ohne schliessende Klammer
Ein Block schloss nie — 353 Regeln steckten ungewollt darin. Nach jeder
CSS-Änderung Klammerbilanz **und** „offene Media-Query am Dateiende" prüfen.

### Klassennamen aus dem Gedächtnis
`.gb-topbar` → `.gb-status`, `.wl-row` → `.wl-item`, `.overlay-menu-item` →
`.om-row`, `.sheet-backdrop` → `.draw-sheet-backdrop`. → Prüfung 3 ist Pflicht.

### Erfundene Werkzeugnamen
`ray`, `horizontalLine`, `verticalLine`, `parallelChannel` existieren nicht.
Richtig: `rayLine`, `horizontalStraightLine`, `verticalStraightLine`,
`parallelStraightLine`. Das Zeichenblatt baut aus `DRAW_CATEGORIES`.

### Vollbild auf dem iPhone
Existiert im Browser nicht — weder Safari noch Brave. Der Knopf leistet
**Auto-Zoom**. Randlos läuft die App nur über «Teilen → Zum Home-Bildschirm»
(`manifest.webmanifest` + `apple-mobile-web-app-*`).

### Money Noodle in config.js
`name`, `pane`, `label` müssen **vor** dem `//` stehen, sonst auskommentiert.

---

## KLineCharts

- Version 9.8.12, gepatcht: `var St=0.2`. Bei jedem Update erneut setzen.
- **Hört `touchstart/move/end` und `mousedown/up`, aber KEINE PointerEvents**
  (im Bundle geprüft). Registriert direkt auf `#mainChart` — dasselbe Element
  wie eigene Handler, im Bubble-Modus. Capture-Phase läuft davor.
- `lastValueMark` nur global setzbar → eigener Canvas-Renderer
- `setRange` braucht alle Felder, danach `chart.adjustPaneViewport(false,true,true,true)`
- Kein nativer Y-Zoom für Touch
- `convertFromPixel({x,y},{paneId})` → `{timestamp, dataIndex, value}` (kein Array)
- `convertToPixel` kann ein Array liefern → immer `Array.isArray()` prüfen
- Vorhanden: `getDrawPaneById`, `getAxisComponent`, `setAutoCalcTickFlag`,
  `convertToRealValue`, `getOverlayById`, `removeOverlay`, `createOverlay`,
  `overrideOverlay`, `setScrollEnabled`, `setZoomEnabled`

---

## Aufbau der Mobile-Fassung

### Hochformat
```
┌──────────────────────────────────────┐
│ F&G Fund OI    Layout WL 🌙 ⛶ ?      │  tbRow1
│ Asset  1h  +        65'432  +0.24%   │  tbRow2
├──────────────────────────────────────┤
│              Chart                   │
├──────────────────────────────────────┤
│  ⓘ  ✏️  🤖  📈  ▭  🧲  ↕           │  Bottom Bar (nur Symbole)
└──────────────────────────────────────┘
```

### Querformat
Nur **tbRow1** wird zur linken Leiste, tbRow2 bleibt oben, Bottom Bar wird
zur rechten Leiste. `env(safe-area-inset-*)` hält Abstand zum Dynamic Island,
dafür `viewport-fit=cover` im viewport-Meta.

Variablen: `--tv-safe-b`, `--tv-botbar`, `--tv-topbar`, `--tv-lbar`,
`--tv-rbar`, `--tv-row2`.

### Statusleiste
Darf über mehrere Zeilen wachsen (`white-space: normal`). Ein ResizeObserver
darauf ruft `resize()`, sonst behält die Zeichenfläche die alte Höhe und die
Zeitachse verschwindet dahinter. `.main-chart { min-height: 160px }` auf
Mobile, damit sie überhaupt nachgeben kann.

### Wer verschiebt was
`applyMobileLayout()`, hinter `matchMedia`:
- **tbRow1**: cycleBar · Lücke · layoutDropdown, wlToggleBtn, themeBtn, fullscreenBtn, faqBtn
- **tbRow2**: assetDropdown, tfDropdown, compareDropdown · Lücke · tb2Price, tb2Change
- **Bottom Bar**: indDropdown, drawSheetBtn, gridBotBtn, patternDropdown, smcDropdown, magnetBbBtn, posToolTopBtn
- `cyclePopover` → `document.body` (Stapelkontext)

`appendChild` verschiebt den Knoten; Handler bleiben daran.

---

## Bedienung auf dem Handy

| Geste | Wirkung |
|---|---|
| Ein Finger waagrecht | Zeitachse verschieben (KLC) |
| Ein Finger senkrecht | Preisbereich verschieben — folgt dem Finger |
| Zwei Finger | Zeitachse zoomen (KLC) |
| Finger auf der Preisskala | Preisachse zoomen |
| Doppeltipp Preisskala | Auto-Anpassung |
| **Tap auf Zeichnung** | auswählen, Aktionsbalken erscheint |
| **Tap + ziehen auf ausgewählter Zeichnung** | verschieben (Punkt oder ganz) |
| **Tap ins Leere** | Auswahl aufheben |
| **Fadenkreuz ziehen, dann tippen** | Punkt setzen |

Der **lange Druck** wurde bewusst verworfen — er kollidierte mit dem
Verschieben und war redundant zum Tap.

**Volumenprofil (FRVP):** eigener Weg mit zwei gestrichelten Grenzlinien
(`#frvpGuideA/B`), nicht über das Fadenkreuz-System.

---

## Grid-Bot

**ATR immer auf Tageskerzen.** `gbRefresh()` holt 210 Tageskerzen separat
(Binance `1d`, Bybit `D`, Kraken `1440`) und übergibt sie an
`gbMarketData(dailyD)`. Ohne das rechnete der Bot auf 4h-Kerzen und lag um
Faktor ~3 daneben. `market.dailyDataUsed` zeigt, ob es geklappt hat.

**Tragfähigkeit regime-abhängig:** ER < 0.3 → 100 % Füllrate, 0.3–0.5 → 65 %,
≥ 0.5 → 30 %.

**Hebel-Leitplanke:** Mayer > 2.0 oder F&G > 80 zwingt jeden Bot auf 1×.

**Abweichungen sind meist gespeicherte Nutzerwerte** (`state.gbTiers`), keine
Fehler. Vor jeder Fehlersuche prüfen.

## Zyklus-Ampel

Reihenfolge **F&G · Fund · OI** (Mobile; Mayer und ER nur am Desktop).

| Kürzel | grün | gelb | rot |
|---|---|---|---|
| F&G | < 35 | 35–80 | > 80 |
| OI Δ30T | < −10 % | −10…+10 % | > +10 % |
| Fund 8h | < −0.01 % | −0.01…+0.05 % | > +0.05 % |
| Mayer | < 0.9 | 0.9–2.0 | > 2.0 |
| ER | < 0.3 | 0.3–0.5 | > 0.5 |

Nach dem ersten `loadData()` startet `gbRefresh(false)` nach 800 ms, damit die
Ampel ohne geöffnetes Bot-Panel Werte zeigt.

## SMC

- FVG-Schwelle **ATR-relativ** (`minGapAtr: 0.1`), nicht Prozent vom Preis
- `lastCandleOnly: true` — nur die letzte Gegenkerze ist ein Order Block
- `showFilled: true`
- Nullmodell: `SMC.nullTest(chart.getDataList(), {}).then(r => console.log(r))`
- Rahmen: „Kontext, kein Signal"

---

## Debug-Zugänge

```js
window.__tvDebug = true      // alle quiet()-Fehler in der Konsole
window.__tvState             // gesamter Zustand
window.__tvBuild             // JS-Kennung
window.__tvCssBuild          // tatsächlich geladene CSS-Kennung
window.__tvStartTool(name)   // Werkzeug starten
window.__tvChartLock(bool)   // Chart sperren/freigeben
window.__tvFrvpReset()       // Volumenprofil-Geste zurücksetzen
```

Namen der `quiet()`-Umschläge: `crosshair init`, `drawing select init`,
`ls choice init`, `drawing drag`, `drag persist`, `y-pan`, `frvp build`,
`mobile layout`, `magnet bb btn`, `autozoom btn`, `statusline resize`,
`build check`, `mobile draw onDrawEnd`, `mobile draw done`.

---

## Offen

1. **Alles Mobile nur simuliert geprüft.** jsdom kennt kein echtes Layout.
   Rendering, Gesten und Querformat müssen auf dem Gerät nachgesehen werden.
2. **Verschiebepunkte für Stop und Ziel** sind noch nicht sichtbar markiert.
   Das Ziehen funktioniert (Punkt-Treffer ≤ 20 px), aber `positionTool` hat
   `needDefaultPointFigure: false` — es zeichnet keine Griffe. Für sichtbare
   Griffe bei Auswahl müsste `createPointFigures` in overlays.js ein Flag aus
   `extendData` lesen, das beim Auswählen gesetzt wird.
3. **Börsen-Schnittstellen** (Coinbase, Kraken, Bybit) von der Sandbox
   blockiert, nur im Browser prüfbar.
4. **SMC-Nullmodell** nie auf echten BTC-Daten gelaufen.
5. **Grid-Bot**: `liqDist` wird im UI nicht gezeigt; Nettowert wächst linear
   mit dem Hebel.
6. **AVWAP**: nur ein Anker gleichzeitig.
7. **Kein Journal** — bewusst zurückgestellt.

---

## Arbeitsweise

- Nur geänderte Dateien liefern, MD5 dazu
- `node -c` nach jeder JS-Änderung
- Grosse Blöcke mit Python ersetzen (`python3 << 'PYEOF'`), nicht str_replace
- Vor „das funktioniert" erst messen. Rey beschreibt Fehler sehr genau —
  „es wird nur dunkler" führte direkt zum Stapelkontext, „zwei Taps zum
  Löschen" direkt zur iOS-Ereignisreihenfolge.

### Auslieferung (Mac)
```bash
cd ~/treydview
cp ~/Downloads/index.html            index.html
cp ~/Downloads/style.css             css/style.css
cp ~/Downloads/app.js                js/app.js
cp ~/Downloads/manifest.webmanifest  manifest.webmanifest
git add -A
git commit -m "..."
git push
```
Bei Zurückweisung: `git pull --rebase origin main`, dann `git push`.
GitHub braucht einen Personal Access Token statt Passwort;
`git config --global credential.helper osxkeychain` speichert ihn.

**Nach jedem Deploy:** Website auf dem Home-Bildschirm löschen und neu
hinzufügen, sonst liefert iOS die alte Fassung aus.

**HANDOFF.md bleibt lokal — nie committen.**
