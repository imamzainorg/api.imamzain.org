# Pass-through deploy (Phase 2 task 6)

The Worker goes on `api.imamzain.org/*` with zero ported groups: every request is fetched from
`ORIGIN_URL` (Render) with `X-Forwarded-For` set to the visitor's `CF-Connecting-IP`.

## What changes

| Where | Change |
|---|---|
| `worker/wrangler.jsonc` | Route `api.imamzain.org/*` on zone `imamzain.org`; `workers_dev: false` |
| Render env (Nest) | `TRUST_PROXY_HOPS=2` so `req.ip` is the visitor (audit IPs and throttles) |
| DNS | None. `api.imamzain.org` stays a proxied CNAME to Render; the Worker fetches `onrender.com` directly, so there is no loop |

## Secrets

Nothing in the pass-through path reads a secret (`proxyToOrigin` only uses `ORIGIN_URL`; `JWT_SECRET`
is read only by auth middleware, which no route mounts yet). So **no `wrangler secret put` is needed
for this deploy**. Set each one in the PR that first ports a group using it:

| Secret | First needed by |
|---|---|
| `JWT_SECRET` (same value as Nest) | first group with auth (pilot `post-categories`, admin routes) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | media (4f) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_TEMPLATE_SID` | contest (4e) |
| `NEWSLETTER_UNSUBSCRIBE_SECRET`, `CONTEST_ATTEMPT_SECRET` | newsletter / contest, only if set on Nest |

Optional now, harmless: `cd worker && npx wrangler secret put JWT_SECRET`.

## Before attaching the route

The origin must answer on the exact host in `ORIGIN_URL` (the first attempt returned 404 with
`x-render-routing: blocked-render-subdomain` because the old service rejected its onrender.com host):

```bash
curl -si https://api-imamzain-org-temp.onrender.com/api/v1/health | head -5   # must be 200
```

`TRUST_PROXY_HOPS=2` goes on the Render service behind `api-imamzain-org-temp` (the one `api.imamzain.org` serves today).

## Steps

1. **Local smoke (optional, no prod change).** `cd worker && npm ci && npm run dev`, then
   `curl -i localhost:8787/api/v1/health` should return Nest's health response.
2. **Merge the PR** after CI is green.
3. **Deploy the Worker:** `cd worker && npm ci && npx wrangler deploy`. The route attaches at once.
4. **Set `TRUST_PROXY_HOPS=2` on Render** (service → Environment). Render restarts the instance (cold start, a few seconds of 503).
   This is safe before or after step 3 and on rollback: the Worker overwrites `X-Forwarded-For`
   with one entry, and Render appends the peer, the same shape as today's Cloudflare-proxied traffic.
5. **Verify** (below). Watch `npx wrangler tail --status error` for ~10 minutes.

## Verification

Replace `<you>` with your CMS username and `$API` with `https://api.imamzain.org`.

**1. Traffic goes through the Worker and is unchanged**

```bash
API=https://api.imamzain.org
curl -si $API/api/v1/health | head -20            # 200, same body as before
curl -si $API/api/v1/books?limit=1 | head -20      # same envelope/headers as before
```

In `wrangler tail` each request logs `{"event":"fallthrough","method":"GET","path":"/api/v1/..."}`.

**2. CORS and headers unchanged** (compare with a pre-deploy capture if you took one)

```bash
curl -si -X OPTIONS $API/api/v1/books \
  -H 'Origin: https://cms.imamzain.com' \
  -H 'Access-Control-Request-Method: GET' | head -20
# expect access-control-allow-origin: https://cms.imamzain.com
curl -si $API/api/v1/health -H 'Origin: https://evil.example' | grep -i access-control
# expect no allow-origin header
curl -si $API/api/v1/health | grep -iE 'strict-transport|x-content-type|content-security|etag'
```

**3. Real client IP reaches Nest** (needs step 4 done)

Log in to the CMS (or `curl -X POST $API/api/v1/auth/login ...`), then in Supabase SQL:

```sql
SELECT created_at, action, ip_address, user_agent
FROM audit_logs
ORDER BY created_at DESC
LIMIT 5;
```

`ip_address` must be **your** public IP (check with `curl -s https://ifconfig.me`), not a
Cloudflare address (104.x, 172.64-71.x, 162.158-159.x). Throttles use the same `req.ip`, so this also
proves they key on clients.

Spoof check: a client-sent header must not win.

```bash
curl -si -X POST $API/api/v1/auth/login -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 1.2.3.4' -d '{"username":"nobody","password":"x"}' >/dev/null
```

```sql
SELECT ip_address FROM audit_logs WHERE action = 'USER_LOGIN_FAILED' ORDER BY created_at DESC LIMIT 1;
-- must NOT be 1.2.3.4 (it should be your IP)
```

If it shows a Cloudflare IP, `TRUST_PROXY_HOPS` is too low; if `1.2.3.4`, it is too high. Adjust on Render.

**4. Added latency is small**

```bash
for i in $(seq 1 20); do curl -so /dev/null -w '%{time_starttransfer}\n' $API/api/v1/health; done | sort -n
```

Compare p50/p95 with the same loop against `https://api-imamzain-org-temp.onrender.com/api/v1/health`.
Expect tens of ms added at most (Render cold starts dominate otherwise).

**5. Website and forms**

Open imamzain.org, submit a test contact form, then delete the submission:

```sql
SELECT id, created_at FROM contact_submissions ORDER BY created_at DESC LIMIT 1;
-- delete via the CMS, or: DELETE FROM contact_submissions WHERE id = '<id>';
```



## Rollback

`wrangler rollback` does **not** work for this deploy: it is the first version of `imamzain-api`, so
there is nothing to roll back to. Detach the route instead; traffic returns to Render directly within seconds:

- Dashboard: Workers & Pages → `imamzain-api` → Settings → Domains & Routes → delete `api.imamzain.org/*`, or
- Edit `wrangler.jsonc` to `"routes": []` and `npx wrangler deploy`.

`TRUST_PROXY_HOPS=2` can stay (see step 4). From the second deploy on, `npx wrangler rollback` works as in the runbook.
