# TreydView — HANDOFF.md
**Stand: 29. Juli 2026 · Build m23**
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
Falschmeldung: `#fff` aus `color:#fff` — kein Selektor. Ebenso
`className = "a " + (x ? "b" : "c")` (Ternary) und Klassen aus
`settings.js` — der Scanner muss alle Modul-Dateien einlesen.

**Noch offen (tote Regeln, seit ≤ m16, harmlos):** `.draw-btn`
(heisst `.draw-cat-btn`) und `.overlay-menu-item` (heisst `.om-row`).
Beide stehen in @media-Blöcken und greifen nirgends.

### Prüfung 4 — Mobil-Modus, jeder Knopf
jsdom mit `matchMedia → true`, jeden Knopf klicken und die **Wirkung**
prüfen, nicht nur „kein Fehler".

Prüfstand m17 unter `/home/claude/treydview-v03/`: `harness.js` (jsdom +
KLineCharts-Stub; lädt Module über **`vm.runInContext`**, weil `eval()`
Top-Level-`const` verwirft und `CONFIG` dann unsichtbar bleibt),
`t-desktop3.js` (Prüfung 2, ohne mobile-only-Zweige), `t-selectors.js`
(Prüfung 3), `t-mobile.js` (Prüfung 4 + Zieltests, 44 Prüfpunkte), `t-m18.js` (18),
`t-m19.js` (23), `t-m20.js` (31), `t-m21.js` (27, asynchron),
`t-tokens.js` (Prüfung 5), `t-m22.js` (26), `t-m23.js` (26), beide asynchron.
Rückwärtskompatibilität der Drei-Punkt-Zeichnungen: eigener Lauf, 5 Punkte.
Der Canvas-Stub protokolliert `moveTo`/`lineTo`, damit Tests das gezeichnete
Fadenkreuz auslesen können. `chart.setLoadDataCallback` muss im Stub stehen.
Kerzenabstand im Stub: 8 px.

Ältere Testdateien: `t-compare.js`,
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

## Datei-MD5 (Build m23)

| Datei | MD5 | Zeilen |
|---|---|---|
| index.html | def02115f7db6c72dcfdec4f1a3da6bd | 1073 |
| style.css | 2df3b0ae6413adf3e79152bd94c092e4 | 1348 |
| app.js | 22326b56ed7938d8e32ead72bdce9ae1 | 5912 |
| overlays.js | 616c8944e2f8e8e16d87597d920b9ce0 | 1131 |
| overlays.js | 41863e842e40478db3326d46156c2b89 | 1075 |
| manifest.webmanifest | f00d4e5b6341e6400f7b5dfb48b2e667 | 11 |
| config.js | fc6cff7fab290a246c255349f13a8fd8 | 384 |
| data.js | 0bd0ac117e6ddd750ef11de15c484893 | 368 |
| indicators.js | d5e023a59eee2c75b8d3ae0f8aebf595 | 1012 |
| overlays.js | 8a6c94e2126fda08ad3291d044a25e40 | 1014 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| patterns.js | e94d7c6a70b598fe1bfeecb67c4cc82c | — |

## Build-Abgleich — zuerst prüfen, wenn etwas „nicht wirkt"

- `style.css`: `:root { --tv-build: "m23" }`
- `app.js`: `const TV_BUILD = "m23"`
- `index.html`: alle Verweise mit `?v=m23`

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
| `positionTool` | **Fläche** von `minX` bis `maxX + 60` und über alle drei Kursniveaus (m17) |

**Warum `positionTool` eine Fläche braucht:** Auf dem Handy liegen alle drei
Anker auf demselben Zeitstempel, also auf einer einzigen senkrechten Linie.
`overlays.js` zieht Linien und Preis-Schilder aber bis `x1 = maxX + 60`
(Zeile ~702). Ein Tap auf das Stop- oder Ziel-Schild lag damit rund 56 px
neben der Ankerlinie und wurde nie erkannt. Als Rangmass dient der
senkrechte Abstand zur nächsten der drei waagrechten Linien — sonst würde
bei Überschneidung immer die Zeichnung mit dem grösseren Kasten gewinnen.

## .filter(Boolean) verschiebt Indizes  (m23 — schwerwiegend)

`findOverlayNear` baute die Pixelpunkte mit
`ov.points.map(toPx).filter(Boolean)`. Laesst sich EIN Punkt nicht
umrechnen, ruecken alle folgenden auf: `pts[3]` meint dann Punkt 5 oder
fehlt ganz. Beim Long/Short liegt der vierte Punkt 20 Kerzen rechts, oft
ausserhalb der geladenen Daten — der Breiten-Griff wurde deshalb bei
`x0 + 60` gesucht, gezeichnet aber bei `x1`. Tippen ging zwangslaeufig
daneben, in JEDER Zoomstufe.

Seit m23 gibt es **`ptsIdx`** (indexerhaltend, kann Luecken enthalten) neben
`pts` (verdichtet, nur fuer die allgemeine Linienpruefung). Alle
indexabhaengigen Zweige — FRVP, Fibonacci, positionTool — nutzen `ptsIdx`.

**Und wichtiger: die Geometrie wird nicht mehr nachgerechnet.**
`renderPosition` in `overlays.js` veroeffentlicht nach jedem Zeichnen
`window.__tvPositionBox[overlay.id] = { x0, x1, cEntry, cStop, cTarget }`.
`app.js` liest genau das. Zwei Stellen, die dieselbe Geometrie unabhaengig
ausrechnen, laufen frueher oder spaeter auseinander — hier war es ein Punkt,
der sich nicht umrechnen liess.

> **Pruefstand:** `__tvPositionBox` fuellt sich nur, wenn der Renderer
> laeuft. Am echten Chart zeichnet KLineCharts nach jeder Aenderung neu; im
> Test muss das von Hand nachgezogen werden, sonst ist die Geometrie
> veraltet und die Griffe liegen woanders.

## Griffe liegen AUSSERHALB des Kastens  (m23)

Innen gibt es keinen freien Platz: die Preis-Schilder sind rechtsbuendig und
fuellen den Kasten fast aus, der Kennzahlen-Block sitzt oben links. Mittig
lagen die Griffe auf den Prozentzahlen, am linken Innenrand auf dem
Schildanfang. Jetzt:

- Stop und Ziel: `x0 - HANDLE_R - 3` (links davor)
- Breite: `x1 + HANDLE_R + 3` (rechts daneben)
- Schilder duerfen wieder bis `x1 - 4`, Kennzahlen bis `x0 + 4`

## Desktop-Magnet auf O/H/L/C  (m23)

KLineCharts rastet beim Zeichnen nur auf der Zeitachse ein; die Preisachse
blieb frei. `performEventMoveForDrawing` ist der vorgesehene Haken — er wird
**einmal zentral** an jede Registrierung gehaengt (Wrapper um
`klinecharts.registerOverlay`), statt in zwanzig Definitionen wiederholt.

Der Haken bekommt **keine Bildschirmkoordinaten**, die Toleranz kann also
nicht in Pixeln gerechnet werden. Stattdessen ein Anteil der Kerzenspanne:
stark 45 %, schwach 18 % von (Hoch − Tief). Die Kerze liefert
`window.__tvCandleAt(timestamp)` aus `app.js`.

## Schliessknoepfe und Menue-Ebene  (m23)

Alle X-Knoepfe einheitlich **20 px** mit 34-px-Tippziel. Vorher: `.fib-close`
11 px (kaum zu treffen), `.faq-close` 13 px, `.om-close` 17 px,
`.settings-close` 16 px. Regel liegt in der Mobil-Schicht.

**Stapelung:** Schwebebalken 660, Menues **670**, Abdunkler **665**. Vorher
lagen die Menues auf 650 und oeffneten damit HINTER dem Balken. Der Balken
liegt jetzt unter dem Abdunkler und ist bei offenem Menue unantastbar.

## touch-action — die Ursache abbrechender Zuege  (m22)

Ohne `touch-action: none` reklamiert der Browser die Geste selbst (Seite
schieben, Zurueck-Wischen) und feuert **`touchcancel`** — der laufende Zug
stirbt mitten in der Bewegung und man muss nachfassen. Waagrechte Zuege wie
der Breiten-Griff wurden sofort geschluckt und schienen gar nicht zu
funktionieren; senkrechte stotterten nur.

`.main-chart, .main-chart canvas { touch-action: none }` in der
Mobil-Schicht. KLineCharts scrollt und zoomt per JavaScript — davon bleibt
das unberuehrt.

> Dieser Fehler sah wie drei verschiedene Fehler aus (Breiten-Griff kaputt,
> Ziehen stockt, Nachfassen noetig) und war einer.

## Desktop hat die Symbolgarnitur uebernommen  (m22)

**Ausdruecklich beauftragte Desktop-Aenderung — Regel 1 gilt hier NICHT.**
Betroffen ist ausschliesslich `#drawbar`; Pruefung 2 klammert den Zweig
seither aus (`BEABSICHTIGT`) und weist den Rest weiter als knotengleich nach.

- `TOOL_ICONS` liegt jetzt auf **Modulebene**, nicht mehr in `initDrawSheet`
  — das steigt auf dem Desktop frueh aus, die Leiste braucht die Symbole aber.
- Kategorie-Knoepfe zeigen das repraesentativste Werkzeugsymbol der Gruppe.
- Fly-Out bleibt **Liste** (Label + Beschreibung), bekommt links ein
  `ds-icon`. Kein Kachelraster: mit der Maus waere das ineffizienter.
- `straightLine` und `horizontalRayLine` sind jetzt auch im Desktop-Katalog
  (17 → 19 Werkzeuge).
- `parallelStraightLine` **bleibt** auf dem Desktop — das Entfernen war nie
  beauftragt.
- Referenzstand fuer Pruefung 1 und 2 ist seit m22 `ref-m21`, nicht mehr m16.

## Fibonacci-Trefferzone  (m22)

Ein Tipp zaehlt auf **jedem Level**, nicht nur nahe der zwei Anker. Die
Level-y werden linear zwischen den Ankern interpoliert (spart das Umrechnen
ueber Kurswerte), Levels aus `FIB_LEVEL_SETS`. Nach rechts laufen die Linien
240 px ueber den zweiten Anker hinaus weiter.

> **Testfalle:** Bei einem grossen Fib liegen die mittleren Levels nur
> ~35 px auseinander, die Fingertoleranz ist 26 px. Ein "dazwischen"-Punkt
> muss in die groesste Luecke gelegt werden (zwischen 0 und 0.236), sonst
> trifft er legitim ein Nachbarlevel.

## Pruefung 5 — CSS-Token  (neu in m21)

`node t-tokens.js`. Jeder benutzte `var(--x)` muss auch definiert sein.
`--bg-panel` stand seit jeher in `.draw-sheet`, war aber **nie definiert** —
`var(--bg-panel)` löst zu nichts auf, der Grund blieb durchsichtig. Weder
Prüfung 1 noch 3 konnten das sehen; der Fehler ist zweimal durchgerutscht
(einmal in der Basis, einmal von mir in m19 bei den Kacheln).

Es gibt nur **`--bg-raised`** und **`--bg-hover`**. Der Scanner blendet
Kommentare aus und akzeptiert `var(--x, ersatz)`. Die Basisregel Zeile 242
bleibt geduldet und dokumentiert: sie ist auf dem Desktop unerreichbar und
wird in der Mobil-Schicht überschrieben.

## KLineCharts zieht Overlays selbst  (m21)

Bei einer Berührung auf einem Overlay startet KLineCharts seinen **eigenen**
Zug und verschiebt ALLE Punkte — der Long/Short-Kasten wanderte deshalb mit,
statt sich am Breiten-Griff zu verbreitern. `stopPropagation` erst beim
Bewegen kommt zu spät, und KLC horcht nach dem Zugbeginn auf Dokumentebene
weiter.

Lösung: `mobileDragGuards()` liefert `onPressedMoveStart/Moving/MoveEnd`,
die `true` zurückgeben (= "verarbeitet, kein Standardverhalten"). Wird in
`buildOverlayConfig` **und** in `restoreDrawings` eingemischt, jeweils hinter
`matchMedia` — in der Registrierung (`overlays.js`) wäre es eine
Desktop-Änderung.

> **`lock: true` ist der falsche Hebel.** Es wird beim Speichern nicht
> mitgeschrieben; nach einem Neuladen wäre das Verhalten ein anderes.

**Chart-Sperre schon bei `touchstart`**, nicht erst nach den 8 px `ENGAGE` —
sonst verschieben sich X- und Y-Achse während des Anfassens. `lockedForDrag`
merkt sich das, `releaseChart()` löst bei `touchend` und `touchcancel`, auch
wenn gar kein Zug zustande kam.

> **Prüfstand-Falle:** `captureDrawing` registriert erst nach
> `setTimeout(…, 30)`. Ein synchroner Test sieht `state.drawings` leer und
> `findOverlayNear` findet nichts. Tests, die auf gezeichnete Overlays
> tippen, müssen warten.

## Long/Short-Bedienung  (m20, erweitert in m21)

**Vier Punkte.** `[Einstieg, Stop, Ziel, rechter Rand]`. Der vierte trägt nur
einen Zeitstempel; sein Kurswert ist Beiwerk. Startbreite: 20 Kerzen des
aktiven Zeitrahmens.

**Rückwärtskompatibel:** Zeichnungen aus m19 und früher haben drei Punkte.
Fehlt der vierte, fällt der Kasten auf die alte feste Breite (`maxX + 60`)
zurück. Im Prüfstand abgedeckt.

**`totalStep` bleibt 4.** Ein höherer Wert würde den Desktop-Klickfluss auf
vier Klicks umstellen — Regel 1. Der Desktop erzeugt daher weiter drei
Punkte und nutzt die Rückfallbreite; den Breiten-Griff gibt es nur auf dem
Handy, wo `expandPoints` den vierten Punkt liefert. `TOOL_POINT_COUNT` zählt
**Tipps**, nicht Punkte, und bleibt deshalb bei 3.

**Drei Griffe, sonst nichts.** `positionHandles()` in `overlays.js` ist die
einzige Quelle für ihre Lage — `app.js` ruft dieselbe Funktion für die
Treffererkennung auf, damit Gezeichnetes und Antippbares nicht
auseinanderlaufen.

| Griff | pointIndex | Bewegung |
|---|---|---|
| Stop (mittig, auf der Stop-Linie) | 1 | nur senkrecht |
| Ziel (mittig, auf der Ziel-Linie) | 2 | nur senkrecht |
| Breite (rechts, senkrecht mittig) | 3 | nur waagrecht, nie hinter den Einstieg |
| Einstieg | — | **kein Griff**, bleibt liegen |

Frisch gezeichnet heisst **nicht** ausgewählt (`done()` setzt
`selectedOverlayId = null`) — sonst stehen Beschriftungen, Kennzahlen und
Griffe sofort im Bild, obwohl niemand die Position angetippt hat.

Schwebebalken bei Long/Short: **oben links** über dem Kasten, um
`POS_INFO_H` (3 Zeilen à 15 px + 8 px) nach oben versetzt, damit er weder
den Kennzahlen-Block noch die Preis-Schilder (rechts) noch die Griffe
verdeckt. Linksbündig statt mittig. Während des Ziehens ausgeblendet,
danach neu gesetzt.

**Stop und Ziel sitzen seit m22 am LINKEN Rand** (`x0 + HANDLE_R + 2`), nicht
mittig: die Preis-Schilder sind rechtsbuendig und fuellen den Kasten fast
aus — mittige Griffe lagen genau auf den Prozentzahlen. Die Schilder enden
jetzt bei `chipRight(x1) = x1 - HANDLE_R - 8`, damit der Breiten-Griff nicht
auf der Prozentzahl sitzt; der Kennzahlen-Block rueckt um `2*HANDLE_R + 6`
nach rechts.

Griffe erscheinen nur bei ausgewählter Zeichnung. Fingertoleranz 21 px; bei
1 %/2 % liegen sie rund 45 px auseinander, überlappen also nicht.

> **`mode: null` genügt NICHT, um das Ziehen zu unterbinden.** Der Zweig in
> `touchmove` prüft `mode === "point"` und fällt sonst in die
> Alles-Verschieben-Behandlung — `null` landet dort. Der Zug darf gar nicht
> erst aufgebaut werden: `dragCandidate = null` und früher `return`.

**Beschriftungen nur bei Auswahl.** Einstieg/Stop/Ziel-Schilder und der
CRV-Block erscheinen nur, wenn angetippt. Linien und Flächen bleiben immer.

**`window.__tvSelectedId`** — `overlays.js` hat keinen Zugriff auf `state`.
Ein `Object.defineProperty`-Setter auf `state.selectedOverlayId` fängt alle
zwölf Zuweisungsstellen ab, spiegelt den Wert nach `window` und zeichnet
altes wie neues Overlay neu. Ohne dieses Neuzeichnen erschienen die Griffe
erst beim nächsten Chart-Ereignis.

## Menüs und Abdunkler  (m18)

Der Abdunkler hängt an `body.menu-open::after` (z-index 649,
`pointer-events: all`). Bleibt die Klasse liegen, ist der Bildschirm dunkel
und taub. Deshalb nie blind entfernen, sondern mit `syncMenuOpen()` aus dem
Zustand ALLER Menüs ableiten (`overlayMenu`, `frvpMenu`, `fibMenu`) — sonst
reisst das Schliessen eines Menüs den Abdunkler weg, während ein anderes
noch offen ist.

> **`#overlayMenu { position: relative }` war tödlich.** `.overlay-menu` ist
> `position: fixed`; ein ID-Selektor schlägt den Klassen-Selektor. Mit
> `relative` landete das Menü im Textfluss — unsichtbar, während der
> Abdunkler alles abfing. Das `relative` war für `.om-close` gedacht, aber
> `fixed` ist ebenfalls ein positionierter Vorfahre.

Schwebebalken über dem Fadenkreuz: `CONFIRM_BAR_GAP = 44` (vorher 16 — bei
der Polylinie sass der Balken fast auf dem Punkt, den man gerade setzte).

Long/Short-Einzelpunkte wandern nur **senkrecht**: alle drei Punkte teilen
einen Zeitstempel; verrutscht einer zeitlich, zieht `overlays.js` den Kasten
auf (`x1 = maxX + 60`) und die Zuordnung bricht.

## Zeichenwerkzeuge auf dem Handy  (m19)

`MOBILE_DRAW_GROUPS` in `initDrawSheet` — eigener Katalog, Gruppen und
Reihenfolge nach der TradingView-Zeichnungsliste. 18 Werkzeuge in fünf
Gruppen. Symbolgarnitur `TOOL_ICONS`: dünne Linien (`DS_STROKE`), hohle
Ankerpunkte (`DS_DOT`, Füllung `var(--bg-raised)`, wirkt als Loch und
stimmt in beiden Themes).

Neu und **nur auf dem Handy**, weil ein Eintrag in `DRAW_CATEGORIES`
den Desktop mitändern würde:
- `straightLine` — Verlängerte Linie, zwei Punkte, in beide Richtungen
  unendlich (KLineCharts-Bordmittel)
- `horizontalRayLine` — Horizontaler Strahl (KLineCharts-Bordmittel)

Nicht im Blatt: `positionTool` (eigener Knopf in der Bottom Bar),
`parallelStraightLine` (vom Parallelkanal abgedeckt). Beide bleiben in
`DRAW_CATEGORIES` und damit auf dem Desktop erhalten.

Neue Werkzeuge brauchen zwingend einen Eintrag in `TOOL_POINT_COUNT` —
`buildOverlayConfig` ist generisch, die Punktzahl nicht.

## Magnet  (m17 erweitert)

Rastet auf **beiden** Achsen ein: Y auf H/L/O/C der Kerze unter dem
Fadenkreuz, X gleichzeitig auf die **Mitte derselben Kerze**.

`magnetSnap(px, py)` gibt `{x, y}` zurück oder `null`. Läuft schon
**während** der Fingerbewegung, damit das Einrasten sichtbar ist.
Eingerastet wechselt das Fadenkreuz von gelb gestrichelt auf grün
durchgezogen. Fangbereich: 18 px schwach, 40 px stark.

**Kein Y-Treffer bedeutet kein X-Einrasten.** Ohne eingerastetes Kursniveau
bleibt das Fadenkreuz auf beiden Achsen frei am Finger. Ein Punkt, der auf
dem Hoch einer Kerze sitzt, soll auch waagrecht auf dieser Kerze sitzen.

`convertToPixel` liefert für einen Zeitstempel bereits die Kerzenmitte —
dieselbe Umrechnung gibt also beide Achsen in einem Schritt.

> **Messfalle beim Prüfen:** Der *gespeicherte Punkt* taugt NICHT als
> Nachweis. `convertFromPixel` rastet den Zeitstempel ohnehin auf die
> nächste Kerze — der Punkt lag also schon vor m17 zeitlich zentriert.
> Die Änderung wirkt auf das **gezeichnete Fadenkreuz**. Ein Test, der nur
> den Punkt prüft, besteht auch gegen m16 und beweist nichts. Richtig ist,
> die senkrechte Linie aus dem Canvas-Protokoll auszulesen
> (`moveTo(px, 0)` → `px / devicePixelRatio`).

## Long/Short

Auf dem Handy: Tap auf L/S → Auswahl **Long** oder **Short** (`#lsChoice`) →
Fadenkreuz für den Einstieg → ein Tap erzeugt alle drei Punkte.

Stop und Ziel aus dem **Tages-ATR** (`state.gbResult.market.atr14`, derselbe
Wert wie im Grid-Bot). Verhältnis 1:2 — Stop 1×ATR, Ziel 2×ATR. ATR statt
Prozent, weil BTC je nach Phase sehr unterschiedlich schwankt.
Rückfall ohne Bot-Ergebnis: aus 14 sichtbaren Kerzen schätzen, sonst 2 %.

**m18 — auf Prozent umgestellt (`STOP_PCT = 0.01`, `TARGET_PCT = 0.02`):**
Der ATR war theoretisch sauberer, in der Praxis unbrauchbar: bei weit
herausgezoomtem Chart ergab er **Ziel +0.01 % und Stop 0.00 %** — nicht
sichtbar und nicht greifbar. Jetzt Stop 1 %, Ziel 2 % des Einstiegs.

Sicherheitsnetz `minRiskForTouch()`, `MIN_LEG_PX = 24` (knapp über
`POINT_TOL` 20, also die echte Greifschwelle). Absichtlich NICHT höher:
bei 48 px hätte das Netz die 1 % im Normalfall auf 1.6 % hochgezogen und
die Vorgabe wäre wieder unvorhersagbar. Streckt es doch, wächst die
Belohnung im selben Verhältnis mit — 1:2 bleibt exakt.

> **Wie die ATR-Fassung gescheitert ist:** Sie bildete den Faktor aus der
> Pixeldifferenz zweier Preise. Bei sehr kleinem Abstand landen aber beide
> auf DEMSELBEN Pixel, die Differenz ist 0, und der Guard `gap > 0` liess
> den Wert unverändert durch — genau der Fall, der abgefangen werden
> sollte, fiel durch. Den Maßstab px-pro-Kurseinheit an einer **grossen**
> Messlatte bestimmen (10 %), nie an der Zieldifferenz selbst.

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

### Temporale Todeszone bei IIFEs — bricht die ganze Datei ab
`tvIsMobile` ist ein **`const` bei Zeile ~4724**. Jede IIFE, die früher in
der Datei läuft (z. B. `initDrawSheet` bei 2623), darf es NICHT aufrufen:
der Name liegt dann in der temporalen Todeszone, der Zugriff wirft
`Cannot access 'tvIsMobile' before initialization`, und weil die IIFE nicht
in `quiet()` steckt, **bricht die Auswertung der gesamten app.js ab**.
Symptom in m19: 290 Knoten fehlten, Auswahllisten leer.
In früh laufenden IIFEs die Abfrage wortgleich direkt setzen:
`window.matchMedia("(max-width: 720px), (pointer: coarse)").matches`

### Prüfung 2 kennt drei leere Mobil-Behälter — `tbRow2` ist keiner
Leer im Desktop-Modus sein MÜSSEN: `#tbRow1`, `#bottomBar`,
`#drawSheetGrid`. **`#tbRow2` gehört nicht dazu** — die Zeile trägt im
Desktop-Modus echte Inhalte (Vergleichs- und Zeitrahmen-Auswahl). Wer sie
in die Ausnahmeliste nimmt, verschiebt den ganzen Vergleich und erzeugt
über 1400 Scheinabweichungen.

### `DRAW_CATEGORIES` versorgt Desktop UND Handy
Dort etwas zu entfernen, umzusortieren oder zu ergänzen ändert die
Desktop-Leiste mit und verletzt Regel 1. Der Mobil-Katalog steht deshalb
seit m19 getrennt in `initDrawSheet` (`MOBILE_DRAW_GROUPS`).

### Gefüllte SVG-Symbole in `.ab-icon`
`.ab-icon { fill:none; stroke:currentColor }` ist eine **CSS-Regel** und
schlägt damit jedes Präsentations-Attribut am Element. `fill="currentColor"`
am `<svg>` wirkt nicht. Gefüllte Formen brauchen ein Inline-`style`
(`style="fill:currentColor;stroke:none"`) — das schlägt die Regel. Negative
Flächen (die Kerben an den Magnetpolen) nehmen `var(--bg-raised)` und
funktionieren so in beiden Themes.

### Rundungsrand bei Kerzen-Zuordnung
`convertFromPixel` rundet auf die nächste Kerze, `Math.round` rundet halbe
Werte **auf**. Ein Fingerabstand von genau der halben Kerzenbreite landet
deshalb auf der *Nachbarkerze*. In Tests immer deutlich unter die halbe
Kerzenbreite gehen — sonst sucht man einen Fehler, der keiner ist.

### Testabstände gegen ALLE vier Kursniveaus prüfen
Ein Abstand, der weit vom Hoch weg ist, kann zufällig direkt am Tief liegen
(Kerzenkörper im Prüfstand nur ~40 px hoch). Für „kein Snap erwartet"
muss der Abstand zu O, H, L **und** C ausserhalb der Toleranz liegen.

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
