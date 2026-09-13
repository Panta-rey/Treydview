# HANDOFF — Build m83 (an HANDOFF.md anhängen, NIE committen)

Basis: m82. Geänderte Dateien (3): `app.js` (Fix), `style.css` (nur Build-Tag),
`index.html` (nur `?v=`). Build m82 → **m83**.

## barPattern — 1:1-Höhen-Kopie (Kerzen + Linien)
Ursache der Stauchung: sobald die gezeichnete Box ≥12px hoch ist, skaliert das
Overlay das Abbild in die Box-Höhe (`priceToY = yB − ((p−pMin)/(pMax−pMin))×boxH`)
statt die natürliche Preisspanne zu behalten. Da man die Box fast nie exakt auf
die natürliche Spanne zieht, wurde das Muster gestaucht.

Fix im barPattern-onDrawEnd: aus den Quell-Kerzen (srcStart–srcEnd) die natürliche
Preisspanne bestimmen (Kerzen: low/high, Linie: close) und die Box-Höhe darauf
setzen — Box-Mitte + X-Position bleiben, wo gezeichnet. Da overrideOverlay Punkte
nicht ändert, wird das Overlay mit korrigierten Y-Punkten neu erstellt (analog
positionTool-Expand). Danach ist die Kopie massstabsgetreu, aber weiterhin frei
skalierbar. Fallback (kein Slice ermittelbar): altes Verhalten (nur extendData).

Test: korrigierte Box-Höhe == natürliche Höhe (45px == 45px, 1:1).

## Prüfungen
node -c alle · 1:1-Höhen-Test · style.css nur Build-Tag · VM-Ladetest (Stub).

## Deploy
Git-Push (js/app.js, css/style.css, index.html). Worker unverändert.
Gerät: Kerzen- und Linien-Muster kopieren → Abbild jetzt in Original-Höhe statt
gestaucht; danach weiterhin per Box skalierbar.


---

# HANDOFF — Build m84 (deployed)

Basis: m83. Web-App-Dateien (4): `app.js`, `overlays.js`, `index.html`, `style.css`.
Zwei Wellen Zeichentool-/Indikator-Fixes. (Separat davor ausgeliefert, kein Build-Teil:
`snapshot.sh` 3 Fixes + zwei PDFs — siehe unten.)

- **Preislinie** — Preis erschien am Klickpunkt statt auf der Achse. In overlays.js
  eigenes `priceLine` registriert (überschreibt KLC-Bordmittel via bestehendem Wrapper):
  nur die waagrechte Linie, kein Punkt-Text; `needDefaultYAxisFigure` bleibt an → Preis
  nur auf Y-Achse.
- **Ein-Punkt-Linien nach Tap behalten** — `minPts` in `finishDrawing` (app.js) an der
  echten Punktzahl statt hart `2`. Horizontal/Preis/Vertikal (1 Punkt) wurden sonst
  mobil verworfen.
- **Volumen-Skala am Boden** — `gap.bottom` für `myvol` an beiden Überschreib-Stellen
  (`applyPaneTopGap` + Ausklapp-Zweig) auf 0 (war 4) → 0-Linie wieder am Pane-Boden.
- **Rechteck stilbar** — overlays.js Rechteck liest jetzt `extendData` statt hartkodiert:
  Menü-Farbe → Randfarbe (voll) + Füllung (mit Deckkraft), Dicke → Randbreite, gestrichelt
  → Randstil. Fallback = alte Werte. Menü-Inhalt unverändert, nur wirksam gemacht. Zusätzlich
  Preisfelder beim Rechteck (oberer/unterer Preis). Einziges wirklich betroffenes Tool war
  das Rechteck (alle anderen lesen styles.line nativ oder haben Eigenmenüs — einzeln geprüft).

**snapshot.sh (separat committet, MD5 40fc8149…):** (1) Python-Interpreter-Autoerkennung
`python3→python→py`, jeder mit `-c 'print(1)'` verifiziert (Windows-Store-Stub fällt raus);
(2) `ablegen()` akzeptiert nur `OK:` (stiller Bypass zu); (3) Gold negativer Timestamp ab
1968 → `epoch+timedelta` statt `utcfromtimestamp` (Windows-OSError); (4) Binance-Paginierung
`startTime` immer setzen (Falsy-Bug `if start:` bei 0). PDFs: Unterhalt_m83 (9 S.) + UI-Landkarte_m83.

---

# HANDOFF — Build m85 (deployed)

Basis: m84. Drei vorbestehende Bugs (KEINER aus m84 — settings.js/config.js/z-index/Dropdown
in m84 nie berührt). Dateien: `settings.js`, `style.css`, `app.js`.

- **Bug 1 — Indikator-Intervall-Dropdown `[object Object]`** (BMSB/EMA/SMA). Options-Renderer
  in settings.js behandelte jede Option als String (`o.textContent = opt`), aber diese
  Intervall-Optionen sind `{value,label}`-Objekte. Fix: Renderer behandelt jetzt BEIDE Formate
  (immun gegen die Regression, egal wie Optionen künftig definiert sind).
- **Bug 2 — mobiles Stil-Menü abgedunkelt.** `body.menu-open` schaltet Vollbild-Abdunkler bei
  z-index 665; `#overlayMenu` hatte keinen Override, blieb bei 601 → hinter dem Abdunkler.
  Fix: z-index-Override für `#overlayMenu` (mobil).
- **Bug 3 — Bar-Panel-Exklusivität** (mobile Panel-Stapelung/Dropdown).

---

# HANDOFF — Build m86 (deployed)

Basis: m85. Dateien: `style.css`, `app.js`, `index.html` (MD5 style 55a22893…, app c937e1fe…,
index d36669dd…; overlays.js + settings.js unverändert seit m85).

- **Lupe (Bug 3)** — keine eigene Lupe im Code; es ist die native iOS/Brave-Vergrösserungs-Lupe.
  Globales `user-select:none` wird von Brave/iOS nicht zuverlässig vererbt — muss am berührten
  Element sitzen. crosshairCanvas hat `pointer-events:none`, also empfängt `#mainChart` die
  Touches: dort `-webkit-touch-callout`/`-webkit-user-select`/`user-select` explizit (mobil, additiv).
- **Rechteck zweiter Punkt (Bug 2)** — teilweise adressiert, NICHT mit letzter Sicherheit
  lokalisiert. m84/m85-Änderungen berühren den Zeichnen-Pfad nachweislich nicht; kohärenteste
  Erklärung ist die iOS/Brave-Long-Press-Selektionsgeste beim Ruhen des Fingers auf Punkt 2.
  **Offen für gerätegetesteten Durchgang.**

---

# HANDOFF — Build m87 (deployed)

Basis: m86. Dateien: `app.js` (Logik), `style.css` + `index.html` (nur Build-Bump).
MD5 app 5565420f…, style b657ab6b…, index 8b351a1b….

- **Preisfeld-Nachkommastellen** — die Felder (Preis bei Horizontal-/Preislinie, oberer/unterer
  Preis beim Rechteck) setzten den rohen `value` ungerundet; die Achse berechnete ihre Präzision
  (≥100→0, ≥1→2, sonst 4), speicherte sie aber nirgends. Fix: Präzision in `state.pricePrecision`;
  die drei Felder runden mit `toFixed(prec)`. Nur Anzeige — Overlay-Wert bleibt, bis ein Feld
  aktiv geändert wird.
---

# HANDOFF — Build m88 (an HANDOFF.md anhängen, NIE committen)

Basis: zuletzt deployter Stand. Build bleibt bewusst **m88** über mehrere Runden
(Rey-Vorgabe: nicht hochzählen, m88 noch nicht deployed). Geänderte Dateien (6):
`app.js`, `config.js`, `indicators.js`, `overlays.js`, `style.css`, `index.html`.
**Alle m88-Änderungen kumulativ in diesen Dateien — bei Deploy alle 6 pushen.**

EOL-Regel (kritisch bei Edits): `config.js` + `indicators.js` = **CRLF**, alle
anderen = LF. Python-Edits mit `open(...,newline="")` für die zwei CRLF-Dateien.

## Runde A — Bug 1 (Sync) + 12D/freies Intervall
- **Bug 1**: Indikator-Einstellungen (localStorage-Keys `tv4_ind_<key>`, geschrieben
  von settings.js `_saveRaw`) fehlten im Sync. `buildBundle` (app.js) sammelt jetzt
  zusätzlich alle `tv4_ind_*`-Keys ins `indicators`-Objekt; Sync-Load schreibt sie
  zurück (Guard für alte Codes ohne `indicators`-Feld). Nur 3 LS-Keys existieren:
  `tv_workspace`, `tv_layouts`, `tv_synccode`.
- **12D + freies nD-Intervall**: config.js TIMEFRAMES `{id:"12d",label:"12D",aggDays:12}`.
  `resolveTimeframe(id)` findet festes TF oder rekonstruiert freies
  `{id:"<n>d",label:"<n>D",aggDays:n,custom:true}` via `/^(\d+)d$/` (n 1–365).
  `aggregateCandles(candles,tf)`: generische n-Tage-Buckets `Math.floor(ts/(aggN*D))`
  (Unix-Epoch-Anker). `loadData` lädt bei `aggDays` das 1d-Intervall + aggregiert
  (alle Quellen). Live-Stream aus bei aggregierten Intervallen. `renderTfList` mit
  Freifeld (`type=text inputmode=numeric pattern` — KEIN number/Spinner).
  CSS: `.tf-custom-row/-label/-unit/-input` (additiv).

## Runde B — Compare-Liste, ATR%, FRVP-Breite, Textmenü
- **Compare 10→3**: `#compareList{max-height:96px}` (eigene ID-Regel; globale
  `.dd-list{max-height:280px}` für Asset-/Indikator-/Intervall-Dropdown unberührt).
- **ATR%-Indikator** (Lower Pane, Pine `sma(tr*100/close[1], length)`, rot, nur Länge):
  config.js INDICATORS `key:"atrp", name:"ATRP", pane:"sub", label:"ATR%"` (nach ATR);
  indicators.js `registerIndicator({name:"ATRP", shortName:"ATR%", calc: pct=tr*100/close[i-1],
  atrp=smaSeries2(pct,period)})`; app.js buildCreate `case "atrp"`. `create.name=ind.name`
  → muss registerIndicator-name matchen. Helfer: `trSeries`, `smaSeries2` (echter SMA,
  null-safe), `maByType`, `plotStyle`.
- **FRVP-Menü Desktop breiter**: `.frvp-menu` 210→252px + `.frvp-row label` `nowrap`
  (POC/Nach-rechts brachen um). Mobil unberührt: `.frvp-menu.as-sheet` = 320px !important.
- **Textfeld-Stilmenü** `openTextMenu` (#textMenu): eigenes Menü statt Linien-Menü.
  Textinhalt in `overlay.extendData` (String), Stil in `styles.text`. TV_MENU_IDS +=
  "textMenu"; Drag-Liste += ["textMenu","Textfeld"].

## Runde C — FRVP POC gestrichelt + Textmenü Desktop/Mobil
- **POC gestrichelt-Option**: `ext.pocDashed` (Default gestrichelt, Rückwärtskompat).
  overlays.js POC-Linie `style: pocDashed ? "dashed" : "solid"`. openFrvpMenu liest/
  schreibt `frvpPocDashed`. HTML: neue Checkbox "gestrichelt", "(gestrichelt)" aus
  POC-Label entfernt.
- **Textmenü zentral**: `openTextMenu` wird in `openOverlayMenu` abgefangen
  (`if name==="simpleAnnotation" return openTextMenu(...)`, wie positionTool) → greift
  für ALLE Aufrufer: Desktop-Rechtsklick (onRightClick→else→openOverlayMenu) UND
  Mobil-Tap (`doStyle()`→else→openOverlayMenu). Expliziter onRightClick-Zweig entfernt.

## Runde D — Textfeld-Trefferbereich (Text + Linie, nicht nur Ankerpunkt)
KLC-Geometrie simpleAnnotation: Ankerpunkt `p`; Linie `p.y-6 .. p.y-56`; Pfeil bei
`p.y-56`; Text-Baseline `p.y-61`, zentriert um `p.x`, baseline unten. **Alle Figuren
`ignoreEvent:true`** → KLC erfasst nur den Ankerpunkt.
- **Mobil**: `findOverlayNear` simpleAnnotation-Zone (inBox Text + inLine + inAnchor;
  Textbreite ~`txt.length*fs*0.34` monospace).
- **Desktop**: `contextmenu`-Handler auf `chartEl` (Capture-Phase, `stopPropagation`
  nur bei simpleAnnotation-Treffer) → `openTextMenu`.

## Runde E — Textbox-Hintergrund + FRVP-Fixes
- **Textbox-Hintergrundfarbe**: 2. Picker `tmBgColor` (Feld 1 jetzt "Textfarbe").
  KLC-Text-Figur kann `backgroundColor`/`padding*`/`borderRadius`. openTextMenu
  `bgOn`-Logik: Hintergrund NUR bei aktiver Regler-Wahl (bestehende Textfelder ohne
  Box bleiben transparent). `bgOn` true → bg + padding 6/3 + borderRadius 3.
- **FRVP Mobil-Trefferzone-Bug**: `findOverlayNear` prüfte nur x (Höhe egal) → Tap
  unterhalb öffnete Menü. Fix: overlays.js speichert Profil-Preisgrenzen
  `window.__tvFrvpBounds[overlay.id] = {pMin,pMax}`; findOverlayNear FRVP-Zone jetzt
  x = `minX .. minX+(maxX-minX)*width%/100` (Balkenbreite), y = `toPx(pMax)..toPx(pMin)`.
  Fallback ohne Bounds: alte x-Prüfung. Desktop nutzt unverändert die unsichtbare
  Hitbox-Rechteck-Figur (overlays.js, `ignoreEvent:false`).
- **barPattern gleicher Bug**: Zone jetzt Rechteck (x UND y aus den 2 Eckpunkten).
- **FRVP verschieben blockiert**: `dragGuardsFor` → `positionTool || frvp` bekommen
  `DRAG_GUARDS` (onPressedMove*→true, Desktop). Mobil-Drag-Ausschluss (touchmove,
  `pointIndex<0`) += `|| name==="frvp"`. Menü (Rechtsklick/Tap) bleibt erreichbar.

## Runde F — Bug 1 gelöst (Zeitachse abgeschnitten), Bug 2 offen mit Diagnose
Zwei vom Rey am Gerät gefundene Bugs (Brave, Desktop, verkleinertes Fenster / App-Neustart).

- **Bug 1 — GELÖST.** Ursache: `.topbar` hat `flex-wrap:wrap` — bei zu schmalem Fenster
  bricht sie auf 2 Zeilen um. `.workspace{height:calc(100% - 53px)}` ging aber FEST von
  einer Zeile aus → Chart ragte über den Viewport, `html,body{overflow:hidden}` schnitt
  den Überstand (= Zeitachse) unten ab. Betraf einen Breitenbereich, der weder "Desktop
  voll" noch "Mobil" (`@media max-width:720px, pointer:coarse`) ist — dort existierte
  bereits eine korrekte dynamische Lösung (`--tv-topbar`/`--tv-botbar`), nur eben mobil-only.
  **Fix**: neue Variable `--tv-topbar-h` (Fallback 53px), `.workspace` nutzt sie statt der
  festen Zahl. `syncTopbarHeight()` (app.js) misst `.topbar` per `getBoundingClientRect()`
  und schreibt die Variable; `ResizeObserver` auf `.topbar` hält sie bei jeder Umbruch-
  Änderung aktuell. Der bestehende `.workspace`-ResizeObserver reagiert automatisch mit
  `chart.resize()`. Mobil-Media-Query (kommt später im File, gleiche Spezifität) bleibt
  unverändert vorrangig. Am Gerät testen: Fenster langsam schmäler/breiter ziehen, Umbruch
  in beide Richtungen prüfen.

- **Bug 2 — OFFEN, These widerlegt, Diagnose eingebaut.** SMA 200 (eigenes Intervall "1
  Woche", Chart-Intervall 1D) fehlte nach App-Neustart, erschien erst nach manuellem
  Wechsel des CHART-Intervalls auf 1W. Betrifft die "eigenes Intervall"-Funktion von
  SMA/EMA/BMSB (`maContext()`/`resampleCloses()` in indicators.js, aggregiert Tages- zu
  Wochenkerzen rein aus der bereits geladenen `dataList`, ohne Nachladen).
  Verifiziert (alles für sich korrekt, kein Fund):
  - Aggregations-Mathematik mit 3300-Tage-Testreihe simuliert → liefert für aktuelle
    Kerzen gültige SMA200-Werte.
  - `Settings.get()` liest `tf` synchron+korrekt aus localStorage, kein Timing-Problem.
  - **Widerlegt**: "Indikator wird vor den Daten erstellt" (applyAllActive() läuft vor
    loadData() bei Bootstrap). Direkt im KLC-Bundle nachgelesen: `addData(...,
    LoadDataType.Init)` (= `applyNewData`) ruft `_indicatorStore.calcInstance()` OHNE
    Parameter auf → das iteriert AUSNAHMSLOS alle Panes/Instanzen und berechnet jede mit
    der vollständigen aktuellen `dataList` neu, unabhängig vom Erstellungszeitpunkt.
    Damit ist diese Theorie sicher ausgeschlossen.
  - F12-Screenshot beim Reproduzieren zeigte NICHTS Relevantes (nur Build-Check-Log,
    unrelated favicon-404, 47 vorbestehende Accessibility-Issues zu Formularfeldern).
  - **Eingebaute Diagnose** (indicators.js, `maContext()`): loggt gedrosselt (max. 1x/5s
    PRO Indikator, Key = `indicator.name`) `tf`, `candles` (dataList.length), `cMs`
    (erkanntes natives Intervall), Pfad (`identity` vs. `aggregiert` inkl. Bucket-Anzahl).
    Nur aktiv wenn ein eigenes Intervall ≠ "auto" gesetzt ist — im Normalbetrieb still.
    **Sobald Bug 2 wieder auftritt: F12 → Konsole, nach `[TreydView][ma-tf]` filtern.**
    Zeigt candles=0 oder sehr klein → doch Daten-Timing; cMs falsch → Aggregation nimmt
    falschen Pfad; buckets zu wenig → zu kurze Historie; alles unauffällig → Fehler liegt
    eher bei KLC-Rendering/Visibility statt Berechnung. Log-Zeilen nach Diagnose wieder
    entfernbar (klar als "Diagnose fuer Bug 2" kommentiert, leicht auffindbar).

## Verifizierte Code-Stellen (Kurzref)
- Menü-Dispatch onRightClick (~app.js 4041): frvp/barPattern/fib/range/else→openOverlayMenu.
  `openOverlayMenu` fängt positionTool + simpleAnnotation zentral ab.
- Mobil-Overlay-Popover (~8843+): `dab`-Bar mit `dabStyle`(Palette)/`dabDelete`(Müll),
  `doStyle()` (fib/frvp/else→openOverlayMenu), `doDelete()`. Selektion via `findOverlayNear`.
- `findOverlayNear(x,y,lineTol,pointTol)` (~3250): iteriert state.drawings; Sonderzonen
  frvp/barPattern/simpleAnnotation, sonst Linien/Punkt-Distanz.
- `toPx({timestamp,value})` = `chart.convertToPixel(..., {paneId:"candle_pane"})`.
- FRVP-Renderer (overlays.js ~205): `needDefaultPointFigure:false`; pMin/pMax aus
  Kerzen im Zeitfenster; Hitbox-Rect am Ende.

## Prüfungen (bestanden)
node -c (11 JS) · CSS-Balance 742=742 · VM-Ladetest (Stub, Stopp bei gridbot-Mock ok) ·
Prüfung 1 Desktop-CSS-Diff vs m83 (nur beabsichtigt: .frvp-menu width, .frvp-row label
nowrap, --tv-build; additiv: #compareList, .om-text-*, .tf-custom-*) · ATR%-Logik +
Registrierung · FRVP/barPattern-Trefferzone (unterhalb trifft nicht mehr) · POC-Dashed-Logik.

## MD5 (m88, Stand nach Runde F)
```
033b01ae68705fc7454ab7371a27b0d1  js/app.js
366fa8d7ce0d1d2f8cce4b1053f9d822  js/config.js
daef03e1432885d3caa97222f8d192b6  js/indicators.js
e405c245e69aa4ab3028cc466181f8f7  js/overlays.js
dcd4a1d89088c0af448c32dc22156b48  css/style.css
84da4f73dd02f03241935548239a0411  index.html
```

## Deploy
`git add js/app.js js/config.js js/indicators.js js/overlays.js css/style.css index.html`
→ commit → push. Worker unverändert.

## Offen / am Gerät prüfen
- **Bug 1 (Zeitachse abgeschnitten)**: gelöst (siehe Runde F) — am Gerät mit Fenstergrösse
  gegentesten (Umbruch in beide Richtungen).
- **Bug 2 (SMA200 eigenes Intervall nach Neustart fehlt)**: weiterhin offen, schwer
  reproduzierbar. Diagnose-Log eingebaut (siehe Runde F) — beim nächsten Auftreten F12
  öffnen, nach `[TreydView][ma-tf]` filtern, Zeile hierher zurückmelden.
- **Textbox-Hintergrund**: backgroundColor/padding bei simpleAnnotation nicht am echten
  Chart getestet — sitzt die Box sauber, verschiebt sie den Text?
- **Grössen-Slider** Textmenü (`styles.text.size`) — greift KLC das live?
- **FRVP-Textbreite** in Trefferzone ist geschätzt (monospace 0.34), nicht gemessen —
  bei langem Text ggf. per Canvas messen.
- **FRVP-Trefferzone** direkt nach Reload vor erstem Render: Fallback = alte x-Prüfung.
- Alt-offen: Dominanz `usdtd=null`/`btcd=100` (fehlender COINGECKO_KEY Secret im Worker);
  Preisalarm-Linie; Multi-Exchange; Bug 4 (Rechteck 8 Griffe) für eigenen gerätegetesteten
  Durchgang.
