# HANDOFF — Build m78 (an HANDOFF.md anhängen, NIE committen)

Basis: m77. Geänderte Dateien (6): `app.js`, `overlays.js`, `data.js`,
`settings.js`, `style.css` (nur Build-Tag), `index.html` (nur `?v=`).
Build m77 → **m78**.

## Punkt 1 — BTC.D/USDT.D echte Kerzen
`fetchDominance` baute o=h=l=c (flach). Jetzt: open = Schlusskurs des Vortages,
high/low = Spanne, close = Tageswert → echte Up/Down-Kerzen. Test grün. (Die
Dominanz bleibt ein Tageswert; unterhalb 1D gibt es keine feineren Daten — bei
1D/4h zeigt jede Kerze die Tages-Dominanz mit prev-close-open.)

## Punkt 2 — Einstieg-Magnet Desktop (endlich richtig)
Ursache: positionTool lief über `placePositionByClick` (Custom-Handler), NICHT
über KLCs Klickfluss — deshalb kein Fadenkreuz-Magnet (Linien-Tools laufen über
KLC und rasten). **Fix:** positionTool `totalStep: 4→2`; Desktop zeichnet jetzt
über `chart.createOverlay(cfg)` (KLCs Klickfluss → Fadenkreuz rastet via
magnetSnapValue auf O/H/L/C). Nach dem einen Klick expandiert der eigene
`onDrawEnd` den Einstieg zu [Einstieg, Stop, Ziel] (removeOverlay + createOverlay
mit expandPositionPoints). Mobil unverändert (startMobilePointTool).
**Gerätetest** der Zeichnen-Interaktion.

## Punkt 3 — Golden Pocket (Regress)
`buildFibFigures` berücksichtigte `ed.goldenPocket` nicht. Jetzt: bei aktiver
Option wird ein 0.65-Level nach 0.618 eingefügt → das Band 0.618–0.65 wird als
Fläche gefüllt. Gilt für Retracement + Extension. Test grün.

## Punkt 4 — Lower-Pane „Löschen" (Regress)
`Settings.open(indKey, onApply)` nahm den dritten `onDelete`-Parameter nicht mehr
an (app.js übergibt ihn seit je), und `#settingsDelete` (im HTML, display:none)
blieb versteckt. Fix: Signatur `open(indKey, onApply, onDelete)`; der Delete-Button
wird sichtbar gemacht und verdrahtet, wenn ein Callback übergeben wird (schliesst
Pane + wählt Indikator im Dropdown ab). Test grün.

## Prüfungen
node -c alle · Dominanz up/down-Kerzen · Golden Pocket 0.65 nach 0.618 · Settings
onDelete-Signatur + HTML-Button · positionTool totalStep 2 · VM-Ladetest (Stub) ·
style.css nur Tag.

## Deploy
Git-Push (js/app.js, js/overlays.js, js/data.js, js/settings.js, css/style.css,
index.html). Worker unverändert (m77). Gerät: Long/Short-Einstieg rastet über
das KLC-Fadenkreuz, Dominanz-Kerzen mit Körper, Golden-Pocket-Band, Lower-Pane
„Löschen" wieder da.
