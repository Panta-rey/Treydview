# HANDOFF — Build m82 (an HANDOFF.md anhängen, NIE committen)

Basis: m81. Geänderte Dateien (4): `app.js`, `overlays.js`, `style.css`
(nur Build-Tag), `index.html` (nur `?v=`). Build m81 → **m82**.

## Punkt 1.2 — Magnet greift auch bei Reihenfolge „erst Long/Short, dann Magnet"
Der positionTool-Desktop-Zweig rief `chart.createOverlay(cfg)` direkt auf, ohne
`state.drawingId` zu setzen (das macht sonst startTool). Damit lief
`applyMagnetToActiveDrawing()` beim Magnet-Klick ins Leere (`if (!state.drawingId)
return`) → der laufende Zeichenvorgang blieb auf mode „normal". Fix: `state.drawingId`
wird jetzt aus dem createOverlay-Ergebnis gesetzt (und im onDrawEnd wieder auf null).
Damit zieht der Magnet-Button den mode des laufenden Long/Short-Overlays nach —
selber Mechanismus wie bei den Linien-Tools (overrideOverlay({id, mode})).

## Punkt 2 — Long/Short-Auswahl-Dropout bündig neben der Leiste
Der Desktop-Zweig zentrierte das lsChoice-Menü unter dem Knopf → es ragte nach
links über die schmale Werkzeugleiste. Jetzt: linke Kante = rechte Kante der
`#drawbar` (getBoundingClientRect().right), top auf Knopfhöhe → Menü sitzt bündig
rechts neben der Leiste.

## Punkt 3 — Golden Pocket +20%
Deckkraft-Aufschlag des 0.618–0.65-Bandes von +0.10 auf **+0.20** erhöht (z.B.
0.05 → 0.25) — hebt sich deutlicher ab.

## Prüfungen
node -c alle · drawingId gesetzt + cleanup · lsChoice barRight · Golden Pocket 0.25
· style.css nur Build-Tag · VM-Ladetest (Stub).

## Deploy
Git-Push (js/app.js, js/overlays.js, css/style.css, index.html). Worker unverändert.
Gerät: (a) Long/Short wählen, DANN Magnet an → Punkt rastet; (b) Auswahl-Menü sitzt
bündig rechts neben der Leiste; (c) Golden-Pocket-Band deutlicher.
