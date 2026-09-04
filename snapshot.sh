#!/usr/bin/env bash
# ============================================================
# Historie-Momentaufnahmen erzeugen
#
# Laedt die vollstaendige Altdatenhistorie EINMAL und legt sie als
# statische Dateien im Repo ab. Danach holt der Browser die Altdaten vom
# GitHub-Pages-CDN und fragt nur noch nach dem Zuwachs seit der letzten
# gespeicherten Kerze.
#
# Zwei Bezugswege, weil die Quellen sich unterscheiden:
#   • Bitstamp und LBMA laufen ueber den Worker (kein CORS, Weissliste,
#     serverseitige Paginierung)
#   • Binance wird direkt abgefragt — der Endpunkt ist oeffentlich und
#     erlaubt CORS, ein Worker waere ein Umweg ohne Nutzen
#
# Wann erneut ausfuehren?
#   Nie zwingend — der Zuwachs-Pfad haelt den Chart aktuell. Sinnvoll
#   etwa jaehrlich, damit der taegliche Zuwachs klein bleibt, oder wenn
#   eine Quelle ihre Historie rueckwirkend korrigiert hat.
#
# Aufruf im Repo-Wurzelverzeichnis:
#   bash snapshot.sh
# ============================================================
set -uo pipefail

# ---- Python-Interpreter finden (verifiziert, nicht nur Name-Existenz) ----
# Wichtig auf Windows/Git-Bash: dort ist "python3" oft nur der Microsoft-
# Store-Alias-Stub, der nichts tut und mit Fehler abbricht. Darum jeden
# Kandidaten mit einem echten Mini-Aufruf pruefen und den ERSTEN nehmen,
# der wirklich laeuft. So funktioniert das Skript unabhaengig davon, ob
# Python bei dir "python3", "python" oder "py" heisst.
PY=""
for _cand in python3 python py; do
  if command -v "$_cand" >/dev/null 2>&1 \
     && [ "$("$_cand" -c 'print(1)' 2>/dev/null)" = "1" ]; then
    PY="$_cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo "FEHLER: kein funktionierendes Python 3 gefunden (getestet: python3, python, py)."
  echo "Auf Windows ist 'python3' meist nur der Microsoft-Store-Platzhalter."
  echo "Abhilfe: Python von python.org installieren (Haken 'Add python.exe to PATH'),"
  echo "oder sicherstellen, dass 'python' ein echtes Python 3 startet."
  exit 1
fi
echo "Python: $PY ($("$PY" --version 2>&1))"

WORKER="https://pantarey.rey-gafner.workers.dev"
OUT="data"
mkdir -p "$OUT"

fehler=0

# Plausibilitaet PRUEFEN, nicht annehmen: eine Fehlermeldung des Workers
# ist auch gueltiges JSON und wuerde sonst als Momentaufnahme im Repo
# landen.
pruefen() {
  "$PY" - "$1" "$2" <<'PYEOF'
import json, sys, datetime
pfad, mindest = sys.argv[1], int(sys.argv[2])
try:
    d = json.load(open(pfad))
except Exception as e:
    print("ERR:kein gueltiges JSON (%s)" % e); sys.exit(0)
if isinstance(d, dict) and "error" in d:
    print("ERR:" + str(d["error"])); sys.exit(0)
c = d.get("candles") if isinstance(d, dict) else None
if not isinstance(c, list):
    print("ERR:kein candles-Array"); sys.exit(0)
if len(c) < mindest:
    print("ERR:nur %d Kerzen, erwartet mindestens %d" % (len(c), mindest)); sys.exit(0)
ts = [k[0] for k in c]
if ts != sorted(ts):
    print("ERR:Kerzen nicht aufsteigend sortiert"); sys.exit(0)
if len(set(ts)) != len(ts):
    print("ERR:doppelte Zeitstempel"); sys.exit(0)
_epoch = datetime.datetime(1970, 1, 1)   # naive UTC-Basis; plattformunabhaengig auch fuer ts<0
f = (_epoch + datetime.timedelta(milliseconds=ts[0])).date()
t = (_epoch + datetime.timedelta(milliseconds=ts[-1])).date()
print("OK:%d:%s:%s" % (len(c), f, t))
PYEOF
}

ablegen() {
  local tmp="$1" ziel="$2" mindest="$3"
  local ergebnis; ergebnis="$(pruefen "$tmp" "$mindest")"
  case "$ergebnis" in
    OK:*)  : ;;                                          # erwartetes Format
    ERR:*) echo "   FEHLER: ${ergebnis#ERR:}"; rm -f "$tmp"; fehler=1; return 1 ;;
    *)     echo "   FEHLER: unerwartete Pruefantwort (leer/kein OK:) -- Datei NICHT abgelegt"
           rm -f "$tmp"; fehler=1; return 1 ;;
  esac
  local anzahl von bis
  IFS=: read -r _ anzahl von bis <<<"$ergebnis"
  mv "$tmp" "$ziel"
  echo "   $anzahl Kerzen  $von bis $bis  ($(du -h "$ziel" | cut -f1))  ->  $ziel"
}

# ---- Worker-Quellen (Bitstamp, LBMA) ----
via_worker() {
  local name="$1" url="$2" ziel="$3" mindest="$4"
  echo "-- $name"
  local tmp; tmp="$(mktemp)"
  if ! curl -fsS --max-time 180 "$url" -o "$tmp"; then
    echo "   FEHLER: Abruf fehlgeschlagen -- $url"; rm -f "$tmp"; fehler=1; return 1
  fi
  ablegen "$tmp" "$ziel" "$mindest"
}

# ---- Binance direkt, vorwaerts paginiert ----
#
# Binance gibt hoechstens 1000 Kerzen je Anfrage. BTC/USDT seit August
# 2017 sind rund 3300 Tageskerzen, also vier Seiten. Die Paginierung
# laeuft ueber startTime, weil die Untergrenze bekannt und die Obergrenze
# offen ist.
via_binance() {
  local name="$1" symbol="$2" ziel="$3" mindest="$4"
  echo "-- $name"
  local tmp; tmp="$(mktemp)"
  if ! "$PY" - "$symbol" "$tmp" <<'PYEOF'
import json, sys, urllib.request, time
symbol, ziel = sys.argv[1], sys.argv[2]
BASE = "https://api.binance.com/api/v3/klines"
start, alle = 0, {}
for _ in range(12):
    # startTime IMMER setzen (auch 0): sonst liefert Binance die NEUESTEN
    # 1000 Kerzen, die Schleife springt in die Zukunft und bricht nach
    # einer Seite ab. Mit startTime=0 wird ab der aeltesten vorwaerts paginiert.
    url = "%s?symbol=%s&interval=1d&limit=1000&startTime=%d" % (BASE, symbol, start)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            raw = json.load(r)
    except Exception as e:
        print("Abruf fehlgeschlagen: %s" % e, file=sys.stderr)
        sys.exit(1)
    if not raw:
        break
    for k in raw:
        alle[k[0]] = [k[0], float(k[1]), float(k[2]),
                      float(k[3]), float(k[4]), float(k[5])]
    if len(raw) < 1000:
        break
    letzte = raw[-1][0]
    if letzte <= start:
        break
    start = letzte + 1
    time.sleep(0.2)          # hoeflich gegenueber der API bleiben
kerzen = [alle[t] for t in sorted(alle)]
json.dump({"source": "Binance %s (1d)" % symbol,
           "from": kerzen[0][0] if kerzen else 0,
           "to": kerzen[-1][0] if kerzen else 0,
           "count": len(kerzen), "candles": kerzen}, open(ziel, "w"))
PYEOF
  then
    echo "   FEHLER: Binance-Abruf fehlgeschlagen"; rm -f "$tmp"; fehler=1; return 1
  fi
  ablegen "$tmp" "$ziel" "$mindest"
}

via_worker  "BTC/USD (Bitstamp)" "$WORKER/bitstamp?pair=btcusd&step=86400" "$OUT/btcusd-bitstamp.json" 4000
via_worker  "ETH/USD (Bitstamp)" "$WORKER/bitstamp?pair=ethusd&step=86400" "$OUT/ethusd-bitstamp.json" 2000
via_worker  "Gold (LBMA)"        "$WORKER/goldhistory"                     "$OUT/gold-lbma.json"       10000
via_binance "BTC/USDT (Binance)" "BTCUSDT" "$OUT/btcusdt-binance.json" 2500
via_binance "ETH/USDT (Binance)" "ETHUSDT" "$OUT/ethusdt-binance.json" 2500

echo
if [ "$fehler" -eq 0 ]; then
  echo "Alle Momentaufnahmen erzeugt. Committen:"
  echo "  git add data/ && git commit -m 'Historie-Momentaufnahmen' && git push"
else
  echo "MINDESTENS EINE QUELLE HAT VERSAGT -- bitte oben nachsehen."
  echo "Die uebrigen Dateien sind gueltig; fehlende Symbole laden weiterhin"
  echo "vollstaendig nach, es geht also nichts kaputt."
  exit 1
fi
