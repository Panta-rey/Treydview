# HANDOFF — Build m76 (an HANDOFF.md anhängen, NIE committen)

Basis: m75 (live). Geänderte Dateien (7): `app.js`, `indicators.js`, `overlays.js`,
`worker-komplett.js`, `config.js`, `style.css` (nur Build-Tag), `index.html`
(nur `?v=`). Build m75 → **m76**.

## 1b — Fadenkreuz-Magnet Desktop (Niedrig)
Ursache: `.crosshair-canvas` ist im Basis-CSS `display:none` (nur mobil sichtbar)
→ das Magnet-Fadenkreuz war auf Desktop unsichtbar. Fix: `startMobilePointTool`
setzt beim Anzeigen `canvas.style.display="block"` (inline, überschreibt Basis-CSS)
und blendet KLCs eigenes Fadenkreuz aus (`crosshair.show=false`), cleanup stellt
beides zurück. **Gerätetest.**

## D+M 5 — Countdown-Farbe (Niedrig)
Zweite Tag-Zeile jetzt mit Preis-Farbe (up/down `bg`) hinterlegt statt dunkelgrau.

## D+M 1 — MA-Glättung (Hoch)
`maContext.project` interpoliert jetzt linear zwischen aktuellem und nächstem
Bucket-MA (je Bar-Position im Bucket) statt forward-fill → glatte statt stufige
Linie. Greift nur im gröberen-Intervall-Fall; auto-Fall bit-genau unverändert
(Test grün). Look-ahead innerhalb des Buckets ist bewusst (Darstellung).

## D+M 2 — Dominanz-Worker (Hoch)
Zwei Fixes: (1) pro Coin/Tag nur letzter MC (Doppelpunkt am aktuellen Tag behoben
→ kein 49.5%-Artefakt); (2) `interval=daily` entfernt (Enterprise-only; ohne
liefert Demo bei days=365 Tagesdaten) + 120ms-Drosselung gegen Rate-Limit-Bursts.
**Kritisch:** `COINGECKO_KEY` MUSS als Worker-Secret gesetzt sein, sonst keyless →
403 → nur BTC kommt durch (das war die btcd=100/usdtd=null-Ursache).
**Snapshot-404:** BTCUSDT/ETHUSDT aus `HISTORY_SNAPSHOTS` entfernt (Files fehlen
bewusst im Repo, voller Binance-Abruf lief eh) → kein 404 mehr.

## D+M 3 — Muster-Linie vertikal verschiebbar (Hoch)
Trefferzone bekommt Mindesthöhe 44px (vorher = Close-Spanne, im Linien-Modus zu
dünn zum vertikalen Greifen). Test grün. **Gerätetest** der Interaktion.

## D+M 4 — VOL 0-Verankerung (Hoch)
Bundle-Analyse: `minValue:0` zieht die Datengrenze auf 0, aber der Pane-Default
`gap.bottom:0.1` erzeugt den Negativpuffer. Fix: `setPaneOptions({id:"pane_myvol",
gap:{top:0.2,bottom:0}})` nach createIndicator → Balken sitzen auf 0, oberer Puffer
bleibt, yDrag (Schieben/Zoomen) unberührt. **Gerätetest** (KLC-Achse nicht
container-testbar).

## Prüfungen
node -c alle · D+M1 auto=Referenz + Glättung · D+M3 Trefferzone 44px · D+M2
Doppelpunkt-Logik · VM-Ladetest (Stub-Artefakt) · style.css nur Build-Tag.

## Deploy-Reihenfolge
1. Frontend: Git-Push (js/, css/, index.html).
2. Worker: `worker-komplett.js` deployen **+** `COINGECKO_KEY` als Secret setzen —
   sonst bleibt die Dominanz bei btcd=100.
3. Gerät: 1b (Fadenkreuz grün auf O/H/L/C), Muster-Linie vertikal, VOL auf 0,
   Countdown-Farbe, Dominanz nach Key.

## Weiter offen
Tote `gbRenderTiers`/`gbRenderData` in app.js (aus m74) weiter unangetastet.
