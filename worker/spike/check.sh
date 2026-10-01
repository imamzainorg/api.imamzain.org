#!/bin/sh
# usage: ./check.sh https://imamzain-spike.<subdomain>.workers.dev
# Calls every check route once and prints route + pass/error. Full JSON goes to results/.
set -u
base=${1:?base url}
mkdir -p results
for r in ping find-many similarity bigint tx tx-error pg-select1 select1 select1x5 connect-only; do
  curl -s "$base/$r" > "results/$r.json"
  printf '%-13s %s\n' "$r" "$(grep -o '"pass": [a-z]*\|"code": "P[0-9]*"\|"error"' "results/$r.json" | head -1)"
done
