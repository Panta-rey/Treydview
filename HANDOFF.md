# HANDOFF — Build m74 (an bestehendes HANDOFF.md anhängen, NIE committen)

## Übersicht
Fünf Features in einem Paket, aufbauend auf Reys manuell editierter m73-Basis.
Geänderte Dateien (8): `app.js`, `indicators.js`, `config.js`, `data.js`,
`overlays.js`, `worker-komplett.js`, `style.css` (nur Build-Tag), `index.html`
(nur `?v=`-Bumps). `gridbot.js` unverändert. Build m73 → **m74**.

## Basis-Hinweis
Reys deployte `indicators.js` enthielt `wmaAt` + `smaSeries`-Alias wieder — die
m72-Tote-Code-Entfernung war dort nicht drin. Auf Reys Version aufgebaut, die
zwei toten Helfer belassen (harmlos).

## Feature 1 — Magnet Long/Short (Desktop)
**Ursache:** Nicht der Einstiegsklick (der rastet korrekt via `snapEntryValue`),
sondern der Desktop-**Zug-Handler** (Griffe verschieben, „4b4. Desktop") nahm
`moved.value` roh. **Fix:** `snapEntryValue({timestamp: startPts[pointIndex].
timestamp, value: moved.value})` — rastet nur den Wert auf O/H/L/C, Zeitstempel
bleibt. Bei Magnet aus (`magnetMode==="normal"`) gibt snapEntryValue unverändert
zurück → Zero-Impact. Verifiziert: node -c.

## Feature 2a — EMA/SMA-Intervall
**Ursache:** `MYSMA.calc` schnitt den 5. calcParam (tf) ab, `EMA.calc` mappte
blind über alle Params (rechnete sinnlos `emaSeries(closes,"auto")`). tf wurde
nie zum Resampling genutzt. **Fix:** neue Helfer in `indicators.js` (`_TF_MS`,
`chartIntervalMs`, `resampleCloses`, `maContext`). `maContext(dataList, tf)`
liefert `{closes, project}`: bei „auto"/zu feinem tf Identität auf Chart-Closes,
sonst aggregierte Bucket-Closes + Rückprojektion (forward-fill, stufig). MYSMA/EMA
nutzen jetzt tf. **5 Unit-Tests grün**, u.a. auto == Referenz (bit-genau,
Zero-Impact) und 1w == manuell aggregierter Wochen-MA.

## Feature 2b — BMSB-Intervall
Neues `tf`-Select in `config.js` (bmsb inputs, Optionen auto/15m/1h/4h/1d/1w/1M),
`app.js` calcParams `[20,21,inp.tf||"auto"]`, `BMSB.calc` nutzt `maContext`.
BMSB-auto == Referenz (Test grün).

## Feature 3 — Dominanz BTC.D / USDT.D (Variante A)
**Worker** (`worker-komplett.js`): neuer `/dominance`-Endpunkt. CoinGecko
Demo-API, Top-40-Coins-Summe → BTC.D/USDT.D, 1 Jahr täglich, 24h-KV-Cache,
41 Subrequests (< 50er-Limit), Einzelausfälle toleriert. Liest
`env.COINGECKO_KEY` (Header `x-cg-demo-api-key`), keyless-Fallback.
**Frontend** (5 Berührungspunkte): `config.js` — BTCD/USDTD-Symbole nach
SOLUSDT + CURATED_IDS; `app.js` — VERGLEICH_IMMER + loadData-Zweig +
refreshCompareData-Zweig; `data.js` — `fetchDominance(domCoin)` (flache Kerzen
o=h=l=c). Statisch verifiziert (node -c, VM-Ladetest, Symbol-Struktur).
**OFFEN / Live-Test nötig:** (1) `wrangler secret put COINGECKO_KEY` setzen
(Key: CG-T18… — im Chat geteilt, ggf. rotieren). (2) Worker deployen. (3)
`curl …/dominance` prüfen. (4) In App BTC.D wählen. Der Worker ist vom
Container nicht testbar (CoinGecko nicht erreichbar).

## Feature 4 — Kerzen-Muster-Tool (Bars Pattern)
Neues `barPattern`-Overlay (`overlays.js`, vor dem Magnet-Wrapper, `totalStep:3`,
`needDefaultPointFigure:true`). Zwei-Punkt-Auswahl → Ziel-Box; onDrawEnd
(`app.js`) fixiert `srcStart/srcEnd` + `lineMode` (Kerze/Linie je `chartType`)
in extendData; `createPointFigures` rendert die Quellkerzen als bewegliches
Abbild. Flache Box → natürliche Höhe (yAxis); aufgezogene Box → skaliert in X/Y.
app.js-Integrationen (6): TOOL_ICONS.barPattern, Tool-Eintrag „zones",
SAVED_OVERLAYS, onDrawEnd, Hit-Test (wie FRVP), Mobile-Ausnahme.
**Render-Logik: 4 Overlay-Testfälle grün.** **Interaktion (Zeichnen, Verschieben,
X/Y-Skalieren, Touch) NUR am Gerät prüfbar** — erwartete Iterationsstelle.

## Offener Punkt: tote Duplikate
Reys manuell wieder eingefügte `gbRenderTiers`/`gbRenderData` in `app.js` sind
weiter toter Code (nie aufgerufen; die app.js-`gbRenderTiers` ruft ein in app.js
nicht existentes `gbDrawBands` → latenter, nie feuernder ReferenceError). In m74
**belassen** (kein ungefragtes Entfernen von Reys Code). Auf ein „ja" hin in
einem Nachgang entfernbar.

## Prüfungen bestanden
node -c alle · MA-Unit-Tests (5) · barPattern-Overlay-Test (4) · VM-Ladetest
(kein neuer TDZ/ReferenceError) · CSS-Braces 727/727 · style.css nur Build-Tag
(Desktop unberührt) · index.html nur ?v= · WORKER_BASE_URL erhalten.

## Restrisiko transparent
Feature 1/2 vollständig verifiziert. Feature 3-Worker (externe API) und Feature 4
(interaktives Overlay) sind statisch/funktional geprüft, aber End-to-End nur am
Live-System bzw. Gerät — dort testen.
