# HANDOFF — Build m79 (an HANDOFF.md anhängen, NIE committen)

Basis: m78. Geänderte Dateien (4): `app.js`, `overlays.js`, `style.css`
(Build-Tag + Punkt-4-Regel), `index.html` (nur `?v=`). Build m78 → **m79**.

## Punkt 1 — Fadenkreuz visuell magnetisch (Desktop Long/Short)
Missverständnis geklärt: KLCs Overlay-Magnet rastet nur den GESETZTEN Punkt, nicht
den Cursor — das Fadenkreuz folgte weiter der Maus. Fix: ein mousemove-Handler
während des positionTool-Zeichnens zieht das Fadenkreuz per `chart.setCrosshair`
aktiv auf die gerastete O/H/L/C-Y-Position (nur bei aktivem Magnet, Preisachse
ausgenommen). Cleanup im onDrawEnd + beim nächsten Tool-Start. **Gerätetest** — die
setCrosshair-Interaktion ist nur im Browser final prüfbar.

## Punkt 2 — Golden Pocket hebt sich ab
Die Fläche 0.618–0.65 wird jetzt mit **+10% Deckkraft** (fillAlpha+0.10) und
Goldton (#e8b64c) gefüllt statt mit dem normalen Level-Alpha. Gilt für Retracement
+ Extension, nur wenn die Option aktiv ist. Test grün.

## Punkt 3 — Fadenkreuz-Preisanzeige gleich gross wie Preisskala
`crosshair.horizontal/vertical.text.size: 12` (= yAxis-Standard). Vorher war der
Fadenkreuz-Text kleiner. **Gerätetest** der Grösse.

## Punkt 4 — Indikatoren-Dropdown 50% länger (Desktop)
Neue Regel `#indDropdown .dd-list { max-height: 420px }` (280×1.5). Additiv,
Prüfung 1 zeigt nur diese eine Zeile.

## Prüfungen
node -c alle · Golden Pocket +10%/Gold · Dropdown 420px · CSS 728/728 · style.css
nur Build-Tag + Punkt-4-Regel · VM-Ladetest (Stub).

## Deploy
Git-Push (js/app.js, js/overlays.js, css/style.css, index.html). Worker unverändert.
Gerät prüfen: Fadenkreuz rastet beim Long/Short-Positionieren visuell auf O/H/L/C;
Golden-Pocket-Band deutlich abgehoben; Fadenkreuz-Preis so gross wie Preisskala;
Indikatoren-Dropdown länger.
