# We Move NY — Operations Runbook

## Quick Reference

| Service | Dashboard |
|---|---|
| Vercel (hosting) | vercel.com → wemovenewyork team |
| Neon (database) | console.neon.tech |
| Upstash (Redis) | console.upstash.com |
| Resend (email) | resend.com/emails |
| Sentry (errors) | sentry.io |

Contact: wemovenewyork.net@gmail.com

---

## Local Setup

Fresh checkouts require generating the Prisma client before TypeScript or builds will work:

    npm install
    npx prisma generate

The `postinstall` script attempts this automatically, but can silently fail in some
environments (notably some IDE-managed terminals and devcontainer first-runs). If
`npx tsc --noEmit` reports `TS2305: has no exported member 'PrismaClient'`, run
`npx prisma generate` manually.

CI (.github/workflows/ci.yml) runs `npx prisma generate` explicitly before build,
so deployments are unaffected.

---

## Rollback a Bad Deploy

### Option A — Instant rollback via Vercel dashboard (preferred)
1. Vercel dashboard → Project → Deployments tab
2. Find the last known-good deployment
3. Click the `…` menu → **Promote to Production**
4. Production traffic shifts in ~30 seconds. No code change, no git history affected.

### Option B — Git revert
```bash
git log --oneline -10          # find the bad commit hash
git revert <bad-commit-hash>   # creates a revert commit
git push origin main           # triggers new Vercel deploy
```

### Option C — Hard reset (last resort — destroys history)
```bash
git reset --hard <good-commit-hash>
git push --force-with-lease origin main
```
Only use Option C if the bad commit contains secrets that must be scrubbed from history.

---

## Database Rollback

Migrations are in `prisma/migrations/`. They are **not automatically reversible**.

### To undo the most recent migration:
1. Write a reverse migration SQL manually (e.g. `DROP TABLE blocks;` to undo `20260416_block_enforcement`)
2. Save it as `prisma/migrations/YYYYMMDD_rollback_<name>/migration.sql`
3. Apply with:
```bash
DATABASE_URL="<direct-url>" npx prisma migrate deploy
```
4. Update `prisma/schema.prisma` to match

**Never run `prisma migrate reset` in production** — it drops all data.

---

## Environment Variable Rotation

### Rotate JWT secrets (forces all users to re-login):
1. Vercel → Project → Settings → Environment Variables
2. Update `JWT_SECRET` and/or `JWT_REFRESH_SECRET` with a new random value:
   ```bash
   openssl rand -base64 48
   ```
3. Redeploy (new deployments pick up the new value; existing sessions expire within 15 min for access tokens, 7 days for refresh tokens)

### Rotate Neon DB password:
1. Neon console → Project → Roles → Reset password for `neondb_owner`
2. Update `DATABASE_URL` in Vercel env vars with the new password
3. Redeploy

### Rotate Upstash Redis credentials:
1. Upstash console → Database → Reset token
2. Update `UPSTASH_REDIS_REST_TOKEN` and `UPSTASH_REDIS_REST_URL` in Vercel
3. Redeploy

---

## Maintenance Mode

Set `MAINTENANCE_MODE=true` in Vercel environment variables, then redeploy.
All traffic is redirected to `/maintenance` except `/api/health` and static assets.

To disable: remove or set to `false`, redeploy.

---

## Emergency User Actions

All admin actions require an account with `role = "admin"` or `"subAdmin"`.

### Suspend a user immediately:
Admin dashboard → Users → find user → set `suspendedUntil` to a future date.
Or directly via Neon SQL console:
```sql
UPDATE users SET suspended_until = NOW() + INTERVAL '30 days' WHERE email = 'user@example.com';
```

### Delete/anonymize a user:
Admin dashboard → Users → Delete. This anonymizes (does not hard-delete) the account.

### Revoke an invite code:
Admin dashboard → Invite Codes → Revoke.

---

## Monitoring

- **Errors**: Sentry dashboard — set up alerts for new issues and spike detection
- **Uptime**: `/api/health` returns `{"status":"ok"}` when DB is reachable; use an external uptime monitor (e.g. Better Uptime, UptimeRobot) to ping this endpoint every minute
- **Redis failures**: Watch Vercel function logs for `[rateLimit] Redis error` — rate limiting is failing open when this appears
- **Email deliverability**: Resend dashboard → Emails tab — check bounce/complaint rates

---

## Cron Jobs

Cron schedules are in `vercel.json`. All require the `CRON_SECRET` env var as a Bearer token.

| Job | Schedule | Purpose |
|---|---|---|
| `/api/cron/expire-swaps` | Daily | Mark past-date swaps as expired |
| `/api/cron/expiring-soon` | Daily | Notify operators of swaps expiring tomorrow (NYC time) |
| `/api/cron/cleanup-swaps` | Daily (`0 8 * * *`) | Two-phase retention: archive settled swaps, hard-delete long-dead ones (see Data Retention) |
| `/api/cron/expire-announcements` | Daily | Delete expired depot announcements |
| `/api/cron/daily-digest` | Daily morning | Send new-swaps digest to subscribers |
| `/api/cron/agreement-followups` | Daily | Proposal expiry, post-shift prompts, non-response finalize |

To manually trigger a cron during an incident:
```bash
curl -X GET https://<your-domain>/api/cron/expire-swaps \
  -H "Authorization: Bearer <CRON_SECRET>"
```

---

## Cron Heartbeat

Each cron pings an external uptime monitor on **success only** — a cron that
fails (or never runs) goes silent, and the monitor alerts on the missed ping.
Silence is the alarm.

**Setup (optional but recommended):**
1. Create an account on an uptime monitor that supports "dead-man's-switch"
   pings (e.g. [healthchecks.io](https://healthchecks.io)).
2. Create **six** checks — one per cron. For each, set the check's expected
   **period = the cron's schedule** plus a grace window (~1–2× the period):

   | Slug | Schedule (UTC) | Suggested period / grace |
   |---|---|---|
   | `expire-swaps` | `0 5 * * *` (daily) | 1 day / 6h |
   | `expiring-soon` | `15 13 * * *` (daily) | 1 day / 6h |
   | `daily-digest` | `0 12 * * *` (daily) | 1 day / 6h |
   | `cleanup-swaps` | `0 8 * * *` (daily) | 1 day / 12h |
   | `expire-announcements` | `0 9 * * *` (daily) | 1 day / 6h |
   | `agreement-followups` | `0 13 * * *` (daily) | 1 day / 6h |

3. Take the monitor's **base ping URL** (the part before the per-check slug —
   e.g. `https://hc-ping.com/<project-uuid>`) and set it as `HEARTBEAT_URL_BASE`
   in Vercel (Production). Name each check's slug to match the table above so
   `${HEARTBEAT_URL_BASE}/<slug>` resolves to the right check.
4. Leave `HEARTBEAT_URL_BASE` unset in Preview/dev — heartbeats no-op when it's
   absent, so those environments stay quiet.

Implementation: `lib/heartbeat.ts` `pingHeartbeat(slug)` is the **last line of
each cron's success path**, fire-and-forget with a 3s timeout; it swallows all
errors and never throws, so it can't turn a healthy run into a failure. Failure
paths (auth 401, caught 500) never ping.

---

## Data Retention

Swaps are retired in two phases by the daily `cleanup-swaps` cron. The old
behavior hard-deleted swaps 7 days after they filled/expired, which cascaded
away their messages, **agreements (the printable dispatcher proof)**, and
reports. The two-phase policy keeps that evidence reachable.

**Phase A — soft archive (was: delete).** A swap that has been `filled` or
`expired` for 7+ days gets `archived_at` set. Archived swaps:
- **drop off** the board (`/api/swaps`), the saved list, and "My Swaps".
- **stay reachable** in the history view and — for the swap owner and anyone
  with an agreement or message on it — the detail and `/print` pages. Other
  depot members get a 404, matching the board.
- keep all related rows (messages, agreements, reviews, reports).

**Phase B — hard delete (true garbage only).** A swap is permanently deleted
(cascading to its related rows) only when **all** of these hold:
- `archived_at` is more than **90 days** ago, **and**
- its effective shift date is in the past — the latest of `date`/`fromDate`/
  `toDate`, or `createdAt + 180 days` for undated vacation swaps, **and**
- it has **no `pending` report** (open moderation cases are never deleted).

The cron returns `{ archived, deleted }` counts. Because Phase A is idempotent
(`archived_at: null` guard) and Phase B is guarded by the report check, it is
safe to re-run manually:
```bash
curl -X GET https://<your-domain>/api/cron/cleanup-swaps \
  -H "Authorization: Bearer <CRON_SECRET>"
```

`archived_at` is additive (nullable column + index, migration
`20260704_soft_archive_swaps`); no data is dropped by the migration itself.
