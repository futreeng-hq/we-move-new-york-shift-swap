# Launch Evidence Record — 2026-09-25

**Supersedes the status section of `HARON_LAUNCH_READINESS.md` (2026-09-18).**
That document's blocker list is still the right list. This one records what has
since been verified, what was found that it missed, and what is still open.

**Decision: every code-side item is closed, and the work is now BUILT and
TESTED. What remains is deployment and the checks that can only be done in the
live accounts — listed in §5.**

Updated 2026-09-25 (third pass). The first two passes could not compile or run
anything, because `prisma generate` was failing against a blocked host; that is
resolved, so the numbers below are executed results rather than static review.

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

**Fourth hole — now closed.** Revocation was enforced *only* in middleware;
`requireUser()` did nothing but `jwt.verify`. That is one layer, and the wrong
one: middleware had the extraction bug above for months, it does not run for
authenticated work outside its matcher, and a Next.js middleware-bypass CVE
would hand over every route at once.

The check now lives in `requireUser()`, the layer that sits against the data.
All 73 call sites await it, and `authError()` maps the failure to 401 (revoked)
or 503 (cannot prove it — Redis absent or unreachable) instead of every route
flattening both to "Unauthorized". Middleware keeps the check for page routes
only, which have no `requireUser`, so a request still pays exactly one Redis
round-trip rather than two. Middleware also now rejects any inbound request
carrying `x-middleware-subrequest`, the header that class of bypass relies on —
a real client never sends it, so refusing it does not depend on staying
patched.

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

### B3 — DB/Redis-backed test pass → **CLOSED, with an executed run**

| Check | Result |
|---|---|
| `npm test` (real Postgres 16 + Redis REST adapter) | **86 passed, 0 failed, 1 skipped** |
| `npm run build` | **succeeded** — every route compiled |
| `tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors**, 10 warnings |
| All 16 migrations against an **empty** database | **RETRACTED — see below.** They never replayed; superseded by one squashed baseline (§5.3) |
| Both partial unique indexes after that migrate | **present** (now via the squashed baseline; `partial-indexes.sql` deleted) |
| CI's three canary assertions | **all fire** |

The single remaining skip is `A12 (Redis-less fallback)`, which is gated to run
only when Redis is **absent**. Skipping it with Redis configured is the correct
outcome, not a gap. The earlier run reported 24 skips; those were the DB- and
Redis-gated tests, and every one of them now executes.

Two notes on how this was reached, because they matter for reading the rest of
this document:

- `prisma generate` had been failing because the CLI resolves a schema-engine
  binary at startup from a host this sandbox's egress policy blocks. The binary
  is not actually needed for `generate`, so pinning `PRISMA_SCHEMA_ENGINE_BINARY`
  past the lookup produced a working client. That is why the first two passes
  reported "111 type errors, identical to baseline" — all 111 were the
  missing-client artifact. With the real client, the count is **zero**.
- The build reaches completion but cannot fetch Poppins from
  `fonts.googleapis.com`, which is also blocked here. To prove everything else
  compiles, that one import was stubbed locally, the build run, and the stub
  reverted immediately — `app/layout.tsx` is byte-identical to before. CI has
  open network and will fetch the font normally.

The full-suite run was also repeated twice back-to-back against a single Redis
instance to confirm it is re-run safe; see the test-isolation fix in §6.

### B4 — dependency audit → **closed, and now closed structurally**

`npm audit --omit=dev` reports 21 findings (8 high). Every one traces to build or
CLI tooling, not the request path:

| Package | Path | Reachable in production runtime? |
|---|---|---|
| `hono` (24 advisories) | `prisma` → `@prisma/dev` | No — Prisma CLI dev server |
| `mysql2` | `prisma` | No — CLI, and this app is Postgres |
| `valibot` | `prisma` → `@prisma/dev` | No — CLI |
| `uuid` | `@sentry/nextjs` → `@sentry/webpack-plugin` | No — build-time plugin |
| `brace-expansion` | `@sentry/nextjs` → bundler-plugin-core / `@fastify/otel` | No — build, and minimatch ReDoS is not on any input path |

**No finding is reachable from a production request.** `prisma` has now been
moved from `dependencies` to `devDependencies` — it is only needed by
`postinstall` generate and `vercel-build`'s `migrate deploy`, both of which run
with devDependencies installed — which removes hono, mysql2 and valibot from the
`--omit=dev` surface entirely. Confirm this on the first Vercel build: if
anything at runtime turns out to import the `prisma` CLI package (nothing should;
`@prisma/client` is a separate, still-production dependency), that build will
say so.

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

**RETRACTED (2026-09-26).** This section previously claimed the documented cause
was wrong — that Prisma sorts lexicographically, `'2'` (0x32) precedes `'_'`
(0x5F), so `20260401214939_init` sorts first and the squash runbook was chasing
a bug that isn't there. That claim was false and had not been tested against an
empty database. The original documentation in `docs/migration-baseline-squash.md`
and the CI comment was **correct**.

Prisma orders migrations by the numeric timestamp prefix. The fifteen hand-named
8-digit directories sort ahead of the 14-digit baseline, so `init` runs last and
the first migration applied fails with `42P01 relation "users" does not exist`.

Evidence: CI failed on exactly this in the first `pull_request` run of PR #46
(`20260401_add_agreements_push_roles`, `42P01`). Reproduced directly against an
empty Postgres 16 on 2026-09-26 — replaying in numeric-prefix order fails on
that migration; replaying with `init` first, all 16 apply cleanly. So the SQL is
sound and the directory **names** are the defect.

The `DROP TYPE IF EXISTS` fix in patch 0001 is still correct and still needed,
but it was not the blocker; it was one bug behind the ordering one.

**Standing consequence:** this schema was built by `db push`, and the migration
history has never been the thing that built it. The database cannot currently be
rebuilt from source — no fresh environment, staging copy or restore path. The
fix is renaming those fifteen directories to real 14-digit timestamps, which
changes the names in `_prisma_migrations` and would make production re-apply
them over an existing schema (verified to fail with `type "UserRole" already
exists`). Because `vercel-build` runs `prisma migrate deploy && next build`,
that would break production deploys. The rename requires a deliberate
`migrate resolve --applied` reconciliation against production first. **Tracked
as its own task. CI stays on `db push` until it is done.**

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

**Also closed:** the consent modal and Terms gate fire on first *sign-in*, not
before `POST /auth/register`, so the substantive disclosure landed *after* the
account existed. Rather than restructure that flow (the Terms screen writes to
the user record, so it needs a logged-in user), registration now gates on its
own acknowledgement checkbox carrying the canonical sentence verbatim. The
post-sign-in flow is untouched.

---

## 3. The patches

Ten commits on branch `fix/launch-blockers-session-revocation`, one per phase.

| # | Scope |
|---|---|
| 0001 | Session revocation, deletion, and the migration deploy blocker |
| 0002 | Depot + block scoping, `checkActive`, admin/reports |
| 0003 | Token redaction in analytics/Sentry, disclosure copy |
| 0004 | Cron visibility, EST/DST tests, env gating, health, docs |
| 0005 | This record |
| 0006 | Revocation moved into `requireUser()`; login/register/rate-limit/profile hardening |
| 0007 | Disputes queue, cron idempotency, dependency + lint hygiene, registration gate |
| 0008 | Tests for the redaction, scrubbing and IP-validation fixes |
| 0010 | CI partial-index assertion, test isolation (the `migrate deploy` switch in this patch was reverted — see the retraction above — then re-landed in #49 once the squashed baseline made it correct) |

### What has actually been verified here

| Check | Result |
|---|---|
| `npm test` (Postgres 16 + Redis REST adapter) | **86 passed, 0 failed, 1 correctly-skipped** |
| `npm run build` | **succeeded**, all routes compiled |
| `tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors**, 10 warnings, now gating CI |
| 16 migrations from empty | **RESOLVED by replacement** — the 16 never replayed; squashed to one baseline in #48, which does replay from empty (that is how it was generated and verified) |
| `migrate diff` schema vs. production | **empty** after #50 — the drift detector is now trustworthy |
| Both partial indexes present in CI | **verified** (now via `migrate deploy` of the baseline) |

Two things were caught by actually running the code rather than reading it, which
is the argument for not trusting a static pass:

1. Writing `test/sensitiveUrl.test.ts` found a live bug in patch 0003.
   `scrubEvent` fed `event.message` to `redactSensitiveUrl()`, which parses its
   input *as* a URL — so `"failed at https://host/reset-password/<jwt>"` fell
   through untouched and the token would still have reached Sentry by that route.
   Fixed with `redactSensitiveText()` in patch 0008.
2. Running the suite twice exposed a test-isolation trap: `test/growth.test.ts`
   used a hardcoded `x-forwarded-for`, and register is rate-limited 5/hour per IP
   with Redis state outliving a single `npm test`. It passed on a fresh Redis and
   then failed with an opaque 429 — which a CI job retry would have hit. Fixed in
   patch 0010.

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

## 5. Still open

Everything in this section needs the live accounts, a real build, or your
signature. There are no remaining code-side items.

**Blocking, in order:**

1. **Deploy `main`.** The security fixes have been undeployed since 2026-09-18;
   the live build is from 2026-07-25. This is the single largest gap.
2. **Green CI run** on the fix branch — the formal gate. Expected green: the
   same suite, build, migrations and index assertion all pass locally against a
   real Postgres and the Redis adapter. ~~the first real build~~ (done, §B3).
3. ~~Rehearse `migrate deploy` against an empty database.~~ **Done, 2026-09-27,
   by squashing the history — not by the route this line originally claimed.**

   This item previously read "all 16 migrations apply cleanly from empty" and
   told you **not** to run the `docs/migration-baseline-squash.md` runbook. Both
   halves were wrong and CI proved it: `migrate deploy` against an empty
   database died on `20260401_add_agreements_push_roles` with `42P01 relation
   "users" does not exist`. Prisma orders migrations by the **numeric timestamp
   prefix**, so the fifteen hand-named 8-digit directories all sorted ahead of
   the 14-digit `20260401214939_init` and `init` ran last. The 16 migrations
   never replayed from empty at any point.

   What actually closed it: the runbook was executed (#48). The 16 directories
   were replaced by one `20260720000000_baseline`, generated by replaying them
   into an empty Postgres and dumping the result, verified byte-identical on a
   round-trip. Both live environments were then marked with `migrate resolve
   --applied 20260720000000_baseline` before anything was pushed. CI moved from
   `db push` to `migrate deploy` in #49, which also retired
   `prisma/partial-indexes.sql` — the baseline creates both partial unique
   indexes directly, so CI now builds exactly what production runs.

   Two pieces of pre-existing drift were closed in #50 so that the drift
   detector itself became usable: `playing_with_neon` (a leftover Neon sample
   table) was dropped, and the `blocks` foreign keys now declare
   `onUpdate: NoAction` in `schema.prisma` to match what the databases have
   always had. `npx prisma migrate diff --from-schema prisma/schema.prisma
   --to-config-datasource --script` against production now returns
   `-- This is an empty migration.`

   **Known and deliberately left alone:** `_prisma_migrations` may still hold
   bookkeeping rows for the 16 retired directories alongside the baseline, because
   `migrate resolve --applied` inserts without deleting. This is inert.
   `migrate deploy` selects by migration name and ignores rows with no local
   directory, and `npx prisma migrate status` against production reports
   "Database schema is up to date!" with no mention of them — an earlier note in
   this record predicted it would keep flagging them; it does not. Deleting them
   is a write against production's migration bookkeeping for no operational
   gain, and if such a delete ever caught the `20260720000000_baseline` row the
   next deploy would try to re-apply the baseline and fail on `42710`. The one
   place the rows can still bite is `prisma migrate dev` on a developer machine,
   which does full drift detection and may demand a reset — a local-workflow
   problem, not a production one. Revisit after launch, on a Neon branch first,
   with an explicit `IN (...)` list of the 16 names rather than an exclusion.
4. **Verify the ~18 production env vars** in the Vercel dashboard. The connector
   token here lacks `projectEnvVars` read permission (403), so presence, scope,
   format and rotation ownership are all still unverified.
5. **Confirm `NEXT_PUBLIC_APP_URL` is the canonical `www` host.** The apex
   redirects to `www`, so if it is set to the apex, every verification and reset
   link takes a 308 first.
6. **Set `sslmode=verify-full` explicitly in `DATABASE_URL`.** `pg` currently
   aliases `require` to `verify-full` and will adopt weaker libpq semantics in
   v9 — 98 deprecation warnings in the last 7 days are telling you this now.
7. **Configure `HEARTBEAT_URL_BASE`** with dead-man periods matching the real
   schedules (all six crons are daily; the runbook's old "weekly" line for
   `cleanup-swaps` is corrected).
8. **Confirm the Vercel plan allows six crons** — Hobby caps at two.
9. **Rotate the GA property, or accept the exposure.** Any reset token clicked
   before patch 0003 ships is in GA, Vercel Analytics and Sentry history. Reset
   JWTs expire in an hour so the live risk window has passed; the retained data
   is a disclosure question, not a technical one.
10. **Sign off on the accepted risks below.**

**Accepted, deliberately, and worth knowing:**

- `Sentry.captureEvent` on failed logins and rate-limit hits still tags the
  client IP. That is an explicit choice for abuse investigation, and it sits
  slightly against `sendDefaultPii: false` — which stops *automatic* collection,
  not this deliberate tag. Say so in the Privacy Policy or drop the tag.
- Depot membership is still self-asserted: any user can set their own `depotId`.
  The round-trip-through-null loophole in the 7-day cooldown is closed, but the
  scoping fixes in patch 0002 rest on a boundary that is soft until depot is tied
  to the invite or to verification. Reasonable for launch; not indefinitely.
- 10 eslint warnings remain (unused vars, two `<img>` elements, two
  `window.location.href` navigations). Harmless, and the lint script caps at that
  count so no new ones creep in.
- `public/sw.js` cache name is bumped by hand. Wiring it to
  `VERCEL_GIT_COMMIT_SHA` needs a generated service worker — a follow-up, not a
  blocker.
- Chunking for `agreement-followups` and `expire-swaps`. `maxDuration = 300` buys
  headroom; at real volume they will want batching.

**Still needs your hands, no code involved:** email deliverability
(SPF/DKIM/DMARC, bounce handling) tested in staging; a real staging Neon branch
isolated from production; backups and a rehearsed point-in-time restore; mobile
PWA and iOS 16.4+ push from an installed app; keyboard-only and screen-reader
passes; a monitored mailbox and named on-call owner for abuse reports.

---

## 5b. Third pass — 2026-09-27, PWA and outage resilience

Four defects found while working the remaining punch list. All four are code-side
and closed; none were in any previous audit.

### The Redis outage also took down the PWA shell

This is the most serious of the four, and it is a second symptom of the same
2026-09-27 Upstash hibernation that produced the 429s on login.

`middleware.ts` runs the force-logout check for every non-`/api/` path, and in
production it returns `503 {"error":"Session validation temporarily
unavailable"}` when Redis cannot be reached. The matcher excluded only
`_next/static`, `_next/image` and `favicon.ico`. So for any signed-in user, a
sleeping Upstash instance returned that JSON 503 for:

- `/sw.js` — the service worker script
- `/manifest.json` — the install manifest
- `/icons/*` — every app icon
- every page navigation, as JSON rather than an HTML error page

The offline shell exists precisely to cover an outage like this, and the outage
took it out. A returning user could not load the app, could not install it, and
the service worker could not update.

Fixed in `lib/publicAssets.ts` + `middleware.ts`: those paths are removed from
the matcher (so middleware is never invoked for them) and an `isPublicAsset()`
guard short-circuits at the top of the handler as a second lock. None of them
carries user data, so no guarantee is weakened; it also removes a Redis
round-trip from every icon request. The guard sits above `MAINTENANCE_MODE`,
which previously allowed `/icons/` and `/manifest.json` but not `/sw.js` — so a
maintenance window redirected the worker request to `/maintenance` and the worker
cached the redirect. `test/publicAssets.test.ts` asserts the matcher and the
predicate agree, and that app routes are still covered.

### iOS push was dead on arrival, and it crashed the component

`NotifToggle` and `PushBanner` both guarded on `serviceWorker` and `PushManager`
and then read `Notification.permission`. On iOS Safari in an ordinary browser tab
that is a crash: `PushManager` IS on the window from 16.4, but `Notification` is
exposed only inside an installed home-screen app, so the read threw a TypeError
synchronously in a mount effect where the `.catch()` could not see it.

`components/InstallPrompt.tsx` already had the correct `"Notification" in window`
guard, which is how we know this was an oversight rather than a deliberate
difference between the three.

Two further defects in the same flow:

- No standalone-mode gate. In a tab, iOS rejects `pushManager.subscribe()`, and
  the handler's `catch {}` swallowed it — so the user tapped the toggle, nothing
  happened, and nothing said why.
- The VAPID key was fetched inside the click handler, before `subscribe()`.
  Safari ties the permission prompt to the user gesture, and an intervening
  `await fetch(...)` can lose it.

Fixed by extracting `lib/pushSupport.ts` (pure, the same split as
`lib/installPrompt.ts`) and `lib/usePush.ts` (one shared flow instead of two
near-identical copies). iOS-in-a-tab now reports `needs-install` and says so.
Failures surface instead of being swallowed. The key is prefetched at mount so
`subscribe()` is the first await after the click. Registration passes
`updateViaCache: "none"` per the Next.js PWA guide.

`test/pushSupport.test.ts` covers the support matrix and includes a source guard
asserting no component reads the Notification API directly. Verified against the
pre-fix sources: both matched, so the guard would have caught this.

### The service worker install could fail outright, and its cache never rotated

`cache.addAll(SHELL_URLS)` is all-or-nothing. `/depots` redirects for a
signed-out visitor, which is enough to reject the promise and fail the install —
leaving **no service worker at all**: no offline shell and no push. Now
`Promise.allSettled` over individual `cache.add()` calls, so a partial shell
beats no worker.

`CACHE_NAME` was a hand-bumped literal (`wmny-shell-v2`). `activate` only deletes
caches whose name differs, so a forgotten bump kept the previous deploy's cached
navigation HTML — pointing at `/_next/static/` hashes that no longer existed, a
blank page for returning and offline users — and the cache grew without bound.
`scripts/stamp-sw.mjs` now rewrites it to `wmny-shell-<sha7>` during
`vercel-build`. It rewrites the committed file in place rather than generating it
from a template: if the step is ever skipped, the worker still works with a
static name, whereas a template-only approach would ship no worker at all. It
no-ops without `VERCEL_GIT_COMMIT_SHA` so local builds leave the tree clean.

### 429 vs 503 — the login outage told users the wrong thing

Fail-closed rate limiting plus a sleeping Redis returned `429 Too many attempts`
on every login. Nobody was throttled. The status code told users to wait and
told whoever read the logs to look for abuse, so the actual cause stayed hidden
longer than it needed to. A 429 also invites client backoff-and-retry, which is
wrong for an outage that needs a human to wake the database.

`lib/rateLimit.ts` now returns a `RateLimitOutcome` discriminating `limited` /
`unavailable` / `unattributable`. The deny decision is unchanged — failing closed
is still the policy. `rateLimitResponse()` maps `unavailable` to 503 with
`Retry-After`, and the five auth routes (login, register, forgot-password,
reset-password, resend-verification) use it. Their "rate limit hit" Sentry events
are now gated on `reason === "limited"`, so an outage no longer floods Sentry
with events that read like credential stuffing. `unattributable` deliberately
stays a 429 — a distinct status there would tell an attacker which requests the
limiter could not attribute.

The boolean `rateLimit()` / `rateLimitByIp()` remain for the ~22 non-auth call
sites, where a mislabelled 429 on "save a swap" is not worth a wide refactor of
security-critical code that could not be integration-tested in this environment.

### Environment checks: three dashboard items became boot assertions

`lib/env.ts` gained a `warnings` channel, separate from `problems`. Warnings are
logged loudly at boot and do **not** throw, because each of these is live in
production right now and promoting any of them to a hard failure would turn the
next deploy into an outage over a config nit:

- `DATABASE_URL` without `sslmode=verify-full` (`pg` v9 stops verifying the
  server certificate for `require`)
- `NEXT_PUBLIC_APP_URL` set to the apex, which 308s to `www`, or carrying a
  trailing slash that produces double slashes in emailed links
- `HEARTBEAT_URL_BASE` unset, which is the whole cron failure-detection story
- `EMAIL_FROM` still on `@resend.dev`

Items 5, 6 and 7 of §5 above are still open in the sense that the values need
changing — but they now announce themselves on every boot instead of waiting for
someone to check a dashboard.

### What was NOT done, and why

- **No cron-run table.** Recording cron runs in Postgres would make a
  never-registered cron job observable from `/api/health`. It needs a new Prisma
  model, and this environment cannot reach `binaries.prisma.sh` to regenerate the
  client, so the code could not be typechecked. Adding a model that the code
  reaches by raw SQL purely to work around a sandbox limitation is not something
  that belongs in this repository. Whether the six crons are registered is a
  ten-second look at Vercel → Settings → Cron Jobs, and remains a §5 item.
- **No cron consolidation.** Collapsing six daily jobs into one dispatcher would
  fit a two-cron plan cap, but the six run at six different times (05:00, 08:00,
  09:00, 12:00, 13:00, 13:15) and changing when the daily digest sends is a
  product decision, not a technical one. It also solves a problem not yet
  confirmed to exist.
- **No cron batching.** `agreement-followups` and `expire-swaps` still rely on
  `maxDuration = 300`. A scale concern at zero users; it stays on the accepted
  list.

### Verification status of this pass

`tsc --noEmit` clean, `npm run lint` clean at 0 errors, and 126 tests passing
with 24 DB-gated tests skipped. `npm run build` and the DB-backed suite could
not be run in the authoring environment (its proxy blocks `fonts.googleapis.com`
and `binaries.prisma.sh`).

**CI ran both and passed** — PR #51, merged as `75bcff7`. The test job reported
126 tests / 125 passed / 0 failed / 1 skipped on the concurrent suite plus 8/8
on the isolated one; the single skip is the expected `A12 (Redis-less
fallback)`. The 24 DB-gated tests that skip locally all executed, including
`growth.test.ts`, which exercises the `rateLimitStatusByIp` conversion in
`register/route.ts`. `migrate deploy` built the database from the squashed
baseline in 1s and the partial-index assertion passed. The build job compiled
with the new middleware matcher.

Verified live on production afterwards: `/sw.js` serves `CACHE_NAME =
"wmny-shell-75bcff7"`, confirming both that the stamp runs on Vercel and that
the service worker is reachable rather than sitting behind the session check.

---

## 5c. Incident — 2026-09-27, Upstash credential change

Logged because the post-mortem produced two code changes and one process change.

### What happened

The Upstash free tier was upgraded to Pay as You Go, closing the hibernation
risk that caused the original login outage. While making that change the
`UPSTASH_REDIS_REST_TOKEN` was replaced with the database's **redis-cli
password** rather than its **REST/HTTP auth token**. These are two different
secrets on two different tabs of the Upstash console, and they are not
interchangeable: the password works only with traditional Redis clients, while
anything speaking HTTP needs the REST token.

Every request then failed authentication. Because the limiter fails closed, that
meant 503 on login. Production was rolled back twice, for roughly 80 seconds
each time, before the cause was found.

### Why it took an hour

`redisHealth()` caught the exception bare and returned
`{"state":"unreachable"}`. Upstash had been returning
`WRONGPASS invalid or missing auth token` from the first attempt; the message
was discarded at the catch. Four successive explanations were proposed and
tested against production — wrong database, mismatched URL/token pair,
read-only token, stale environment snapshot — when reading the actual error
would have ended it immediately.

The error was eventually recovered by POSTing an empty body to
`/api/auth/forgot-password` on a preview deployment, which runs the limiter
before it parses, and reading `[rateLimit] Redis error` out of the runtime log.

### Changes made

- **`redisHealth()` now logs the provider message** (`lib/rateLimit.ts`). Server
  log only — `/api/health` is public and unauthenticated, so its body still
  carries nothing but state and latency. `test/rateLimitOutcome.test.ts` asserts
  both halves: that the message is logged, and that the returned object has no
  field beyond `state` and `latencyMs`.
- **The two silent branches in the force-logout check now log** (`middleware.ts`).
  Both returned 503 with nothing written anywhere.

### Process change: test the deployment, then promote

The first two attempts promoted straight to production and were caught by users'
requests. Every attempt after that used the deployment's own URL:

1. Build with `create_deployment` (target production). A rollback pin means the
   build does not take the production alias on its own.
2. Check `https://<deployment-url>/api/health` — the SSO wall passes for a
   signed-in Vercel session.
3. Exercise a write path, not just `PING`. `POST /api/auth/forgot-password` with
   `{}` returns `400 Email required` when the limiter's `INCR` succeeded, and
   `503` when it did not. `PING` alone would pass with a read-only token.
4. Promote only after both are green.

The successful fix went out this way with zero downtime.

### Not done: the `middleware` → `proxy` migration

Next 16 deprecates the `middleware` file convention in favour of `proxy`, and
the build log says so on every deploy. It is **deliberately not migrated**.

The rename itself is mechanical — file name, function name, and a codemod
exists. But `proxy` **forces the Node.js runtime**: the docs state the `runtime`
config option is unavailable in Proxy files and throws if set. Migrating would
therefore move the force-logout check off the edge and into a regional Node
function, which is a real behavioural change to an auth-critical path, adopted
for no functional gain beyond silencing a build warning.

`middleware.ts` still works in 16.3.5 — this is a deprecation, not a removal.
The one thing that would have been lost, the `x-middleware-subrequest` guard
against the CVE-2025-29927 bypass class, turns out not to be a consideration:
the string appears nowhere in `next/dist` at 16.3.5, so that mechanism is gone
from the framework entirely and the check is inert either way.

Revisit after launch, with real traffic to measure the latency change against,
and verify on a preview deployment before promoting.

---

## 5d. Pre-launch audit and the backup blocker — 2026-09-27

A full go/no-go audit was run against live production. Most of it passed on
evidence rather than inspection; this section records the two findings that
mattered and the one that was a genuine blocker.

### Verified live against production

Security headers are present and tight on every response: CSP with
`default-src 'self'`, `frame-ancestors 'none'` and `form-action 'self'`; HSTS
with `includeSubDomains; preload`; `X-Frame-Options: DENY`; `nosniff`;
`Referrer-Policy: strict-origin-when-cross-origin`; and a Permissions-Policy
denying camera, microphone and geolocation.

Every protected endpoint probed unauthenticated returned `401`:
`/api/admin/reports`, `/api/admin/users`, `/api/users/me`, `/api/swaps`,
`/api/users/me/export`, `/api/cron/expire-swaps`. `/admin` serves only an app
shell; the data sits behind the API.

Zero `console.log` in shipped code, no placeholder copy, no hardcoded test
credentials, custom `not-found.tsx` serving a real 404. Sentry configured for
client, edge and server. All legal and help pages return 200.

**A correction worth recording:** HSTS was first reported as missing. It is
present — the browser tool used for the audit redacts that header on
`.get()` and returned null. Re-read via `headers.entries()` it is there. A
false finding on a launch checklist wastes as much time as a missed one.

### ❌ BLOCKER — backups were unverified, then unavailable, now verified

At audit time the project was on Neon's **Free** plan with a **6-hour** history
window. Neon's pricing page additionally lists instant restore as *not
available* on Free, which sits awkwardly against their point-in-time-restore
doc; from outside the account it was not possible to tell which behaviour
applied. Either way the honest answer to "can we undo a bad delete?" was
"we don't know, and possibly no" — with real user data about to arrive.

Resolved:

1. Upgraded to the **Launch** plan (usage-based, no monthly minimum).
2. Raised the history window to **7 days**. This does not happen automatically
   on upgrade — the slider stays where it was, and a first check of the project
   panel still read 6 hours. It needed setting explicitly and re-verifying.
3. **Rehearsed an actual restore**, which is the part that makes this evidence
   rather than a setting:
   - Created branch `restore-test` from **production** at a point in time
     roughly an hour earlier. Non-destructive: `Create branch` from a
     timestamp, never `Restore`/`Reset` on the production branch, which
     overwrites it.
   - Confirmed production remained the default branch, unchanged.
   - Pointed `DATABASE_URL` at `restore-test` and ran `prisma migrate status`.

   Result — note the host, which proves the test hit the restore branch and
   not production (`ep-purple-pond-am7nk03j`):

   ```
   Datasource "db": PostgreSQL database "neondb", schema "public"
     at "ep-weathered-field-amwzm01h-pooler.c-5.us-east-1.aws.neon.tech"

   2 migrations found in prisma/migrations

   Database schema is up to date!
   ```

   The restored copy is not merely connectable — it is *correctly migrated*.
   A restore that produces a half-migrated schema is exactly the failure
   `/api/health` was rewritten to catch, and it would look healthy until every
   route began returning 500s.

4. Deleted `restore-test` and the leftover `squash rehearsal` branch. On a paid
   plan extra branches bill at $1.50/branch-month.

**Backups are verified as of 2026-09-27.** Re-rehearse after any change to the
migration history or the Neon plan — a restore procedure that has not been run
recently is a procedure nobody knows still works.

### Cost: the uptime probe was defeating scale-to-zero

`/api/health` runs `prisma.depot.count()` — a real query, deliberately, so the
probe catches a half-migrated database. Neon suspends compute after **5 minutes**
of inactivity. `.github/workflows/uptime.yml` ran on `*/5`, so the probe reset
the idle timer and the compute never suspended.

Invisible on Free. On Launch, compute bills at `$0.106/CU-hour` and the default
compute is `0.25 ↔ 8 CU`, so a database that never sleeps is roughly **$19/month
at the 0.25 floor** for an app with no users yet. Scale-to-zero was enabled in
the console throughout; the workflow was preventing it from ever engaging.

Changed to `*/15`. The trade is coarser detection — an incident surfaces up to
15 minutes later instead of 5 — which is acceptable for a shift-swap board.
Once operators use it daily their own traffic keeps the database warm during
shift-change hours, at which point this is worth revisiting.

### Open Graph: the link people actually share had no card

The root page served no `og:title`, `og:description` or `og:image`.
`app/s/[id]/opengraph-image.tsx` produced a card for individual swap links, but
`wmnyshiftswap.com` — the URL an operator texts a coworker — unfurled as a bare
link. For an invite-only app that spreads by word of mouth inside a depot, that
link is the growth channel. Fixed with a static root card plus `metadataBase`,
which is load-bearing: without it the relative image route never resolves to the
absolute URL scrapers require and the card silently fails.

### iOS safe area: investigated, verified, deliberately unchanged

`appleWebApp.statusBarStyle` is `"black-translucent"`, and nothing in the app
sets `viewport-fit=cover` or reads `env(safe-area-inset-*)`. That pairing can
put content under the notch — but **verified on a real installed iPhone: nothing
is clipped**, because Next's default viewport omits `viewport-fit=cover`, so iOS
keeps the web view inside the safe area.

No change made. Adding `viewport-fit=cover` alone would switch on full-bleed
with no inset handling anywhere and create the bug. A comment in `layout.tsx`
and a test in `test/openGraph.test.ts` now guard that pairing.

### Known and accepted at launch

- `robots.txt` is `User-agent: * / Disallow: /` with no sitemap. Correct for an
  invite-only app; a deliberate decision, not an oversight.
- Push **subscription** is verified on a physical iPhone
  (`POST /api/push/subscribe 200`). Push **delivery** has never been exercised.
- Android is untested: install, notifications, back-button behaviour.
- No Lighthouse run: LCP, CLS, bundle size and unused JS/CSS are unmeasured.
- `HEARTBEAT_URL_BASE` unset. Four of six healthchecks.io checks configured
  (`expire-swaps`, `cleanup-swaps`, `expire-announcements`, `daily-digest`);
  `agreement-followups` and `expiring-soon` outstanding.

### Verdict

🟢 **GO.** No critical blockers. The one that existed — unverified, possibly
unavailable backups — is closed with a rehearsed restore.

---

## 6. Second-pass changes, in brief

Everything below was open at the end of the first pass and is now closed. Details
are in the commit messages.

| Area | What changed |
|---|---|
| Revocation | Moved into `requireUser()`; 73 call sites; 401 vs 503 distinguished; `x-middleware-subrequest` refused |
| Login | Dummy-hash compare kills the timing oracle; one 401 for every credential failure; expired locks reset the counter (the indefinite-lockout DoS) |
| Register | Invite code validated before the email-exists 409, so a garbage code no longer enumerates addresses |
| Rate limiter | Fails closed in production when Upstash is missing; `isValidIp` uses a real parser; `clientIp` prefers `x-vercel-forwarded-for`; comments now match the code |
| Profile | Email format validated; changing it clears `verified` and re-sends verification; `@deleted.invalid` rejected; depot cooldown can't be reset via null |
| Disputes | New `admin/disputes` queue — `disputed` was terminal with no admin route, making no-shows deniable |
| Crons | `claimDailyRun()` makes the two notifying crons idempotent against at-least-once delivery |
| Notifications | Message text removed from push bodies (lock-screen leak) |
| URLs | Report email uses `getAppUrl()`; verify-email no longer falls back into production from a preview |
| Dependencies | `prisma` → devDependencies, removing every high advisory from `--omit=dev` |
| Lint | 19 errors → 0, and CI now runs it |
| Registration | Non-affiliation acknowledgement gates account creation |
| Tests | 43 → **86 passing, 0 failing** with a real DB and Redis; includes the file that caught the `redactSensitiveText` bug |
| Build | **Compiles.** First real `next build` of any of this work |
| Types | 111 apparent errors → **0 actual errors** once the Prisma client generates |
| Migrations | Replay from empty verified; CI moved to `migrate deploy`; both partial indexes asserted in CI |
| Test isolation | `growth.test.ts` no longer fails on a second run / CI retry (per-run source IP) |
