#!/usr/bin/env python3
# usage: ./latency-iq.py <label> <n> [path]
# Same request from a Globalping probe in Iraq (no account needed, ~250 tests/hour).
# Appends to gp-<label>.tsv: label firstByte_ms total_ms server_wallMs colo cf-placement status
import json, sys, time, urllib.request
label, n = sys.argv[1], int(sys.argv[2]); path = sys.argv[3] if len(sys.argv) > 3 else '/three'
API = 'https://api.globalping.io/v1/measurements'
def req(url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=30))
out = open(f'gp-{label}.tsv', 'a')
for i in range(n):
    try:
        m = req(API, {'type': 'http', 'target': 'imamzain-spike.imamzainalabdeen1.workers.dev', 'locations': [{'country': 'IQ', 'limit': 1}],
                      'measurementOptions': {'protocol': 'HTTPS', 'request': {'path': path, 'method': 'GET'}}})
        for _ in range(30):
            time.sleep(1.5); d = req(f"{API}/{m['id']}")
            if d['status'] != 'in-progress': break
        res = d['results'][0]['result']; h = res.get('headers') or {}
        body = res.get('rawBody') or ''
        wall = json.loads(body).get('wallMs') if body.startswith('{') else None
        line = f"{label}\t{res['timings'].get('firstByte')}\t{res['timings'].get('total')}\t{wall}\t{(h.get('cf-ray') or '-').split('-')[-1]}\t{h.get('cf-placement', 'none')}\t{res.get('statusCode')}"
    except Exception as e:
        line = f"{label}\tERR {e}"
    print(line, flush=True); out.write(line + '\n'); out.flush()
