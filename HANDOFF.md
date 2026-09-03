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
