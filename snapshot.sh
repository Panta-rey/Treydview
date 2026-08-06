#!/usr/bin/env bash
# ============================================================
# Historie-Momentaufnahmen erzeugen
#
# Laedt die vollstaendige Altdatenhistorie EINMAL vom Worker und legt sie
# als statische Dateien im Repo ab. Danach holt der Browser die Altdaten
# vom GitHub-Pages-CDN und fragt den Worker nur noch nach dem Zuwachs.
#
# Wann erneut ausfuehren?
#   Nie zwingend — der Zuwachs-Pfad haelt den Chart aktuell. Sinnvoll
#   etwa jaehrlich, damit der taegliche Zuwachs klein bleibt, oder wenn
#   eine Quelle ihre Historie rueckwirkend korrigiert hat.
#
# Aufruf im Repo-Wurzelverzeichnis:
#   bash snapshot.sh
# ============================================================
set -euo pipefail

WORKER="https://pantarey.rey-gafner.workers.dev"
OUT="data"

mkdir -p "$OUT"

hole() {
  local name="$1" url="$2" ziel="$3"
  echo "── $name"
  local tmp; tmp="$(mktemp)"
  if ! curl -fsS --max-time 120 "$url" -o "$tmp"; then
    echo "   FEHLER: Abruf fehlgeschlagen — $url"
    rm -f "$tmp"; return 1
  fi
  # Plausibilitaet PRUEFEN, nicht annehmen: eine Fehlermeldung des Workers
  # ist auch gueltiges JSON und wuerde sonst als Momentaufnahme im Repo
  # landen.
  local anzahl
  anzahl="$(python3 -c "
import json,sys
d=json.load(open('$tmp'))
if 'error' in d: print('ERR:'+str(d['error'])); sys.exit(0)
c=d.get('candles')
print(len(c) if isinstance(c,list) else 'ERR:kein candles-Array')
")"
  case "$anzahl" in
    ERR:*) echo "   FEHLER: ${anzahl#ERR:}"; rm -f "$tmp"; return 1 ;;
  esac
  if [ "$anzahl" -lt 500 ]; then
    echo "   FEHLER: nur $anzahl Kerzen — das sieht nach einem Teilabruf aus."
    rm -f "$tmp"; return 1
  fi
  mv "$tmp" "$ziel"
  echo "   $anzahl Kerzen  ->  $ziel  ($(du -h "$ziel" | cut -f1))"
  python3 -c "
import json,datetime
d=json.load(open('$ziel'))
f=datetime.datetime.utcfromtimestamp(d['candles'][0][0]/1000).date()
t=datetime.datetime.utcfromtimestamp(d['candles'][-1][0]/1000).date()
print('   Zeitraum:', f, 'bis', t)
"
}

hole "BTC/USD (Bitstamp)" "$WORKER/bitstamp?pair=btcusd&step=86400" "$OUT/btcusd-bitstamp.json"
hole "Gold (LBMA)"        "$WORKER/goldhistory"                     "$OUT/gold-lbma.json"

echo
echo "Fertig. Committen:"
echo "  git add data/ && git commit -m 'Historie-Momentaufnahmen' && git push"
