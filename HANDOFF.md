# HANDOFF — Build m77 (an HANDOFF.md anhängen, NIE committen)

Basis: m76. Geänderte Dateien (5): `app.js`, `overlays.js`, `worker-komplett.js`,
`style.css` (nur Build-Tag), `index.html` (nur `?v=`). Build m76 → **m77**.

## 1b — Einstieg-Magnet Desktop (Rückbau + echte Ursache)
Der ganze m75/m76-Umbau (Extra-Fadenkreuz via startMobilePointTool-Maus,
crosshairCanvas sichtbar, KLC-Fadenkreuz aus) war unnötig und **komplett
zurückgebaut**. Desktop nutzt wieder `placePositionByClick` (ein Klick, KLC-
Fadenkreuz normal). **Echte Ursache** war `magnetSnapValue` in overlays.js: ein
Fangbereich `tol = span*0.45` liess den Magnet nur direkt an einem Level greifen
→ in der Praxis "tot". Jetzt rastet er **bedingungslos** auf den nächsten
O/H/L/C (respektiert `__tvLineMagnet` = nur close bei Linien-Assets). Damit rastet
der Einstieg beim Setzen zuverlässig; der Fix gilt für alle Overlays. Test grün.

## Dominanz — Key-Check (Ursache bleibt der Secret)
`getDominance` gibt jetzt eine klare Meldung, wenn `COINGECKO_KEY` fehlt. **Das
btcd=100/usdtd=null kommt daher, dass der Key nicht als Worker-Secret gesetzt ist**
— ohne Key blockt CoinGecko Server-IPs (403), nur der erste Call (BTC) kommt durch.
Code ist korrekt; es fehlt nur der Secret + der Worker-Deploy.

## Muster-Linie folgt beim Verschieben (Punkt 2)
barPattern NATURAL-Modus: `priceToY` zentriert die natürliche Höhe jetzt um die
Box-MITTE statt an der absoluten Preisposition. Damit folgt das Abbild (v.a. im
flachen Linien-Modus) dem Verschieben der Box statt hängen zu bleiben. Test grün
(Linie folgt Box-Versatz 1:1).

## VOL 0-Untergrenze beim Zoom (Punkt 3)
Zwei Ebenen: (a) Mobile-yDrag klemmt `from>=0` für die VOL-Pane direkt; (b) ein
`clampVolAxis`-Listener (mouseup/touchend) fängt auch KLCs Desktop-Y-Zoom ab und
setzt `from` bei Negativwerten auf 0 (Range nach oben bleibt, darunter schwarz).
Zusammen mit dem m76-`gap.bottom:0` bleibt 0 die feste Untergrenze.

## Prüfungen
node -c alle · magnetSnapValue bedingungslos (rastet auch fern, kein Snap bei
normal) · barPattern folgt Box · 1b-Rückbau vollständig (keine Maus-Handler mehr,
placePositionByClick wieder aktiv) · VM-Ladetest (Stub-Artefakt) · style.css nur Tag.

## Deploy
1. Frontend Git-Push (js/app.js, js/overlays.js, css/style.css, index.html).
2. **Worker deployen + `COINGECKO_KEY` als Secret setzen** — sonst bleibt die
   Dominanz kaputt (das ist die alleinige verbleibende Ursache).
3. Gerät: Long/Short-Einstieg rastet auf O/H/L/C (KLC-Fadenkreuz, kein extra),
   Muster-Linie vertikal verschiebbar, VOL nie unter 0.
