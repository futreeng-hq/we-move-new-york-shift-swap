# Launch Evidence Record — 2026-09-25

**Supersedes the status section of `HARON_LAUNCH_READINESS.md` (2026-09-18).**
That document's blocker list is still the right list. This one records what has
since been verified, what was found that it missed, and what is still open.

**Decision: still NO-GO, but for a shorter and more specific list than before.**

---

## 0. Read this first: production is running a July build

The live production deployment is `e65d7cc` (PR #45), deployed **2026-07-25**.
`main` is four commits ahead, and one of them is `3dcceb0 "fix: harden launch
security and validation"` — the 2026-09-18 commit that implemented the B1 and B2
fixes.

**Production has never run the B1/B2 security fixes.** Everything
`HARON_LAUNCH_READINESS.md` describes as "implemented, pending verification" is
sitting on `main`, undeployed. The old logout-all behaviour is what is live right
now.

Not in production today:

| Commit | |
|---|---|
| `3ffede5` | docs: add launch readiness handoff |
| `3dcceb0` | **fix: harden launch security and validation** |
| `f4dd431` | test: clean blocked conversation fixtures |
| `4cca973` | ci: clean up redis test server |

This reframes the whole gate: the question is not only "are the fixes correct"
but "when do they ship." Crons *are* running against production (see §4), so the
deployed build is live and in use.

---

## 1. The four blockers

### B1 — global logout and token revocation → **was still broken; now fixed**

The B1 fix was incomplete, and the readiness doc's own acceptance criteria
("a test proves logout-all rejects an old bearer access token") were not met —
no test in `test/` exercises `middleware.ts` at all.

**The hole:** `middleware.ts` resolved the access token with `??`:

    const token = req.cookies.get("accessToken")?.value ?? (bearer…)

`lib/auth.ts` `getTokenFromRequest` uses truthiness (`if (cookie) return cookie`).
`??` does **not** fall through on an empty string. So a request carrying
`Cookie: accessToken=` (empty) plus `Authorization: Bearer <stolen token>`
resolved to `""` in middleware, skipped the force-logout check entirely, and
then authenticated normally in the route handler.

Concretely: attacker holds a stolen 15-minute access token. The victim hits
logout-all, or resets their password, or an admin suspends or demotes them. The
attacker adds one empty cookie header and keeps full access for the token's
remaining life. Every revocation path was defeated the same way. Fixed in patch
0001; middleware now mirrors `getTokenFromRequest` exactly.

**Second hole:** `blockUserAccessTokens()` returns a boolean saying whether the
revocation marker was actually written. Four callers awaited it and threw the
result away — `reset-password`, `auth/password`, `admin/users` PATCH, and
`admin/users/bulk`. Only `logout-all` checked it. So if Upstash rejected that one
write, reset-password still answered `200 "Password updated successfully"` while
nothing was revoked. The code comment claiming "the next refresh attempt by an
attacker will fail because we just bumped the password" is simply false —
refresh tokens are not bound to the password hash, so that marker is the only
thing stopping a stolen refresh token for its full **7-day** life. Both password
paths now return 503 instead of claiming success; both admin paths report to
Sentry and surface `sessionsRevoked`.

**Third hole:** account deletion — self-service *and* admin — never revoked
sessions at all.

**Verified correct, and worth recording so it is not re-litigated:** logout-all
genuinely does revoke refresh tokens for the full 7-day window; the marker check
in `refresh/route.ts` runs before both the blocklist and the rotation-grace path,
so a rotating token chain cannot outlive it; the three JWT secrets are distinct
and length-enforced, so cross-class token replay fails; `alg:none` confusion is
not reachable with a string secret; cookie flags are correct and consistent
across both issuers. `PRELAUNCH_AUDIT.md:115` and
`AUDIT_ACTION_PLAN.md:104-108` describe the old `updatedAt`-only design and are
**out of date** — do not reopen them.

**Still open on B1:** revocation is enforced *only* in middleware.
`requireUser()` does nothing but `jwt.verify`, so there is no second layer, and
`app/s/[id]/page.tsx` is an authenticated path outside `/api/` that middleware's
check does not cover. Moving the force-logout check into `requireUser()`, or
adding a `tokenVersion` claim checked against the user row routes already fetch,
is the durable fix. Recommended before launch; not included here because it
touches every route's hot path and wants a test run behind it.

### B2 — blocking behaviour → **policy holds, but the coverage claim did not**

`HARON_LAUNCH_READINESS.md:84` claims tests cover "thread GET, thread DELETE,
mark-read, direct messages, swap messages, interests, agreements, and swap
visibility." `test/auditSmalls.test.ts:225-265` covers thread GET, thread-read,
message-read and message DELETE. **Thread DELETE, interests, agreements, direct
messages and swap visibility have no block regression test.** Treat that
checklist line as unmet.

And `messages/thread` DELETE genuinely had no block check — the one message path
that didn't — and its `{ deleted: n }` count disclosed whether a conversation
with that user existed. Fixed in patch 0002.

### B3 — DB/Redis-backed test pass → **cannot be closed from here**

`binaries.prisma.sh` is blocked by egress policy in the environment this session
runs in, so `prisma generate` fails, and therefore `next build`, `prisma db
push` and the DB-backed suite could not run. This is an environment limit, not a
repo problem.

What *was* run here:

| Check | Result |
|---|---|
| Pure test subset (`npm run test:concurrent`) | **43 passed, 0 failed, 24 skipped** |
| `test/nyDate.test.ts` after new DST coverage | **14 passed**, under `TZ=UTC` and `TZ=Asia/Tokyo` |
| `tsc --noEmit` | 111 errors, **identical to the pre-change baseline** |
| `eslint .` | 30 problems (19 errors), **identical to baseline** |

The 24 skips are the DB/Redis-gated tests — exactly the ones the readiness doc
refuses to accept as passing. **The good news: CI already solves this properly.**
`.github/workflows/ci.yml` has a Postgres service container, a Redis REST
adapter, and canary assertions that fail the job if the DB-backed and
Redis-backed tests silently skip. B3's acceptance criteria are satisfied by a
green CI run on this branch — that is where the evidence should come from, not
from a laptop.

Note that 19 of those eslint problems are **errors**, so `npm run lint` fails
today. CI runs build and test but not lint, which is why nobody noticed.

### B4 — dependency audit → **closed, with reasoning**

`npm audit --omit=dev` reports 21 findings (8 high). Every one traces to build or
CLI tooling, not the request path:

| Package | Path | Reachable in production runtime? |
|---|---|---|
| `hono` (24 advisories) | `prisma` → `@prisma/dev` | No — Prisma CLI dev server |
| `mysql2` | `prisma` | No — CLI, and this app is Postgres |
| `valibot` | `prisma` → `@prisma/dev` | No — CLI |
| `uuid` | `@sentry/nextjs` → `@sentry/webpack-plugin` | No — build-time plugin |
| `brace-expansion` | `@sentry/nextjs` → bundler-plugin-core / `@fastify/otel` | No — build, and minimatch ReDoS is not on any input path |

**No finding is reachable from a production request.** The cleanest structural
fix is to move `prisma` from `dependencies` to `devDependencies`: it is only
needed for `postinstall` generate and `vercel-build`'s `migrate deploy`, both of
which run with devDependencies installed. That single change removes hono,
mysql2 and valibot from `--omit=dev` entirely. Not done here because it changes
install behaviour and wants one verified Vercel build behind it.

Do **not** run `npm audit fix --force` — it downgrades to `prisma@6.19.3`.

---

## 2. What the previous audits missed

These were found in this pass and are not in `HARON_LAUNCH_READINESS.md`.

### Deploy blocker: no new environment could be built from this repo

`prisma/migrations/20260704_drop_unused_audit_action/migration.sql` ran a bare
`DROP TYPE "AuditAction"` on a type **no migration in this repo ever creates** —
it exists in production only as pre-migration drift. Applying all 16 migrations
in order against an empty Postgres 16: 15 succeed, that one errors.

`vercel-build` is `prisma migrate deploy && next build`, so on a fresh Neon
branch the deploy failed there, Prisma recorded the migration as failed, and
**P3009 then blocked every later migration** — including `20260704_trust_v2`,
which is what adds `accepted_at`, `user_a_happened`, `shift_date`, the
`'accepted'` enum value, and **both partial unique indexes** the agreement
conflict handling depends on. A fresh staging branch did not merely return 201
instead of 409; its agreement flow did not work at all. Disaster recovery had no
working path either.

One-word fix (`DROP TYPE IF EXISTS`) in patch 0001.

**And the documented cause was wrong.** `docs/migration-baseline-squash.md` and
the CI comment both say `migrate deploy` fails because the hand-named 8-digit
directories sort ahead of the 14-digit baseline. Prisma sorts
lexicographically, and `'2'` (0x32) precedes `'_'` (0x5F), so
`20260401214939_init` sorts **first** — the first 15 migrations apply cleanly.
The 6-step squash runbook was chasing a bug that isn't there, and its acceptance
checklist would have passed while the real one went unexamined. Corrected in
patch 0004; **re-rehearse `migrate deploy` against an empty database before
deciding whether that squash is still needed at all.**

### Critical privacy: reset and verification tokens were going to Google

`/reset-password/<jwt>` and `/verify-email/<token>` carry a live
account-takeover credential in the URL path. `app/layout.tsx` ran
`gtag('config', …)` with automatic `page_view`, whose `page_location` is the full
URL. So every password-reset click wrote a **live 1-hour reset JWT** into Google
Analytics — and into Vercel Analytics, and into Sentry (`tracesSampleRate` 0.2,
`replaysSessionSampleRate` 0.05, and `beforeSend` never touched
`event.request.url`).

Anyone with GA "Viewer" on this property can open Realtime, copy the path, and
reset that operator's password inside the hour. Fixed in patch 0003.

Sentry scrubbing was also shallow: the old helper walked only the **top level**
of `request.data` / `extra` / `contexts`, so `{ user: { email } }` passed
straight through, and `request.url`, `query_string`, `headers`, `cookies`,
`tags`, `event.message` and exception values were never scrubbed at all. That
last one matters: a Prisma validation error embeds the failing `data` object —
including `passwordHash` — in its message, where no key-based scrubber can see
it. `app/api/auth/register/route.ts:112` calls `captureException` on exactly that
transaction.

### Depot scoping was enforced on one route and missing on its five siblings

`GET /api/swaps/[id]` checks the caller's depot. Every sibling route taking the
same `[id]` did not, so the id alone was enough to act on a swap in a depot the
caller cannot see. The direct-message route enforces the depot explicitly *"to
prevent cross-depot harassment"* — these were the ways around that control.

The worst was save-then-list: `POST /api/swaps/<foreign-id>/save` followed by
`GET /api/swaps/saved` returned the whole swap row, **including the poster's
phone number**, to someone `GET /api/swaps/[id]` would have refused. Also
affected: agreement POST (a foreign-depot user could create a real agreement and
expose their own full name to the owner), interest, messages POST, and report.
All fixed in patch 0002 behind one shared `lib/accessScope.ts`.

`/api/depots/[code]/flexible` was worse still: any authenticated user, any depot
code, **full first and last names** of every operator advertising that they want
to trade shifts, with no block filter — while the board deliberately masks to
"First L." to limit exactly that. One account could walk every depot code and
harvest a city-wide roster. Depot announcements were cross-depot readable too,
and `announcements/[aid]` destructured `code` and never used it, so a depotRep
reassigned to another depot kept edit and delete rights over their old depot's
announcements.

### Suspension only held at login

`checkActive` was applied on agreement POST but not on agreement PATCH, swap
status, swap DELETE, or announcement create/edit/delete. Within their token's
remaining 15 minutes a suspended user could cancel an accepted agreement or file
a no-show against their counterparty. Fixed in patch 0002.

### The most destructive moderation action was unlogged and open to sub-admins

`admin/reports` action `remove` hard-deletes a swap and cascades to messages,
agreements, reviews and reports. It admitted `subAdmin` and wrote **no audit
entry** — while far less consequential role changes were logged. Now admin-only
and logged on both branches.

### Deletion did not delete

`Swap.posterName` (full name) and `Swap.contact` (phone/email) are denormalized
copies of the user's identity. Both deletion paths anonymized only the `User`
row, so the name and phone number stayed on the board and on the public
`/s/<id>` teaser — and the self-delete audit entry wrote the deleted email
address into the log at deletion time. Privacy §6 promises removal within 30
days. Fixed in patch 0001.

### Crons failed silently

Every handler caught its error and returned `err(…, 500)`, so nothing ever
threw, `onRequestError` never fired, and no Sentry event was created. The only
failure signal was heartbeat silence — and `HEARTBEAT_URL_BASE` is **commented
out** in `.env.example`. A cron failing every day was invisible.

Worse, `expiring-soon` never awaited `notifyUser`/`notifyMany`. The serverless
instance freezes at the response, so those promises were dropped while the cron
returned 200 and pinged its heartbeat. **No "your swap expires tomorrow"
notification has ever been delivered.** All fixed in patch 0004.

### Non-affiliation notice did not say what it was required to say

The required sentence — *"We Move NY is not affiliated with, endorsed by, or
operated by TWU Local 100 or the MTA."* — appeared **nowhere** verbatim. The
login card had a variant at 11px / 35% opacity on `#010028`, below WCAG
contrast. The consent modal omitted TWU Local 100 entirely. Both fixed in
patch 0003.

**Still open (product decision, not a code fix):** the consent modal and Terms
gate fire on first *sign-in*, not before `POST /auth/register` —
`doRegister` goes straight to "Check your email." So the substantive disclosure
happens *after* the account exists. Moving the gate ahead of registration is a
flow change and needs your call.

---

## 3. The patches

Four commits, one per phase, on branch
`fix/launch-blockers-session-revocation`. 44 files, +785/−180.

| # | Scope |
|---|---|
| 0001 | Session revocation, deletion, and the migration deploy blocker |
| 0002 | Depot + block scoping, `checkActive`, admin/reports |
| 0003 | Token redaction in analytics/Sentry, disclosure copy |
| 0004 | Cron visibility, EST/DST tests, env gating, health, docs |

**These were not built or run against a database.** `tsc --noEmit` and `eslint`
are byte-identical to the pre-change baseline and the pure test subset passes,
but a real `next build` and a CI run with the Postgres service are the gate.

### Merge conflict you need to resolve deliberately

Branch `feat/analytics-opt-out` is unmerged and overlaps patch 0003 in
`app/layout.tsx`, `lib/analytics.ts`, `app/privacy/page.tsx`, and a Vercel
Analytics wrapper component. The two changes are **complementary, not
duplicates**:

- That branch adds a per-device opt-out and gates Vercel Analytics and Speed
  Insights through it. Patch 0003 does not do that.
- Patch 0003 redacts the reset/verify credential from the URL. That branch does
  **not** — it keeps `gtag('config', 'G-RJV2G8G06H')` with automatic page_view
  and still sends the raw pathname, so the token still reaches GA for every user
  who hasn't opted out.

Take that branch's `OptOutAwareAnalytics` component and combine both hooks:

    beforeSend={(event) => isAnalyticsOptedOut() ? null : { ...event, url: redactSensitiveUrl(event.url) }}

and keep patch 0003's `send_page_view: false` plus the redacted `page_path`.
Landing either branch alone leaves one of the two holes open.

---

## 4. Live infrastructure — what I could and could not check

Verified through the Vercel connector:

- **Project** `we-move-ny-shift-swap` (`prj_QJTk9YzHVCvRg4w3H2RyShflsXfZ`), team
  `team_5QoTMZC4sGJuB9Ll4fiWDCZl`.
- **Domains** all verified: `wmnyshiftswap.com` → redirects to
  `www.wmnyshiftswap.com`; `www.wmnyshiftswap.com`; `we-move-ny-shift-swap.vercel.app`.
  **Check that `NEXT_PUBLIC_APP_URL` is the canonical `www` host** — if it is the
  apex, every verification and reset link in every email takes a 308 redirect
  before landing.
- **Crons are alive.** Runtime logs show `expire-announcements`, `cleanup-swaps`
  and `/api/health` executing as recently as 2026-09-25 13:21 UTC. All six are
  registered in `vercel.json`. Note six crons exceeds the Hobby plan's cap of
  two — confirm the plan.
- **Runtime errors, last 7 days: one group, and it is not a failure.** 98
  occurrences of a `pg` deprecation warning: SSL modes `prefer`/`require`/
  `verify-ca` are currently aliased to `verify-full` and will adopt weaker libpq
  semantics in `pg` v9. Set `sslmode=verify-full` explicitly in `DATABASE_URL`
  now so the eventual upgrade doesn't silently weaken TLS.
- **Last production deployment: 2026-07-25.** See §0.

Could **not** check — the connector's token lacks `projectEnvVars` read
permission, returning 403. So the readiness doc's entire "Required production
environment variables" section is still unverified: presence, scope, format and
rotation ownership for all ~18 vars. That needs the Vercel dashboard.

---

## 5. Still open, ranked

**Blocking:**

1. **Deploy `main`.** The security fixes have been undeployed for a week; the
   live build is two months old.
2. **Green CI run** on the fix branch — that is the B3 evidence.
3. **One real `next build`** — nothing here has been compiled.
4. **Rehearse `migrate deploy` against an empty database**, then confirm both
   partial unique indexes exist in the resulting schema.
5. **Verify the ~18 production env vars** in the dashboard.
6. **Decide the registration consent gate** (disclosure currently lands after
   account creation).
7. **Rotate the GA property, or accept the exposure.** Any reset token clicked
   before patch 0003 ships is in GA, Vercel Analytics and Sentry history.
   Reset JWTs expire in an hour so the live risk window has passed, but the
   retained data is a disclosure question, not a technical one.

**Should fix before launch, not included in these patches:**

8. Revocation enforced only in middleware — add a second layer in
   `requireUser()` or a `tokenVersion` claim.
9. Move `prisma` to `devDependencies` (closes B4 structurally).
10. Login is an enumeration oracle by both message and timing: unknown email
    returns 401 with **no bcrypt run**, wrong password returns 401 after a
    ~100 ms compare. `forgot-password` is carefully padded to 400 ms; login is
    not. Compare against a fixed dummy hash and return one 401 for all
    credential failures.
11. Indefinite lockout DoS: `loginAttempts` resets only on *successful* login,
    so once it hits 10, one wrong password every 15 minutes — far under the
    10/min IP limit — locks a known email out forever. Reset the counter when
    `lockedUntil` has passed.
12. `clientIp` trusts the **leftmost** `X-Forwarded-For` hop at the default
    `TRUSTED_PROXY_HOPS=0`, and `isValidIp` accepts `"1:2"` or `"::::"` as
    IPv6. If anything is ever put in front of Vercel without setting that var,
    an attacker gets unlimited fresh rate-limit buckets. Vercel always sets
    `x-vercel-forwarded-for` to the true client IP and this code ignores it.
13. Email change keeps `verified: true` and never validates the address format —
    a user can move their account to an address they don't control, or set it to
    `x@deleted.invalid`, which `checkActive` reads as deleted: permanent
    self-lockout with no admin-visible cause.
14. `disputed` is a terminal state. The schema says "admin resolves"; no admin
    route touches it. Disputes will accumulate with no resolution path.
15. Depot is self-asserted — any user can set their own `depotId`, and the 7-day
    cooldown is skipped when the current value is null, so `null` then `X`
    defeats it entirely. The scoping fixes in patch 0002 are real, but the
    boundary underneath them is soft until depot is tied to invite or
    verification.
16. Push notification bodies include 100 characters of message text plus the
    sender's full name, readable on a locked shared phone.
17. `lib/rateLimit.ts:60` — a missing Upstash config disables **all** rate
    limiting, including in production. The file header and inline comments also
    describe fail-*open* while the code fails *closed* (line 80); the next
    maintainer will read the wrong behaviour.
18. `expiring-soon` and `daily-digest` are not idempotent, and Vercel cron
    delivery is at-least-once — a retry double-notifies everyone. A per-day
    Redis run-marker fixes it.
19. `npm run lint` fails (19 errors). Add lint to CI once clean.
20. `public/sw.js` cache name is now bumped manually. Wire it to
    `VERCEL_GIT_COMMIT_SHA` with a generated service worker.

**Still needs your hands, no code involved:** email deliverability (SPF/DKIM/
DMARC, bounce handling) tested in staging; a real staging Neon branch isolated
from production; backups and a rehearsed point-in-time restore; mobile PWA and
iOS 16.4+ push from an installed app; keyboard-only and screen-reader passes;
a monitored mailbox and named on-call owner for abuse reports; `HEARTBEAT_URL_BASE`
configured with dead-man periods matching the real schedules.
