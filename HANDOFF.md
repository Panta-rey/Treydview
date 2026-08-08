# TreydView — HANDOFF.md
**Stand: 8. August 2026 · Build m51**
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
`t-tokens.js` (Prüfung 5), `t-m22.js` (26), `t-m23.js` (26), `t-m24.js` (24), asynchron.
`t-m25.js` (47), `t-m26.js` (43), `t-m27.js` (30). `t-compat.js` prueft alte Drei-Punkt-Zeichnungen (6).
Rückwärtskompatibilität der Drei-Punkt-Zeichnungen: eigener Lauf, 5 Punkte.
m28–m32 (Meta-Tag, Yahoo/FRED-Umstellung, Cache-Versionierung, Symbol-Abgleich,
Gold-Kerzen) wurden ueberwiegend gegen simulierte Worker-Antworten
(`node --input-type=module`, gemockter `fetch`) statt gegen die vier
Pruefstand-Skripte getestet — der Schwerpunkt lag auf dem Cloudflare Worker,
nicht auf der Mobile-Schicht. Fuer die App-seitigen Aenderungen (`_symbolAbgleichen`,
`fetchGlobalM2`, `fetchGoldHistory`) gelten weiterhin alle vier Pflichtpruefungen.
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

## Datei-MD5 (Build m51)

| Datei | MD5 | Zeilen |
|---|---|---|
| index.html | 10b866c95d50e004844389fc33d164f5 | 1349 |
| style.css | 0d0407943ca024d577a19f3dafa6f19c | 1425 |
| app.js | 6459ee53e575871e1d7faf388ac0b1ab | 7430 |
| overlays.js | 0fe65a446d07bbf9f9f5a2e944642c94 | 1570 |
| ewt.js | 297d592de041e9131c9402113758922d | 1493 |
| config.js | d04fab000b992af41d89efeda47675bb | 513 |
| data.js | b0a40f69c5020e5ad549cd44c5e3e1f3 | 591 |
| indicators.js | 96bca96210cb52aed4f7988d0dfa8c41 | 1034 |
| settings.js | a0a42e402cbf44a755b469cb004a3836 | 250 |
| smc.js | 95601db23d23cf8f2cf19eb161c33dc6 | 248 |
| gridbot.js | 3a65ff885ee6d55480deb166d9717b04 | 502 |
| patterns.js | e94d7c6a70b598fe1bfeecb67c4cc82c | 1016 |
| derivatives.js | d44aac15f1dc1cc5410801b84f2aa81d | 157 |
| klinecharts.min.js | 4c351145fa2151aae0d4efca10247d04 | — |
| worker-komplett.js | fd3121620864c9421f5edf054df72814 | — |
| snapshot.sh | 19b8c1e054a82780d7371ee89af53552 | — |

`snapshot.sh` liegt im Repo-Wurzelverzeichnis, erzeugt `data/*.json`.
`smc.js`, `gridbot.js`, `patterns.js`, `derivatives.js` sind seit vor m17
unveraendert.

> **Korrektur gegenueber der alten m50-Tabelle:** die dortigen Zeilen-/MD5-
> Werte fuer `config.js`, `indicators.js`, `data.js`, `settings.js` waren
> veraltet (Chat 1.3 lief ueber den m50-Snapshot hinaus, ohne die Tabelle
> nachzuziehen). Diese m51-Tabelle ist der massgebliche Stand.

**⚠️ KLineCharts-Dateiname (Ursache der „Log-Skala wirkt nicht"-Bugs):**
`index.html` laedt `js/lib/klinecharts.min.js` — mit **Punkt**. Die
gepatchte Datei (Patches `St=0.2` und Log-Achse) lag aber als
`klinecharts_min.js` — mit **Unterstrich** — vor und wurde beim Deploy nie
unter den geladenen Pfad geschrieben. Beim Ausliefern IMMER unter dem
Punkt-Namen `klinecharts.min.js` ablegen. Patch-Verifikation im Bundle:
`grep "St=0.2"` und `grep "A=l,F=c,L=R"` muessen je 1 treffen.

**Diese Tabelle ersetzt fruehere Fassungen vollstaendig.** Immer nur DIESE,
oberste Tabelle als Stand nehmen.

---

## Build m51 — Änderungen (8. August 2026)

Sieben Punkte aus Chat „m51 Punkte 1–7". Alle vier Pflichtprüfungen +
ESLint no-undef bestanden, Compare- und BBW-Mathematik numerisch gegen
unabhängige Referenzen geprüft.

**1+2 · KLineCharts-Name / Log-Skala** — reines Naming: die gepatchte Datei
(Unterstrich) traf nie den in `index.html` geladenen Punkt-Pfad, deshalb
wirkten weder Log-Achse noch `St=0.2`. Kein Code-Change, Datei unter
korrektem Namen `klinecharts.min.js` ausgeliefert. (Log-Rendering selbst nur
browserseitig endgültig bestätigbar.)

**3 · Vergleichsmodus** (`app.js` `drawCompare`) — zwei Defekte behoben:
- *Ausrichtung:* der frühere `map.get(bar.timestamp)` verlangte einen
  EXAKTEN Zeitstempel-Treffer. Über verschiedene Intervalle (1M-Chart gegen
  Tages-Indexdaten) oder bei anderer Tagesgrenze der Quelle traf er fast nie
  → Linien zerfielen/verschwanden. Neu: `alignCompareSeries()` — Treppe /
  forward-fill, pro Bar der letzte Schlusskurs vor Beginn des NÄCHSTEN Bars
  (nahe Bar-Ende, konsistent mit dem Kerzen-close). Robust gegen Timeframe-
  und Quellen-Offsets.
- *Skalierung:* lineare %-Achse drückte Indizes an die Nulllinie, sobald BTC
  +980 000 % zeigte. Neu: im Log-Modus (Knopf „L") positioniert
  `posOf` über `log10(Kurs/Ref)` statt Prozent; Achse weiter in % beschriftet
  (`posToPct`). `fmtComparePct` kürzt sehr grosse Prozentwerte. `drawLine`
  bekam Index-Argument + `pos` statt `pct`. Y-Zoom (`compareScale`) wirkt
  generisch im pos-Raum, unverändert.

**4 · EWT-Panel** (`index.html`, `app.js`, `ewt.js`, `style.css`):
- *4.1 Standard-Button* `#ewtDefaultBtn` → `ewtResetDefaults()` setzt alle
  Felder auf `EWT_STANDARD`. Werte an Motor-DEFAULTS orientiert, mit zwei
  bewussten Anpassungen: `degreeScale 0.6` (BTC-lastig; HANDOFF nennt
  0.5–0.7) und alle Anzeige-Umschalter an / Zusatzfilter aus.
- *4.2 Unnötige Regler entfernt:* RSI-Periode und RSI-überverkauft aus dem
  Panel genommen, fest auf 14 / 30. Begründung: sie parametrieren nur den
  RSI-Zusatzfilter, der standardmässig aus ist und den die eigenen Messungen
  (76 % verworfen) abraten — Feineinstellung eines abgeratenen Filters ist
  Überkonfiguration. minPivot/setupMinPct/timeout/basis BEHALTEN (echter
  analytischer Effekt).
- *4.3 Gradzahlen live:* hinter Primary/Intermediate/Minor/Minute steht das
  Fraktal-Fenster n (Spans `.ewt-deg-n`). `ewtUpdateDegreeLabels()` liest die
  Kerzen + degScale und ruft die NEUE Motor-Methode
  `EWTEngine.degreeWindows(data, opts)` (dünner Wrapper um `ableitenGrade` —
  Single Source of Truth, KEIN zweiter Rechenweg im UI). Live bei degScale-
  Input, beim Panel-Öffnen und initial. „(zu fein)" wenn n<2, „(–)" ohne
  Daten.

**5 · Bollinger Band Width** (`config.js`, `indicators.js`, `app.js`) —
neuer Sub-Pane-Indikator `BBW` (16. Indikator). `bbw = 2·mult·StdDev / SMA`
(Populations-StdDev /n wie Pine `ta.stdev`), Präfixsummen für SMA.
Squeeze = bbw ist Minimum über `compLen` (Pine `bbw==lowest(bbw,comp_len)`),
gerendert als eingefärbte Säule (`type:"bar"`, Fuchsia) bis zur Bandbreite an
den Squeeze-Bars — Sub-Pane-taugliche Form von Pines `bgcolor`. Inputs
length 20 / mult 2.0 / compLen 125, precision 4. Numerisch gegen unabhängige
Referenz: Abweichung bbw 7.5e-15, Squeeze-Zahl identisch.

**6 · Layout Export/Import** (`app.js`, `index.html`, `style.css`) —
`exportLayouts()` schreibt alle `tv_layouts` als
`treydview-layouts-JJJJ-MM-TT.json` (Wrapper `{_typ,_version,_exportiert,
layouts}`). `importLayoutsFromFile()` akzeptiert Wrapper- ODER blanke
`{name:snapshot}`-Form, MISCHT ohne Überschreiben (`_freierLayoutName` →
„Name (2)"), validiert `snapshot.symbol`. UI: `.layout-io` mit
Export/Import-Buttons + verstecktem File-Input.

**7 · HANDOFF** — diese Aktualisierung (bleibt lokal, NIE committen).

### Cloudflare-Worker — eigene Datei, eigenes Deployment

`worker-komplett.js` ist **nicht Teil des Git-Repos** und liegt nicht im
`/mnt/user-data/outputs`-Zyklus der App selbst — es ist der komplette Code
fuer den separaten Cloudflare Worker (`pantarey.rey-gafner.workers.dev`),
der per Hand im Cloudflare-Dashboard eingefuegt und deployed wird. Bindings:
KV-Namespace `PANTA`, Secrets `FRED_KEY` (Macro/Gold-Kontext, seit jeher)
und `FRED_API_KEY` (M2/Indizes — faellt auf `FRED_KEY` zurueck, falls nicht
gesetzt). Aktueller Stand MD5 `1c7bc25ea6108546d370039e9c8236a6`, 571 Zeilen.

Dieser Worker wird **auch von einem anderen Projekt genutzt**
("Back to the Future" / BTTF, laut Kopfkommentar der Originaldatei) —
`/goldhistory` und `/macro` sind fuer BTTF entstanden, TreydView nutzt sie
mit. Aenderungen an diesen beiden Routen koennen das andere Projekt
beruehren; siehe die Notizen zu `series` vs. `candles` weiter unten.

## Externe Datenquellen — Indizes, Gold, Global M2  (m28–m32)

Vier Builds lang das eigentliche Thema. Kurzfassung fuer den Fall, dass es
wieder "nicht funktioniert": **niemals nur den Rechenweg pruefen — immer
zuerst pruefen, ob der KV-Cache eine alte Antwort ausliefert.**

### Der wichtigste Fund: unversionierte Cache-Schluessel  (m32)

Die KV-Schluessel hiessen `"m2"`, `"stooq_^spx"`, `"goldhistory"` — **ohne
Versionskennung**, mit 24 Stunden Lebensdauer. Nach jeder Korrektur am
Rechenweg lieferte der Worker deshalb bis zu einen ganzen Tag lang weiter
die ALTEN, falschen Werte aus dem Cache. Mehrere Korrekturen in dieser
Build-Reihe sahen deshalb wirkungslos aus, obwohl der Code laengst richtig
war — der Cache hat es nur nicht gezeigt.

Geloest mit `CACHE_VERSION = "v2"` (worker-komplett.js, ganz oben). Jeder
KV-Schluessel haengt sie an (`m2_${CACHE_VERSION}`, `stooq_${s}_${CACHE_VERSION}`,
`goldhistory_${CACHE_VERSION}`). Wird der Rechenweg kuenftig noch einmal
geaendert: **`CACHE_VERSION` erhoehen.** Sonst wiederholt sich genau dieser
Fehler.

### Gold: `series` bleibt, `candles` kommt dazu  (m32)

`/goldhistory` lieferte urspruenglich nur Schlusskurse
(`series: [[ms, close], ...]`) — so war die Route fuer BTTF entworfen
("Back to the Future" braucht eine lange Linie, keine Kerzen). Fuer
TreydView bedeutete das: Kerzen waren technisch moeglich, aber inhaltlich
leer — jede Kerze ein Strich ohne Koerper und Docht (O=H=L=C).

Die Antwort ist jetzt ERWEITERT, nicht ersetzt: `candles: [[ms,o,h,l,c,v]]`
kommt zusaetzlich zu `series` hinzu, mit echtem OHLC von Yahoo. BTTF, das
nur `series` kennt, bleibt unberuehrt. `data.js`s `fetchGoldHistory()` liest
bevorzugt `candles`, faellt bei aelteren Worker-Antworten auf `series`
zurueck (dann wieder O=H=L=C).

### Indizes: Yahoo zuerst (echtes OHLC), FRED als Ruecksicherung  (m31)

`INDEX_QUELLEN` in worker-komplett.js: pro Symbol ein Yahoo-Ticker
(`^GSPC`/`^IXIC`/`^DJI`) und eine FRED-Serie (`SP500`/`NASDAQCOM`/`DJIA`).
Yahoo liefert echtes OHLC, also sind dort Kerzen sinnvoll. Blockiert Yahoo
(429), springt FRED ein — nur Schlusskurse, aber verlaesslich, damit der
Chart nie leer bleibt. Warum ueberhaupt zwei Quellen: Stooqs Bulk-CSV-
Endpunkt liefert seit einiger Zeit eine JavaScript-Challenge-Seite statt
Daten (nicht durch Kopfzeilen oder Parameter loesbar), Yahoo allein blockte
zeitweise mit 429.

### `buildM2`: haengt nicht mehr an der schwaechsten Reihe  (m31)

FRED hat die China-Reihe (`MYAGM2CNM189N`) im **August 2019 eingestellt**.
Die urspruengliche Regel verlangte einen Wert von JEDEM der vier Laender
fuer denselben Monat — seither gab es keinen einzigen gemeinsamen Monat
mehr, die Ausgabe blieb leer ("Keine plausiblen M2-Daten erhalten"/"Keine
gemeinsamen M2-Monate gefunden").

Neue Regel: `M2SL` (USA) ist die Leitreihe. Fehlt ein anderes Land fuer
einen Monat, wird dessen LETZTER bekannter Wert fortgeschrieben. Das ist
eine bewusste Naeherung — seit 2019 ist Chinas Beitrag eingefroren, die
Kurve zeigt dort nur noch die Bewegung der anderen drei. Steht auch als
Kommentar im Code, falls das je wieder hinterfragt wird.

### Umrechnungsfaktoren: drei von vier Reihen waren falsch skaliert  (m30)

`M2SL` (USA) ist tatsaechlich "Billions of Dollars". Die drei IWF-Serien
(Euroraum, Japan, China) sind es NICHT — sie melden die ROHE
Landeswaehrung. Beleg direkt von FRED: Euroraum-M2 stand im Maerz 2017 bei
`10'876'141'000'000` mit der Einheit "Euros", China im August 2019 bei
`193'549'242'773'720` "National Currency". Die urspruenglichen Faktoren
gingen von "bereits Milliarden" aus — Fehlbetrag ueberall dort um den
Faktor ~1e9.

Symptom: eine einzelne, absurd grosse und vollkommen flache Chart-Linie
(z. B. `39'860'906'812'499`). Der korrigierte Faktor teilt bei allen drei
IWF-Reihen zusaetzlich durch `1e9`, bevor der Wechselkurs angewendet wird.
Ergebnis danach: realistische ~$85–90 Billionen globales M2.

**Zwei Schutzschichten gegen den naechsten unbekannten Einheitenfehler:**
`M2_PLAUSIBEL_MIN/MAX` (1'000–1'000'000 Mrd. USD) im Worker filtert
absurde Monate einzeln heraus, statt die ganze Serie zu verwerfen.
`data.js`s `fetchGlobalM2()` verlangt zusaetzlich, dass eine Nicht-JSON-
Antwort mit `date,value` beginnt, bevor sie als CSV geparst wird — sonst
haette eine HTML-Fehlerseite Zahlen "gefunden", die keine sind.

### Symbol-Objekt im Workspace veraltet stillschweigend  (m31)

`state.symbol` wird als **ganzes Objekt** gespeichert (`localStorage`,
`tv_workspace`), nicht als blosser Bezeichner. Ohne Abgleich gegen
`CONFIG.DEFAULT_SYMBOLS` lud der Browser beim Start die eingefrorene alte
Fassung — Aenderungen an `config.js` (etwa ein korrigiertes Label oder ein
neues Feld) erreichten ein bereits gespeichertes Symbol nie. Genau das war
die Ursache, warum S&P 500 nicht lief, obwohl Nasdaq und Dow (neu
ausgewaehlt, also frisch aus `config.js`) einwandfrei funktionierten — und
warum ein direkter `curl` auf dieselbe Route erfolgreich war.

`_symbolAbgleichen()` in app.js gleicht das gespeicherte Symbol ueber seine
`id` gegen die aktuelle `CONFIG.DEFAULT_SYMBOLS` ab; die Config-Definition
hat Vorrang. Nur wenn die `id` dort nicht mehr existiert (eigenes Symbol
des Nutzers), bleibt die gespeicherte Fassung erhalten. **Diese Fehlerklasse
war nicht auf S&P 500 beschraenkt** — jede kuenftige Aenderung an einem
Symbol in `config.js` haette dasselbe Symptom bei jedem Nutzer mit
gespeichertem Workspace ausgeloest.

### `fetchGoldHistory()` kannte den Worker-Schluessel `series` nicht  (m30)

Unabhaengig von der Datenquelle (Stooq oder Yahoo): `getGoldHistory()`
liefert seit jeher `{ series: [...], from, to, n, _fetchedAt }`. Der
Frontend-Parser suchte aber nur `json.data` / `json.history` — beide
undefined, `rows` wurde `null`, die Funktion gab am Ende STILLSCHWEIGEND
ein leeres Array zurueck statt eines Fehlers. Selbst ein perfekt
funktionierender Worker haette also nie sichtbare Gold-Kerzen ergeben.
Jetzt erkennt `fetchGoldHistory()` `.series` (Tupel `[ms, close]`) und
`.candles` (Tupel `[ms,o,h,l,c,v]`, seit m32) explizit.

### Nasdaq-Label korrigiert  (m30)

`config.js` beschriftete den Nasdaq-Eintrag als "Nasdaq 100" — FRED fuehrt
dafuer aber nur den **Composite** (`NASDAQCOM`), keinen separaten
100er-Index. Label auf "Nasdaq Composite" geaendert, um nicht falsche
Information ueber richtigen Daten zu zeigen.

### Meta-Tag  (m28)

`apple-mobile-web-app-capable` ist Apple-spezifisch veraltet.
`mobile-web-app-capable` steht seit m28 zusaetzlich daneben (index.html).



# Elliott-Wellen-Scanner  (m33–m38)

Sechs Builds lang das Hauptthema. Wer hier weiterarbeitet, sollte den
Abschnitt ganz lesen — die Sackgassen sind lehrreicher als das Ergebnis.

## Was der Scanner ist

`ewt.js` ist ein eigenstaendiges Modul im Muster von `patterns.js`: reine
Rechnung, kein DOM, kein Chart. Aufruf ueber `EWTEngine.scan(data, range,
opts)`, Rueckgabe `{ impulses, abcs, setups }`. Gezeichnet wird in
`scanEWT()` in `app.js`; drei Overlays in `overlays.js`:

| Overlay | Zweck |
|---|---|
| `ewtWave` | Wellenzug fuer Impuls (6 Punkte) UND Korrektur (4 Punkte), Beschriftung aus `extendData.labels` |
| `ewtZone` | Golden-Pocket-Box des Welle-3-Setups, vier Zustandsfarben |
| `ewtProjection` | Fortschreibung W3–W5 + A-B-C, 8 Punkte |

## Die vier Sackgassen — bitte nicht wiederholen

**1. Ein Bein statt einer Struktur (m33/m34).**
Die erste Fassung suchte nur Welle 1 (Tief→Hoch) und legte eine Golden
Pocket darueber. Das ist ein Golden-Pocket-Signalgeber, kein
Elliott-Scanner. Erkannt wird jetzt die vollstaendige Fuenferstruktur,
geprueft gegen die drei kardinalen Regeln.

**2. Oszillatoren als harte Filter (m34).**
RSI, Volumen und Efficiency Ratio waren Ausschlusskriterien. Gemessen an
2000 Kerzen: von 93 Kandidatenpaaren blieben 5.6 uebrig — der RSI-Filter
allein verwarf 76 % der bis dahin Ueberlebenden, das Volumen 53 % vom Rest.
Sie sind jetzt **Bewertung, nicht Filter**, und standardmaessig aus.
Weder LuxAlgo noch der Detector Pro noch Frost/Prechter benutzen
Oszillatoren zur Erkennung. Eine Wellenstruktur ist eine geometrische
Aussage.

**3. Feste Wellengrenzen (m35).**
Eine Fraktal-Laenge pro Grad zwingt den ganzen Zug in eine Aufloesung.
Aus dem Python-Projekt `ElliottWaveAnalyzer` uebernommen: jede Teilwelle
darf einzeln Zwischenextrema ueberspringen (`maxSkip`, Default 2).
Gemessen brauchen **73 % der gefundenen Impulse einen Skip > 0**, meist
Welle 3. Rohe Treffer: 17 ohne Skip, 64 mit. Der `WaveOptionsGenerator5`
des Originals erzeugt bei `up_to=10` rund 66'000 Kombinationen pro
Startindex — im Browser undenkbar, deshalb gedeckelt.

**4. Nur eine Korrekturform (m37).**
Modelliert war nur der Zigzag; die Bedingung `B.price < p5v` verbot Flats
sogar ausdruecklich. **82 % aller ABC-Kandidaten fielen durch**, Median des
B/A-Verhaeltnisses 1.25 — mitten im Expanded-Flat-Bereich. Jetzt drei
Formen mit eigenen Baendern. Ergebnis: 0.6 -> 10.7 Korrekturen pro
Datensatz.

## Zwei Messfehler, die die Diagnose verfaelscht haben

Beide traten beim Einbau der Skip-Suche auf und sahen aus wie
Eigenschaften des Algorithmus:

**Gieriges Blockieren.** Nach jedem Fund wurden benachbarte Startpunkte
gesperrt. Frueh verworfene Kandidaten blockierten dann nichts mehr,
weshalb *strengere* Regeln paradox *mehr* Treffer lieferten. Entfernt.

**Deduplizierung ueber alle Grade.** Sie kollabierte 64 Strukturen auf 11,
womit die Skip-Suche wirkungslos erschien. Dedupliziert wird jetzt **je
Grad**; ueber die Grade hinweg nur bei >90 % Ueberlappung, denn dieselbe
Bewegung auf mehreren Ebenen zu zeigen ist der Sinn der Mehrskalen-Suche.

## KLineCharts: dataIndex statt timestamp — kritisch

Im Bundle verifiziert, `_drawOverlay`:

```js
var n = t.dataIndex;
O(t.timestamp) && (n = g.timestampToDataIndex(t.timestamp));
```

`timestamp` **ueberschreibt** `dataIndex`, und `timestampToDataIndex`
klemmt auf den letzten Bar. Jeder Zukunfts-Zeitstempel landet damit auf
derselben x-Position — im Chart sichtbar als vertikal gestapelte Punkte am
rechten Rand. **Alle EWT-Overlays uebergeben ausschliesslich `dataIndex`,
ohne `timestamp`.** `dataIndexToCoordinate` extrapoliert ueber das
Datenende hinaus korrekt.

Zusaetzlich wird beim Scan der rechte Offset vergroessert
(`setOffsetRightDistance`), sonst werden Projektionen abgeschnitten.

**Offen:** `scanSMC` hat denselben Fehler (`extendTs = lastTs + barMs*30`),
die SMC-Zonen verlaengern sich faktisch nicht nach rechts. Eigene Sitzung.

## Mathematik

**Logarithmisches Retracement.** `retrace(H,L,r) = H^(1−r) · L^r`, wobei
`r` der zurueckgegebene Anteil ist. Achtung: die Fassung `H^r · L^(1−r)`
liefert bei r = 0.618 das 0.382-Level — bei einer 10x-Welle 41.50 statt
24.10. Beide Schreibweisen kursieren; die zweite stammt aus einer Quelle,
die den Exponenten als *Gewicht zum Hoch* meint, nicht als Retracement.

**Anpassungsfehler** (`fitError`). Beantwortet objektiv, welche von
mehreren konkurrierenden Zaehlungen am Kursverlauf liegt: RMS-Abweichung
des Kurses von den Wellenlinien. Zwei Details:

- Gerechnet im **Log-Raum**, sonst haengt der Wert am Kursniveau und ist
  zwischen Assets nicht vergleichbar.
- Normiert mit **sqrt(Spanne)**, nicht mit der Spanne. Der rohe Fehler
  waechst mit der Wellenlaenge (rho = 0.78); ohne Normierung gaelten lange
  Wellen pauschal als schlecht. Ueber 205 Impulse gemessen: sqrt-Normierung
  laesst rho = 0.05 zurueck, Normierung mit der Spanne selbst
  ueberkorrigiert auf −0.28. Random-Walk-Skalierung, theoretisch motiviert
  und empirisch am besten.
- Berechnung ueber Praefixsummen (O(1) je Segment statt O(Spanne)) und auf
  den Segmentanfang **zentriert** — ohne Zentrierung entstehen bei Index
  5000 Summen um 1e7, aus denen ein Ergebnis der Groessenordnung 0.1
  herausgezogen werden muesste. Ausloeschung. Gegen die Direktberechnung
  geprueft: groesste relative Abweichung 8.4e-8.

## Was aus welcher Quelle stammt

| Quelle | Uebernommen |
|---|---|
| LuxAlgo (Pine) | Drei kardinale Regeln als einzige Erkennungsbedingung; mehrere Wellengrade gleichzeitig |
| Elliott Wave Detector Pro (Pine) | Mindest-Pivot-Bewegung beim **Aufbau** der Kette statt als Nachfilter |
| ElliottWaveAnalyzer (Python) | Skip-Suche je Teilwelle; erweiterter Regelsatz (Proportionen, Dauer); `legClean` als Nachbau von `find_end` + np.min/max-Pruefungen; ABC-Baender |
| elliottwaves.py (Python) | Anpassungsfehler als Auswahlkriterium — in korrigierter Form, siehe oben |
| Frost/Prechter (Kanon) | Korrekturformen Zigzag/Flat/Expanded; Alternation; verlaengerte Welle und Gleichheitsregel |
| Erfahrungsbericht (X) | Momentum-Divergenz W5 gegen W3 als Erschoepfungszeichen (68 % der Impulse zeigen sie) |

**Bewusst NICHT uebernommen:** die neunfach verschachtelte Brute-Force aus
`elliottwaves.py` (O(P^9)) und deren euklidische Wellenlaenge
`sqrt((x2−x1)² + (y2−y1)²)` — die addiert Bars² zu Dollar², ist dimensional
inkohaerent und massstabsabhaengig.

## Benennung: „W3" war ein Relikt  (m42)

Die erste Fassung suchte ausschliesslich nach Welle-3-Setups, daher
hiessen die Etiketten „W3 wartend/getriggert/invalidiert". Neben
ausgezaehlten Impulsen mit eigenen Wellen 1 bis 5 war das
missverstaendlich. Jetzt **W2→W3**: die Box ist die Golden Pocket der
Welle 2, der Einstieg zielt auf Welle 3. Sie ist eine EINSTIEGSZONE,
keine Zielzone — ein invalidierter Zustand bedeutet genau, dass der Kurs
hindurchgelaufen ist.

Die Ziellinie erscheint nur, solange das Ziel erreichbar ist. Bei
Ausgang „danach gebrochen" entfaellt sie: eine Linie, die ein nie
erreichbares Ziel behauptet, ist irrefuehrend.

## Offene Punkte

- **Kanalisierung**: Linie durch 2 und 4, Parallele ab 3; Welle 5 endet oft
  an der oberen Kanallinie. Wuerde die Projektion deutlich verbessern.
- **Triangles** (A–B–C–D–E, fuenfteilig): kommen vor allem in Welle-4- und
  B-Position vor, unser Dreier-Schema kann sie strukturell nicht erfassen.
- **Doppelte/dreifache Korrekturen** (W-X-Y).
- **Truncated Fifth**: derzeit ueber `requireWave5NewExtreme` ausgeschlossen.
- **Unterwellenstruktur** innerhalb einer Welle.

## Logarithmische Preisskala  (m33)

Knopf `L` unten an der Preisskala, Default linear, Zustand im Workspace.
Im Bundle verifiziert: `YAxis.getType()` liest `getStyles().yAxis.type`
**nur fuer die Kerzen-Pane** (`isInCandle()`), Subpanes geben fest
`Normal` zurueck — Indikatoren koennen also nicht verzerrt werden.

Wichtig zum Verstaendnis: Die EWT-Rechnung ist ohnehin logarithmisch. Der
Schalter aendert **nichts** an der Mathematik, er macht sie sichtbar.

**m51:** Der `L`-Knopf steuert jetzt auch den **Vergleichsmodus**: bei Log an
positioniert `drawCompare` die Linien über `log10(Kurs/Ref)` statt linearem
Prozent (Achse bleibt in % beschriftet). Ohne das erdrückt ein +980 000-%-BTC
alle Indizes an der Nulllinie. Zustand kommt aus `state.logScale`.

## Panel-Knoepfe in der Seitenleiste  (m33) — BEABSICHTIGTE Desktop-Aenderung

Grid Bot, Long/Short, Muster, SMC und Elliott sind aus der Topbar in die
Seitenleiste ueber die Zeichenwerkzeuge gewandert. `#drawStyleBtn` wurde
entfernt (Stil laeuft ueber den Schwebebalken).

**Die Falle:** `renderDrawbar()` laeuft bei jedem Werkzeugwechsel, Magnet-
und Pin-Klick erneut. Lag frueher `bar.innerHTML = ""` an, wurden die
verschobenen Knoepfe samt ihrer Handler vernichtet. Deshalb zwei
Container: `.drawbar-panels` wird **einmal** befuellt und nie wieder
angefasst, `.drawbar-tools` wird bei jedem Aufruf neu gebaut. Auf dem Handy
bleiben die Knoepfe in der Topbar (die Bottom Bar holt sie spaeter).

Dropdown-Panels in der Leiste brauchen `position: fixed`
(`placeDropdownPanel`): `.drawbar` traegt `overflow-y: auto` und wuerde ein
absolut positioniertes Panel abschneiden, und `.dd-panel--right` mit
`right: 0` zeigt in der schmalen Leiste nach links aus dem Bild.
Breite gedeckelt auf `min(320px, 33vw)` — mit `position: fixed` ist der
umgebende Block das Sichtfenster, ohne Deckel zieht sich das Panel auf die
gesamte Restbreite.

## Diagnose in der Konsole

```js
EWTEngine.diagnose(window.__tvGetDataList())
```

Liefert je Wellengrad: Pivot-Anzahl, gepruefte Startpunkte, wie oft jede
Regel scheiterte, wie viele Zaehlungen gueltig und bestaetigt sind, und ein
Histogramm der gewinnenden Skip-Tupel. Beantwortet „warum finde ich nichts"
mit Zahlen statt Vermutungen.

# KLineCharts-Patches im Bundle  (WICHTIG bei jedem Update)

`js/lib/klinecharts.min.js` ist **modifiziert**. Bei einem Bibliotheks-
Update gehen diese Aenderungen verloren und muessen neu angewandt werden.

## 1. Overlay-Deckkraft  (alt)

`var St=1` -> `St=0.2`

## 2. Log-Achse: Teilstriche im falschen Raum  (m50)

**Der Fehler, an dem vier Anlaeufe gescheitert sind.** Er lag NICHT im
Projektcode, sondern in KLineCharts 9.8.12 selbst — deshalb halfen weder
`resize()`, noch `setPaneOptions`, noch eine eigene Achse ueber
`registerYAxis`.

In `calcRange` gilt fuer den Log-Modus:

```
l = log10(min); c = log10(max);        // from/to sind LOG-Werte
T===Log ? (A=xt(l), F=xt(c), ...)      // realFrom/realTo = 10^log = PREISE
```

`_calcTicks` rechnet aber mit `realFrom`/`realTo` und verteilt die
Teilstriche damit gleichmaessig im **Preisraum**, waehrend
`_innerConvertToPixel` sie im **Logarithmusraum** zeichnet.

Nachgerechnet fuer BTC ab 2011 (2.22 bis 134'326, mit gap-Aufschlag
0.74 bis 1'214'847): Tick-Intervall 200'000, Striche bei
200k/400k/…/1.2M — **unterhalb von 200'000 kein einziger Strich**, also
auf vier von fuenf Zehnerpotenzen nichts. Genau das war im Chart zu sehen.

Zwei chirurgische Ersetzungen:

```
ALT: T===t.YAxisType.Log?(A=xt(l),F=xt(c),L=Math.abs(F-A)):(A=l,F=c,L=R)
NEU: (A=l,F=c,L=R)

ALT: case t.YAxisType.Log:r=o._innerConvertToPixel(_t(+n)),i=K(n,g);break;
NEU: case t.YAxisType.Log:r=o._innerConvertToPixel(+n),i=K(xt(+n),g),v&&(i=l.formatBigNumber(xt(+n)));break;
```

Die erste liefert `realFrom`/`realTo` als Log-Werte, sodass `_calcTicks`
im Logarithmusraum verteilt. Die zweite zieht daraus die Konsequenz: der
Tick-Wert IST jetzt ein Log-Wert, also Pixel ohne nochmaliges `log10`,
Beschriftung mit Ruecktransformation `xt` (= 10^x).

Ergebnis nachgerechnet: Striche von 1.00 bis 398'107 statt nur ueber
200'000.

Pruefen nach einem Update:

```bash
grep -c 'St=0.2' js/lib/klinecharts.min.js          # 1
grep -c '(A=l,F=c,L=R)' js/lib/klinecharts.min.js   # 1
grep -c 'K(xt(+n),g)' js/lib/klinecharts.min.js     # 1
```

# Vergleichs-Paarung  (m50)

Die Regel „nur Paare mit gleicher Quote-Waehrung" war faktisch
wirkungslos: sie las die Waehrung aus dem ANZEIGETEXT
(`label.includes("/" + q)`). Bei aktivem BTC/USD trifft `/USD` auch
`"BTC/USDT (Binance)"`, weil es dort als Teilzeichenfolge steckt.

`quoteOf(sym)` liest die Waehrung jetzt aus den SYMBOLFELDERN
(`bitstampPair`, `krakenPair`, `coinbaseProduct`, `bybitSymbol`, `id`),
nicht aus dem Label.

**Ausnahme:** `VERGLEICH_IMMER` = ^SPX, ^NDQ, ^DJI, QQQ, VTSAX sind
unabhaengig von der Quote-Waehrung immer waehlbar — sie dienen als
Referenzmassstab. Dafuer brauchte `refreshCompareData` einen
`stooq`-Zweig; ohne ihn landeten sie im Binance-Abruf und schlugen fehl.
`bitstamp` fehlte dort ebenfalls.

# Derivate-Symbolabbildung  (m49)

Funding, Open Interest und Long/Short kommen vom Binance-Futures-Markt.
`derivSymbolFor(sym)` bildet das angezeigte Asset darauf ab; fuer Gold,
Indizes und Fonds liefert es `null` und der Abruf entfaellt.

**Vorgeschichte, damit es nicht ein drittes Mal kippt:** urspruenglich
stand dort `state.symbol.value` — ein Feld, das es an Symbolen nie gab.
Der Aufruf lief mit `undefined` und traf den Vorgabewert `"BTCUSDT"` der
Funktion, war also fuer BTC zufaellig richtig. Der naheliegende „Fix" auf
`state.symbol.id` machte es schlimmer: `"BTCUSD_BS"` kennt die
Futures-API nicht, Funding und OI fielen ganz aus.

# Wellengrade und Unterteilung  (m47)

## Grade heissen jetzt wie in der Lehre

Primary, Intermediate, Minor, Minute. Das Fraktal-Fenster wird aus dem
KERZENINTERVALL abgeleitet, nicht aus der Chartlaenge:

    n = (Wellendauer_Tage / Kerzenintervall_Tage) / 2 * degreeScale

| Grad | Tage | 1M | 1W | 1D |
|---|---|---|---|---|
| Primary | 365 | 6 | 26 | 183 |
| Intermediate | 120 | 2 | 9 | 60 |
| Minor | 35 | – | 3 | 18 |
| Minute | 10 | – | – | 5 |

**Warum das die alte Skala ersetzt:** `base, base*1.8, base*3.4` lag
zwischen zwei Graden und traf keinen sauber. Das echte Verhaeltnis ist
~3.3x und folgt aus der Selbstaehnlichkeit — ein Zyklus hat acht Beine
(5+3), jedes Bein ist selbst ein Zyklus der naechsttieferen Ebene.

**degreeScale ist EIN Wert fuer alle Grade**, bewusst nicht vier
Einzelzahlen: das 3.3x-Verhaeltnis ist der inhaltlich bedeutsame Teil.
Einzeln verschoben zerstoert man die Hierarchie, die den Gradnamen erst
rechtfertigt. Krypto laeuft schneller als Aktien — fuer BTC passt oft
0.5 bis 0.7.

**Die Deckelung `degMax = Kerzen/30` ist ERSATZLOS entfallen.** Sie war
ein Notbehelf gegen eine Skala, die Grade erzeugte, die es nicht geben
konnte. Einzige Bedingung ist jetzt: gibt die Pivot-Kette sechs Punkte
fuer EINE Zaehlung her?

**`scalePivotWithDegree` ebenfalls entfallen.** Gemessen brachte sie fast
nichts (54 -> 52 Pivots), und mit abgeleiteten Graden wurde sie
schaedlich: Scan und Diagnose bezogen sie auf verschiedene
Referenzgrade, wodurch der Scan die Schwelle auf 4.8 % zog und
Strukturen verwarf, die die Diagnose noch meldete.

## Unterteilungspruefung — „Impuls" ist keine Behauptung mehr

Eine Impulswelle verlangt fuenf Unterwellen; die Korrekturen 2 und 4
verlangen drei. Ohne Pruefung ist „Impuls" eine Aussage ueber die blosse
Form — eine korrektive Struktur mit fuenf Beinen hat dieselben Punkte.

Der Scanner rechnet **immer einen Grad feiner** als den angezeigten
(`nurPruefung: true`, wird nicht gezeichnet) und prueft jede der fuenf
Wellen dagegen.

**Dreiwertig, und das ist wesentlich:**

| Zustand | Bedeutung |
|---|---|
| `bestaetigt` | alle fuenf unterteilen sich regelkonform — nur DANN heisst es „Impuls" |
| `teilweise` | ein Teil belegt |
| `nichtAufloesbar` | feinerer Grad zu fein fuer das Intervall — **kein Regelverstoss** |
| `widersprochen` | Unterwellen da, passen aber nicht |

Unbestaetigte Strukturen heissen im Chart **„5-Punkt-Struktur"**.

`requireSubdivision` filtert darauf, laesst `nichtAufloesbar` aber durch:
fehlende Aufloesung ist kein Gegenbeweis. EWAVES raeumt dasselbe ein und
laesst sein System ueber Datensegmente „blinzeln".

## Zaehlbasis waehlbar

`basis: "hl" | "close"`. Die Fachwelt ist uneins: Lehrtexte empfehlen
Schlusskurse, Prechters eigenes EWAVES benutzt ausdruecklich Extrema und
zeigt gar keine Schlusskurse an. Vorgabe ist `hl` wie EWAVES.

# Bitstamp: rueckwaerts paginieren  (m47)

Die erste Fassung startete bei August 2011 — dem BTC-Listing. Fuer ETH
gab es damals nichts, Bitstamp lieferte eine leere erste Seite, die
Schleife brach ab, Worker warf **HTTP 500**. Der Fehler war, das
Listing-Datum ANZUNEHMEN statt es herauszufinden.

Jetzt rueckwaerts ab heute ueber `end`. Drei Vorteile: Startdatum egal
und faellt als Ergebnis heraus, unbekannte Paare funktionieren ohne
Anpassung, und man kann nach genug Kerzen aufhoeren — bei 1h/4h greift
`maxKerzen = 6000`, statt 15 Jahre Stundenkerzen zu holen.

# Pruefschritte vor jeder Lieferung

Zu den vier bestehenden Pruefungen (Desktop-CSS-Diff, jsdom-DOM-Vergleich,
Mobil-Selektoren, Funktionstest) kommt eine fuenfte:

## ESLint mit `no-undef` — nicht optional

```bash
npm install eslint
node_modules/.bin/eslint js/app.js js/ewt.js js/overlays.js js/data.js \
                        js/config.js js/indicators.js js/settings.js
```

**Warum das noetig wurde:** In m40 stand in `scanEWT()` eine Variable
`labelMode`, die benutzt, aber nie deklariert war. `node -c` prueft nur
SYNTAX und meldet so etwas nie. Der `try/catch` um die Setup-Schleife
verschluckte den ReferenceError, und die Folge war zwei Builds lang
unbemerkt: **es wurden ueberhaupt keine Projektionen mehr gezeichnet.**
Die Fehlersuche ging zunaechst in die falsche Richtung ("kein Impuls
gefunden"), weil das Symptom plausibel anders erklaerbar war.

Vier Meldungen sind bekannte Fehlalarme und duerfen ignoriert werden —
sie stammen aus dateiuebergreifenden Globals, die der Browser aufloest:
`FIB_LEVEL_SETS` und `textOn` (aus config.js), `hexToRgba`,
`devicePixelRatio`.

# Werkzeug-Fallstricke, die Zeit gekostet haben

## Python-Skripte muessen nach JEDEM Schritt schreiben

Ein Skript mit mehreren `assert`-gesicherten Ersetzungen und EINEM
Schreibvorgang am Ende verliert bei einem spaeten Abbruch **auch alle
vorherigen erfolgreichen Ersetzungen** — waehrend deren Erfolgsmeldungen
schon auf dem Schirm stehen. Genau so ging der Etikett-Modus in m40
verloren und hinterliess den `labelMode`-ReferenceError.

Richtig: eine `rep()`-Hilfsfunktion, die Datei lesen, ersetzen und
zurueckschreiben in einem Schritt macht, und bei fehlendem Suchtext eine
Meldung ausgibt statt abzubrechen.

## Der 1. Januar 1970 war ein DONNERSTAG

Montage liegen damit bei `Tagesindex ≡ 4 (mod 7)`. Fuer Wochengrenzen
wird der Versatz ABGEZOGEN:

```js
bucket = Math.floor((ts - 4 * D) / (7 * D));
start  = bucket * (7 * D) + 4 * D;
```

Mit `+ 4 * D` beginnen die Wochen sonntags. Der Fehler steckte an drei
Stellen (app.js `aggregateCandles`, indicators.js `htfBucket`) und
verschob den 200-Wochen-SMA um rund 25 Punkte.

## Tests duerfen die eigene Formel nicht als Referenz benutzen

Der erste Wochen-SMA-Test stimmte auf 7·10⁻¹² — weil die Referenzrechnung
DIESELBE falsche Wochenformel verwendete. Ein zirkulaerer Test prueft
nichts. Die Referenz muss unabhaengig sein: hier `getUTCDay()` statt
Modulo-Arithmetik.

Dieselbe Falle gilt fuer den EWT-Anpassungsfehler: der Normierungsexponent
0.5 wurde an synthetischen Zufallspfaden bestaetigt, wo er per
Konstruktion 0.5 sein MUSS. `EWTEngine.calibrateBeta()` misst ihn an
echten Daten nach.

# Historie und Datenquellen  (m44–m46)

## Harte Grenzen der Quellen

| Quelle | Beginn | Anmerkung |
|---|---|---|
| Binance BTC/USDT | Aug 2017 | harte Grenze, unabhaengig vom Worker |
| Bitstamp BTC/USD | 2011 | durchgehend bis heute, keine Nahtstelle |
| Bitstamp ETH/USD | ~2015 (unbestaetigt) | Indizien deuten auf Herbst 2015; das Feld `from` der Worker-Antwort verraet das echte Datum |
| LBMA Gold | 1968 | Auktionspreise, siehe unten |
| Yahoo `GC=F` | ~2000 | Gold-FUTURES, nicht Spot |

## Gold: vier Anlaeufe, damit niemand dieselben Wege noch einmal geht

1. **Stooq** → JavaScript-Challenge-Seite, serverseitig nicht loesbar
2. **Yahoo Finance** → HTTP 429 schon beim ersten Abruf mit leerem Cache
3. **FRED** → die LBMA-Goldreihen (`GOLDAMGBD228NLBM`,
   `GOLDPMGBD228NLBM`) wurden **aus FRED ENTFERNT**. FRED weist im
   eigenen Blog darauf hin. Kein Konfigurationsfehler, die Serien
   existieren schlicht nicht mehr.
4. **LBMA direkt** → `https://prices.lbma.org.uk/json/gold_am.json` bzw.
   `gold_pm.json`, offen, ohne Schluessel, zurueck bis 1968.
   Format: `{ "d": "1968-04-01", "v": [USD, GBP, EUR] }`.
   In den Anfangsjahren steht bei EUR eine 0 — NICHT auf Vollstaendigkeit
   des Arrays pruefen.

**Ehrlichkeit der Gold-Kerzen:** Das sind Auktionspreise, zwei je
Handelstag. Die Tageskerze entsteht daraus als open = AM, close = PM,
high/low = Extrem der beiden. Das sind **keine echten Tagesextreme** —
der Kurs schwankte dazwischen mehr. Fuer Struktur- und Trendbetrachtung
ueber Jahrzehnte reicht es, fuer Docht-Analyse nicht. Volumen gibt es
nicht.

## Momentaufnahme + Zuwachs statt Vollabruf

Die Altdaten liegen als statische Dateien im Repo (`data/*.json`) und
kommen vom GitHub-Pages-CDN; vom Server kommt nur noch, was seit der
letzten gespeicherten Kerze dazugekommen ist.

Gemessene Groessen: BTC 233 KB roh / **62 KB gzip**, Gold 529 KB roh /
**109 KB gzip**. Zum Vergleich: `klinecharts.min.js` ist 201 KB und wird
ohnehin geladen.

`DataLayer.fetchHistoryCached()` hat **drei Rueckfallebenen**:

1. Momentaufnahme + Zuwachs — der Normalfall
2. **nur Momentaufnahme** — Worker oder Quelle nicht erreichbar, der
   Chart zeigt die Historie trotzdem
3. nur Worker/API — Datei fehlt, verhaelt sich wie vor m45

Damit ist die Abhaengigkeit von den Quellen nicht nur kleiner, sondern
optional. Faellt LBMA oder Bitstamp aus, funktioniert der Chart weiter.

Zwei Bezugswege im `snapshot.sh`, weil die Quellen sich unterscheiden:
Bitstamp und LBMA ueber den Worker (kein CORS, Weissliste), Binance
direkt (oeffentlicher Endpunkt mit CORS, ein Worker waere ein Umweg).

**Nur Tageskerzen.** Fuer 1h und 4h waeren es Hunderttausende Kerzen; dort
laeuft weiter der volle Abruf.

## Boersen-Duplikate entfernt  (m46)

Kraken BTC/USD und ETH/USD, Coinbase BTC/USD und ETH/USD sowie Bybit
BTC/USDT sind aus `DEFAULT_SYMBOLS` **entfallen**. Sie standen dort
ausschliesslich, weil sie mehr Historie boten als Binance (Kraken 2013
bzw. 2016). Seit Bitstamp ab 2011 liefert, ist das ueberholt: weder mehr
Tiefe noch ein anderer Zweck, aber je ein eigener Ladepfad mit eigenen
Fehlerfaellen.

**Nicht entfernt:** Kraken SOL/USD (keine Alternative), Coinbase AERO/USD
und Bybit AERO/USDT (eigene Begruendung — Coinbase listet AERO seit 2024,
Binance erst Dez 2024).

Wichtige Unterscheidung fuer kuenftige Entscheide: Liquiditaet entscheidet
**einmal**, bei der Auswahl der Quelle. Danach ist sie fixiert. Ein
laufender Boersenwechsel wuerde an der Nahtstelle genau den Preissprung
erzeugen, den die Bitstamp-Entscheidung gegen Binance vermeiden soll.

## CACHE_VERSION

Bei jedem Quellenwechsel im Worker hochzaehlen. Sonst liefert der
KV-Cache weiter die alten Daten und der Fehler sieht wie ein
Code-Problem aus. Fuer den LBMA-Wechsel: `v2` → `v3`.

# Indikatoren auf fremdem Intervall  (m43)

SMA und EMA haben unter *Inputs* ein Auswahlfeld **Intervall**. Auf
`auto` rechnen sie auf den Chartkerzen; sonst werden die Chartkerzen zum
Zielintervall aggregiert und der Durchschnitt laeuft ueber DIESE
Schlusskurse. So zeigt man den 200-Wochen-SMA im Tageschart.

**Nicht dasselbe wie eine umgerechnete Periode:** SMA(1400) auf
Tagesbasis mittelt 1400 Tagesschluesse, SMA(200) auf Wochenbasis mittelt
200 Wochenschluesse. Aehnlich, aber nicht gleich — und der Nutzer erwartet
den Wert, den er auf dem Wochenchart saehe.

Zeitfenster ueber Zeitstempel, nicht ueber Kerzenzahl: sieben Chartkerzen
sind bei Datenluecken keine Woche. Reicht die Historie nicht, bleibt die
Linie leer statt aus zu wenigen Werten gezeichnet zu werden.

## Build-Abgleich — zuerst prüfen, wenn etwas „nicht wirkt"

- `style.css`: `:root { --tv-build: "m32" }`
- `app.js`: `const TV_BUILD = "m32"`
- `index.html`: alle Verweise mit `?v=m32`

Beim Start liest das JS die CSS-Kennung aus und meldet grün oder warnt.
**Bei jeder Auslieferung an allen drei Stellen erhöhen.**

**Für den Worker gilt dasselbe Prinzip, nur mit einer eigenen Kennung:**
`CACHE_VERSION` in `worker-komplett.js`, aktuell `"v2"`. Bei jeder Änderung
am Rechenweg einer gecachten Route (`/m2`, `/stooq`, `/goldhistory`)
ebenfalls erhöhen — sonst liefert der Worker bis zu 24h lang die alte,
falsche Antwort aus dem KV-Cache aus, während der App-Build schon korrekt
zeigt. Genau das hat in m29–m31 mehrere Korrekturen wirkungslos aussehen
lassen, obwohl der Code längst richtig war.

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

## Desktop zieht Long/Short-Griffe selbst  (m27)

Der komplette Zug-Handler aus Abschnitt 4c ist **mobile-only**
(`if (!host || !bar || !tvIsMobile()) return;`), ebenso der Schwebebalken
(`.draw-action-bar { display:none }` in der Basis). Am Desktop zog deshalb
KLineCharts — und verschiebt dabei grundsaetzlich ALLE Punkte gemeinsam.

Zwei Teile:
1. **`dragGuardsFor(name)`** haengt die Zug-Sperren (`onPressedMove*` → `true`)
   an `positionTool` auf **jeder** Plattform, an alle anderen Werkzeuge nur
   auf dem Handy. Der Desktop-Zug aller uebrigen Zeichnungen bleibt damit
   unveraendert (Regel 1).
2. **Abschnitt 4b4**: eigener `mousedown`/`mousemove`/`mouseup`-Handler,
   ausschliesslich fuer `positionTool`, mit derselben Aufteilung wie am
   Finger — Stop und Ziel nur senkrecht, Breite nur waagrecht (Kerzenanzahl
   in `extendData`), Einstieg fix, Flaeche zieht nichts. `ENGAGE = 4`
   statt 8: die Maus ist praeziser als der Finger.

## Loeschen: einmal statt zweimal  (m27)

`#posDelete` im L/S-Stilmenue **ergaenzt** (das Menue bleibt).

Auf dem **Handy** werden `overlayDelete`, `posDelete`, `fibDelete` und
`frvpDelete` ausgeblendet — der Muelleimer im Schwebebalken deckt das ab.
Am **Desktop** bleiben sie: dort gibt es keinen Schwebebalken.

> **Voraussetzung, die vorher nicht erfuellt war:** Der Balken lag bei
> `z-index: 660`, der Abdunkler bei `665` — bei offenem Stilmenue war der
> Muelleimer also verdeckt und nicht antippbar. Der Balken steht jetzt auf
> **668**: ueber dem Abdunkler, weiterhin unter den Menues (670). Das kehrt
> die Entscheidung aus m21 bewusst um.

## Worker-Routen fuer Indizes und M2  (m27)

`worker-routen.js` — **nicht Teil der Auslieferung**, sondern zum Einfuegen
in den Cloudflare-Worker neben `/goldhistory`.

- **`/stooq?s=<symbol>`** — Weissliste `^spx`, `^ndq`, `^dji`; ohne sie waere
  die Route ein offener Proxy. Faengt Stooqs Limitmeldung ab, die mit
  HTTP 200 als Text kommt und sonst als leere CSV durchginge.
- **`/m2`** — summiert vier FRED-Reihen (USA, Euroraum, Japan, China) in
  USD. Umrechnungskurse **fest**, nicht tagesaktuell: M2 ist eine
  Monatsreihe, ein aktueller Kurs erzeugte rueckwirkend Schwankungen, die es
  nie gab. Nur Monate, fuer die ALLE vier Reihen vorliegen — sonst sehen
  fehlende Veroeffentlichungen wie Einbrueche aus. Braucht
  `FRED_API_KEY` als Secret.

Beide liefern CSV; `data.js` versteht das bereits.

## Trefferzonen: die ganze Zeichnung  (m26)

Ein Tipp zaehlt jetzt ueberall auf der Zeichnung, nicht nur nahe den Ankern:

| Werkzeug | Trefferzone |
|---|---|
| `segment`, `polyline` | ganze Strecke (war schon so) |
| `straightLine` | unendliche Gerade in BEIDE Richtungen — fiel vorher in die Strecken-Pruefung und war nur zwischen den Ankern antippbar |
| `rayLine` | ab Punkt 0 nach vorn |
| `priceChannelLine`, `parallelStraightLine` | JEDE Parallele, nicht nur die erste |
| `rectangle`, `priceRange`, `dateRange` | ganze Flaeche |
| `fibRetracement`, `fibExtension` | jede Level-Linie (m22) |
| `positionTool` | ganzer Kasten (m20) |
| waagrechte/senkrechte Unendliche | ueber die volle Breite/Hoehe |

`naechsterPunkt(ptsIdx, x, y, pointTol)` ist die gemeinsame Hilfsfunktion —
vorher stand dieselbe Schleife in jedem Zweig.

## Textauswahl gesperrt  (m26)

`html, body { user-select: none }` in der **Basis**, damit es auch am Desktop
gilt. `input, textarea, select, [contenteditable]` sind ausgenommen, sonst
liesse sich dort nichts mehr markieren.

> **Pruefstand-Falle:** Ob eine Regel "in der Basis" steht, laesst sich NICHT
> an ihrer Position im Text ablesen — es gibt schon vor Zeile 205 einen
> @media-Block. Massgeblich ist die Klammertiefe, nicht die Reihenfolge.

## Indizes und Global M2  (m26)

**Beide brauchen eine Worker-Route.** Stooq und die Notenbank-Quellen
erlauben keinen Direktabruf aus dem Browser (CORS) — derselbe Grund, aus dem
Gold schon ueber den Worker laeuft.

| Endpunkt | Erwartet | Antwort |
|---|---|---|
| `GET /stooq?s=<symbol>` | `^spx`, `^ndq`, `^dji` | Stooq-CSV `date,open,high,low,close,volume` oder JSON gleicher Form |
| `GET /m2` | — | `[{date, value}, ...]` oder CSV `date,value` |

Solange die Routen fehlen, erscheint eine klare Meldung in der Statuszeile —
kein stiller Fehler. Symbole: `type: "stooq"` mit `stooqSymbol`; nur
Tageskerzen, kein Live-Strom, nicht vergleichbar (andere Skala).

**M2-Indikator** (`GLOBALM2`, eigenes Fenster wie StochRSI): die Werte kommen
NICHT aus den Kerzen, sondern aus `window.__tvM2Series`, das `ensureM2Series()`
einmal laedt. `calc()` schreibt den zuletzt bekannten Wert fort (**Treppe**) —
M2 erscheint monatlich, eine gerade Linie zwischen zwei Monatswerten waere
eine Erfindung.

## Kleinere Korrekturen  (m26)

- **`placeMenu` blendet NICHT ein.** Es positioniert nur. `openPositionMenu`
  fehlte das `classList.remove("hidden")` — das L/S-Stilmenue blieb deshalb
  unsichtbar, obwohl alles andere lief.
- **`.ls-choice { display: none }`** stand in der Desktop-Basis und wurde nur
  im Mobil-`@media` sichtbar gemacht. Der Desktop-Knopf tat scheinbar nichts.
- **`#tbRow2`** hat rechts jetzt denselben Abstand wie links, inklusive
  Notch-Bereich.
- **Magnet-Symbol** nach Vorlage: 45 Grad gedrehtes Hufeisen, Pol-Enden in
  `var(--bg-raised)` abgesetzt, Blitz frei darueber.

> **Ohne Bildanzeige pruefbar:** SVG bei ~34 px rendern und als ASCII
> ausgeben. So laesst sich die Form beurteilen, wenn das Betrachten der
> PNG-Datei nicht moeglich ist.

## Pruefung 2: fuenf beabsichtigt geaenderte Zweige

`#drawbar` (m22), `#smcTrigger`, `#posMenu` (m25), `#assetPanel`, `#indPanel`
(m26 — datengetrieben, Inhalte prueft `t-m26` gegen CONFIG). Ausserhalb
davon: 1249 Knoten, unveraendert.

## Vergleichsmodus  (m25)

**Boersen-Metadaten gingen verloren.** `addCompareAsset` baute den Eintrag als
`{ id, label, color, data, hidden }` — ohne `type`, `bybitSymbol`,
`krakenPair`, `coinbaseProduct`. `refreshCompareData` fand kein
`entry.type === "bybit"`, fiel in den Binance-Zweig und fragte dort eine id
wie `AEROUSDT_BY` ab, die es nicht gibt. Betraf **alle** Nicht-Binance-Paare,
nicht nur AERO. Jetzt `{ ...sym, color, data, hidden }`.
Die Fehlermeldung nennt seither den Grund statt nur "fehlgeschlagen".

**Zeichnungen blieben sichtbar.** Zwei Lecks:
1. `restoreDrawings` lief auch im Vergleichsmodus — beim Start nach
   `loadData()` und beim Laden eines Layouts — und holte zurueck, was
   `applyCompareIndicator` eben entfernt hatte.
2. WAEHREND des Vergleichs gezeichnete Overlays wurden nie versteckt:
   `_hiddenDrawingIds` erfasst nur den Bestand BEIM EINTRITT.

Jetzt steigt `restoreDrawings` im Vergleichsmodus aus (merkt die Liste nur
vor) und `registerDrawing` nimmt eine neue Zeichnung sofort vom Chart. Der
Merker heisst `state._drawingsHidden` — eine Id-Liste taugt nicht, weil
Zeichnungen aus Fall 2 nie eine Chart-Id bekommen.

**Senkrechter Zoom.** Die Prozent-Skala wird bei jedem Neuzeichnen frisch aus
den sichtbaren Werten berechnet — ein Y-Zug bewegte deshalb nur das Raster im
Hintergrund. `state.compareScale` haelt den Nutzer-Zoom fest, `drawCompare`
wendet ihn um die Mitte an, und der Y-Zug schreibt ihn relativ zum Startwert
(`base.__cmpScale`), sonst driftet er pro Frame. Doppeltipp auf die Achse
setzt beides zurueck.

## Long/Short: eigenes Stilmenue  (m25)

`#posMenu`, bewusst **nicht** eine Erweiterung von `#overlayMenu`: das ist auf
Linien zugeschnitten (Farbe, Breite, gestrichelt) und gilt fuer ALLE
Zeichnungen — eine Aenderung dort haette jedes andere Werkzeug mitverdreht.
Inhalt: Farbe Stop-Bereich, Farbe Ziel-Bereich, Sichtbarkeitsregler.
`openOverlayMenu` leitet `positionTool` um. Werte landen in `extendData`
(`stopColor`, `targetColor`, `zoneOpacity`) und werden mitgespeichert;
`renderPosition` liest sie ueber `hexA()`.

## Desktop zeichnet Long/Short wie das Handy  (m25)

> **`startMobilePointTool` hoert ausschliesslich auf Beruehrungen** — null
> Maus-Listener. Die Richtungswahl auf dem Desktop haette in ein Werkzeug
> gefuehrt, das nie eine Eingabe bekommt.

Deshalb `placePositionByClick()`: einmaliger `mousedown` auf dem Chart setzt
den Einstieg, Escape bricht ab, die Preisskala ist ausgenommen. Beide Wege
teilen sich `expandPositionPoints(dir, entry)` — sonst laufen 1 % / 2 %
zwischen Handy und Desktop auseinander. Die Richtungswahl erscheint auf dem
Handy ueber dem Knopf, auf dem Desktop als Dropdown darunter.

## Magnet: nur noch aus/ein  (m25)

Drei Stufen waren mit dem Finger nicht unterscheidbar. `state.magnetMode`
kennt nur `"normal"` und `"strong_magnet"` (Name bleibt, KLineCharts erwartet
ihn so), Fangbereich immer 40 px. Gespeicherte Arbeitsflaechen mit
`"weak_magnet"` werden beim Start migriert.

Symbole: Magnet ist ein aufrechtes gefuelltes Hufeisen mit Blitz, Pol-Kerben
in `var(--bg-raised)`. Smart Money ist ein **Geldsack** (angesammelte
Liquiditaet) statt der frueheren zwei Rechtecke.

## Pruefung 2 kennt drei beabsichtigt geaenderte Zweige

`#drawbar` (m22), `#smcTrigger` und `#posMenu` (m25). Sie werden **ganz
ausgelassen**, nicht durch einen Platzhalter ersetzt: ein neu eingefuegtes
Element verschiebt sonst die gesamte Restliste und erzeugt Hunderte
Scheinabweichungen. Ausserhalb davon: 1337 Knoten, unveraendert.

## Kastenbreite: KEIN vierter Punkt  (m24 — Neubau)

Der Breiten-Griff ist dreimal gescheitert. Der Grund war konstruktiv, nicht
ein Flüchtigkeitsfehler:

> **Ein Zeitstempel in der Zukunft laesst sich nicht in Pixel umrechnen.**
> Der vierte Punkt lag 20 Kerzen rechts vom Einstieg, also ausserhalb der
> geladenen Daten. `chart.convertToPixel` gibt dort `null` zurueck, damit ist
> `drag.startPxPts[3]` null, und `if (!basePx) return;` beendete den Zug
> **lautlos**. Kein Fehler im Log, keine Wirkung.

Seit m24 traegt **`extendData.widthBars`** die Breite — eine blosse Zahl, die
keine Umrechnung braucht:

- `positionWidthPx(overlay)` = `widthBars x __tvBarSpace()`, Untergrenze
  `PT_MIN_BARS = 3`, Vorgabe 20.
- `overlays.js` rechnet `x1 = x0 + positionWidthPx(overlay)`.
- Der Zug auf Griff 3 schreibt nur `widthBars` per `overrideOverlay`; die
  Punkte werden nicht angefasst.
- `drag.startWidthPx` haelt die Ausgangsbreite fest.
- Die Persistenz schreibt `extendData` mit — sonst geht die Breite beim
  Neuladen verloren.

**positionTool hat wieder DREI Punkte.** Alte Zeichnungen ohne `extendData`
bekommen die Standardbreite von 20 Kerzen (frueher ein 60-px-Stummel).

> **Pruefstand-Luecke, die das drei Builds lang verdeckt hat:**
> `overrideOverlay` im Stub verarbeitete nur `points` und `styles` — nicht
> `extendData`. Jede Breitenaenderung verpuffte im Test unbemerkt.
> Und: `chart.getOverlayById` liefert eine LEBENDE Referenz, kein Abbild.
> Wer den Vorher-Wert nicht kopiert, vergleicht ihn mit sich selbst.

## Griffe in den linken Ecken  (m24)

Stop und Ziel sitzen bei `x0` auf ihrer eigenen Linie — bei einem Long also
Ziel oben links, Stop unten links; beim Short ergibt es sich umgekehrt von
selbst. Die Schilder sind **linksbuendig** und beginnen bei
`chipLeft(x0) = x0 + HANDLE_R + 6`, laufen also nach rechts vom Griff weg.
Damit kann sich nichts mehr ueberlagern. Der Kennzahlen-Block rueckt um
`HANDLE_R` hoeher, damit seine unterste Zeile den oberen Eckgriff nicht
beruehrt.

## Zyklus-Pill schaltet um  (m24)

`openFor` merkt sich, zu welcher Pill das Popover offen ist. Zweiter Tipp auf
dieselbe Pill schliesst; Wechsel auf eine andere Pill haelt offen; Klick
daneben und die 5-Sekunden-Uhr wirken weiter.

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
2. **Börsen-Schnittstellen** (Coinbase, Kraken, Bybit) von der Sandbox
   blockiert, nur im Browser prüfbar.
3. **SMC-Nullmodell** nie auf echten BTC-Daten gelaufen.
4. **Grid-Bot**: `liqDist` wird im UI nicht gezeigt; Nettowert wächst linear
   mit dem Hebel.
5. **AVWAP**: nur ein Anker gleichzeitig.
6. **Kein Journal** — bewusst zurückgestellt.
7. **Gold-Historie ist kürzer als vorher.** Yahoo (`GC=F`) liefert
   schätzungsweise 20–25 Jahre statt der ursprünglichen 46+ Jahre über
   Stooq/LBMA. Für TreydViews eigenen Gebrauch ausreichend; falls BTTF
   („Back to the Future", das andere Projekt am selben Worker) die lange
   Historie explizit braucht, wurde das nicht separat gelöst.
8. **Nasdaq zeigt den Composite, nicht den Nasdaq-100.** FRED führt nur
   `NASDAQCOM`; Yahoo (`^IXIC`) für den Composite ist konsistent dazu
   gewählt. Falls tatsächlich der 100er-Index gemeint war, wäre das ein
   separater Wechsel auf `^NDX` (Yahoo) — für FRED gibt es dafür keinen
   Rückfall.
9. **Global M2 ist eine Näherung, kein Fachdatensatz.** Chinas Beitrag ist
   seit August 2019 eingefroren (FRED hat die Reihe eingestellt) und wird
   fortgeschrieben statt aktualisiert. Feste, nicht tagesaktuelle
   Wechselkurse für die Umrechnung ins USD. Für eine Chart-Kennzahl
   ausreichend, nicht für exakte Analyse.
10. **`worker-komplett.js` ist nicht Teil des Git-Repos** und wird nicht
    automatisch mitversioniert — bei jeder Worker-Änderung selbst prüfen,
    ob die lokale Kopie noch dem tatsächlich deployten Stand entspricht.

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
