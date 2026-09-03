# HANDOFF — Build m80 (an HANDOFF.md anhängen, NIE committen)

Basis: m79. Geänderte Dateien (4): `app.js`, `overlays.js`, `style.css`
(nur Build-Tag), `index.html` (nur `?v=`). Build m79 → **m80**.

## Punkt 1 — Fadenkreuz-Rasten wie bei Linien-Tools
Reys Hinweis war der Schlüssel: Linien-Tools zeigen Fadenkreuz + einen Punkt, der
magnetisch rastet. positionTool gab in der Zeichenphase (renderPosition,
coordinates<2) nichts zurück → kein sichtbarer Punkt. Der setCrosshair-Umweg (m79)
ist **zurückgebaut**. Jetzt: `renderPosition` zeichnet in der Zeichenphase
(currentStep!==-1) einen Punkt am letzten (via magnetSnapValue gerasteten)
Koordinatenpunkt — genau wie die Linien-Tools. Test grün (Kreis erscheint).
**Gerätetest** der Rast-Vorschau.

## Punkt 3 — Fadenkreuz-Preis gleich gross wie Preisskala
Ursache war nicht die Grösse (beide 12), sondern die **Schriftart**: die Preisskala
nutzt `IBM Plex Mono` (monospace, wirkt breiter), der Fadenkreuz-Text den
KLC-Default (Helvetica). Fix: `crosshair.text.family: IBM Plex Mono` (+ size 12) →
gleiche Schrift + Grösse wie die Preisskala.

## Prüfungen
node -c alle · renderPosition-Zeichenphasen-Punkt · setCrosshair-Rückbau vollständig
· crosshair family gesetzt · VM-Ladetest (Stub) · style.css nur Tag.

## Deploy
Git-Push (js/app.js, js/overlays.js, css/style.css, index.html). Worker unverändert.
Gerät: Long/Short — beim Bewegen erscheint der Magnet-Punkt und rastet sichtbar auf
O/H/L/C (wie bei Linien); Fadenkreuz-Preis so gross wie die Preisskala-Zahlen.
