#!/bin/sh
# usage: ./check.sh https://imamzain-spike.<subdomain>.workers.dev [image.jpg]
# Calls every check route once and prints route + pass/error. Full JSON goes to results/.
# /images runs only when an image is given. /email is left out on purpose: POST it by hand.
set -u
base=${1:?base url}
mkdir -p results
for r in ping find-many similarity bigint tx tx-error three bcrypt pg-select1 select1 select1x5 connect-only; do
  curl -s "$base/$r" > "results/$r.json"
  printf '%-13s %s\n' "$r" "$(grep -o '"pass": [a-z]*\|"code": "P[0-9]*"\|"error"' "results/$r.json" | head -1)"
done
if [ -n "${2:-}" ]; then
  curl -s -X POST --data-binary "@$2" "$base/images" > results/images.json
  printf '%-13s %s\n' images "$(grep -o '"pass": [a-z]*\|"error"' results/images.json | head -1)"
fi
