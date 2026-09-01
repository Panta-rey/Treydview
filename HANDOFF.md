# HANDOFF — Build m75 (an HANDOFF.md anhängen, NIE committen)

Basis: m74 (live). Geänderte Dateien (7): `app.js`, `settings.js`,
`worker-komplett.js`, `overlays.js`, `indicators.js`, `index.html`
(barPatternMenu additiv + `?v=`), `style.css` (nur Build-Tag). Build m74 → **m75**.

## 1a — Magnet Zug-Handler zurückgebaut
Der m74-Fix (snapEntryValue auf Stop/Ziel-Griffe) entfernt; Griffe nehmen wieder
rohen `moved.value`.

## 1b — Einstieg-Magnet Desktop (Live-Fadenkreuz)
`startMobilePointTool` um Maus-Handler erweitert (`onMouseMove` = Fadenkreuz +
Live-Snap-Vorschau via `snapPositionEntryPx`/`magnetSnap`, grün wenn auf O/H/L/C
eingerastet; `onMouseDown` = commit). `placePosition` nutzt jetzt auch auf Desktop
`startMobilePointTool` statt `placePositionByClick` (Letzteres rastete nur die
Zeitachse). `placePositionByClick` bleibt als toter Code stehen.
**Gerätetest:** KLineCharts zeigt auf Desktop evtl. sein eigenes Fadenkreuz
zusätzlich — falls störend, KLC-crosshair beim Zeichnen ausblenden (Nachzug).

## D+M 1 — Indikator-Intervall „[object Object]"
settings.js-Renderer verstand nur String-`options`. Jetzt beide Formate:
`{value,label}`-Objekt → `o.value=opt.value`, `o.textContent=opt.label`; String
unverändert. Behebt EMA/SMA/BMSB (Anzeige **und** gespeicherter Wert). Test grün.

## D+M 2 — Dominanz 403
`cgFetch` robuster: User-Agent-Header + Demo-Key zusätzlich als Query-Param
(`x_cg_demo_api_key`). **Live-Voraussetzung:** `wrangler secret put COINGECKO_KEY`
(Wert CG-T18…) MUSS gesetzt sein — sonst keyless → CoinGecko blockt Server-IP (403).

## D+M 3a — Muster-Fenster ohne Füllung
Trefferzone-Fläche auf `rgba(0,0,0,0)` (voll transparent, bleibt Trefferzone).

## D+M 3b — Style-Menü Muster-Tool
Neues `barPatternMenu` (index.html, `.frvp-menu`-Klassen, additiv), `openBarPatternMenu`
(Kerze Up/Down + Linienfarbe, Deckkraft, Gestrichelt), Dispatch an beiden onRightClick-
Stellen. Overlay liest `dashed` (Linie + Docht), Deckkraft via `hexToRgba` in die
Farben eingerechnet. Test grün. **Gerätetest:** Rechtsklick aufs Muster → Menü.

## D+M 4 — Volumen-Pane 0-Untergrenze
MYVOL bekommt `minValue: 0` (Balken bei 0 verankert, nicht mehr schwebend/„ewig
lang"). yDrag-Geste bewusst **unangetastet** — Hochschieben/Zoomen bleibt möglich
(unterhalb dann schwarz), wie gewünscht.

## D+M 5 — Countdown auf Preisskala
Zweite Tag-Zeile unter dem Preis-Tag mit Restzeit bis Kerzenschluss.
`candleCloseMs` (je Intervall, 1M kalendarisch) + `formatCountdown`
(1M→w/d, 1W→d/h, 1D & 4h→h/m, 1h & 15m→m/s). Sekunden-`setInterval` → `scheduleTagDraw`.
Format-Test grün. **Gerätetest:** live runterzählen prüfen.

## Prüfungen
node -c alle · D+M-1-Renderer-Test · barPattern solid/dashed + transp. Trefferzone ·
Countdown-Format (alle Intervalle) · VM-Ladetest (nur bekanntes Stub-Artefakt) ·
style.css nur Build-Tag · index.html additiv + ?v=.

## Restrisiko
1b (Desktop-Fadenkreuz-Interaktion), 3b (Menü-Interaktion), 5 (Live-Countdown) und
der Worker (D+M 2) sind statisch/funktional geprüft, aber End-to-End nur am Gerät
bzw. Live-Worker verifizierbar.

## Weiter offen (aus m74)
Tote Duplikate `gbRenderTiers`/`gbRenderData` in app.js weiterhin drin (nicht
angetastet). Auf „ja" entfernbar.
