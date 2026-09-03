# HANDOFF — Build m81 (an HANDOFF.md anhängen, NIE committen)

Basis: m80. Geänderte Dateien (4): `overlays.js` (der eigentliche Fix), `app.js`
+ `style.css` (nur Build-Tag), `index.html` (nur `?v=`). Build m80 → **m81**.

## DER Magnet-Fix (endlich mit Beweis)
Beweis durch direkten Vergleich der registrierten Overlays:
- `segment` (Linie, funktioniert bei Rey): `performEventMoveForDrawing = undefined`
  → nutzt KLineCharts' NATIVEN StrongMagnet.
- `positionTool` (funktionierte nicht): der registerOverlay-Wrapper hatte ihm
  `magnetSnapValue` aufgezwungen — das ERSETZT KLCs nativen Magnet durch eine
  Variante, die in der Praxis nicht griff.

Die Linien-Tools rasten also gerade *weil* sie magnetSnapValue NICHT haben.
**Fix:** den Wrapper um `&& tpl.name !== "positionTool"` erweitert → positionTool
bekommt kein magnetSnapValue mehr und nutzt, wie die Linien-Tools, KLCs nativen
Magnet (mode = state.magnetMode = strong_magnet wird bereits gesetzt). Fib etc.
behalten magnetSnapValue unverändert.

Verifiziert: positionTool.performEventMoveForDrawing === undefined (wie segment);
fibRetracement unverändert.

## Warum die 20 Runden
Ich habe wiederholt AN magnetSnapValue gearbeitet (Fangbereich, bedingungslos,
setCrosshair, renderPosition-Punkt), statt zu erkennen, dass magnetSnapValue
SELBST das Problem war — die funktionierenden Tools benutzen es gar nicht. Der
Vergleich „hat Overlay X performEventMoveForDrawing?" hätte das sofort gezeigt.

## Prüfungen
node -c alle · positionTool ohne magnetSnapValue (Vergleich mit segment/fib) ·
style.css nur Build-Tag.

## Deploy
Git-Push (js/overlays.js, js/app.js, css/style.css, index.html). Worker unverändert.
Gerät: Long/Short — der Punkt sollte jetzt auf O/H/L/C rasten wie bei den Linien.
