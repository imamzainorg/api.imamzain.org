#!/bin/sh
# usage: ./latency.sh <url> <n> <label>
# One line per request: label ttfb_ms server_wallMs http_status cf-placement colo
url=$1; n=$2; label=$3
h=$(mktemp)
for i in $(seq 1 "$n"); do
  out=$(curl -s -D "$h" -w '\n%{time_starttransfer} %{http_code}' "$url")
  set -- $(echo "$out" | tail -1)
  wall=$(echo "$out" | grep -o '"wallMs": [0-9]*' | grep -o '[0-9]*')
  pl=$(grep -i '^cf-placement:' "$h" | tr -d '\r' | cut -d' ' -f2)
  colo=$(grep -i '^cf-ray:' "$h" | tr -d '\r' | rev | cut -d- -f1 | rev)
  echo "$label $(awk "BEGIN{printf \"%d\", $1*1000}") ${wall:--} $2 ${pl:-none} $colo"
done
rm -f "$h"
