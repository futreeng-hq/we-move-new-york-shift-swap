# Migration Baseline Squash — Runbook

Executes [#40](https://github.com/wemovenewyork/we-move-new-york-shift-swap/issues/40). Every step below was rehearsed end-to-end on throwaway Neon branches; the observed output is quoted inline.

---

## ⚠️ Read this first

**`vercel-build` runs `prisma migrate deploy` on EVERY deploy — preview as well
as production.**

```json
"vercel-build": "prisma migrate deploy && next build"
```

**CORRECTED 2026-09-27 — this section previously said the danger was merging.
It is not. It is PUSHING.** Pushing the squash branch creates a Vercel preview
deployment, which runs `vercel-build` against the PREVIEW database. That is a
write, and it happens before any PR is merged or even opened.

This actually happened. Pushing `chore/migration-baseline-squash` produced
deployment `dpl_BtmmREBGUQSacRfu6YWJ4sLKxNqH` (state ERROR):

```
Applying migration `20260720000000_baseline`
Error: P3018
Database error code: 42710
ERROR: type "AgreementStatus" already exists
```

Preview was left with a failed `20260720000000_baseline` row in
`_prisma_migrations`, blocking every subsequent preview deploy until it was
resolved by hand. Nothing was partially applied — `CREATE TYPE
"AgreementStatus"` is the first executable statement in the baseline, so it
failed on statement one — but the bookkeeping damage was real.

**Correct gating: resolve each live environment BEFORE the branch is pushed,
or accept that the first preview deploy will fail and plan to resolve preview
immediately after pushing.** Merging is the second gate, not the first.

The original rehearsal below used a database seeded to look like production:

```
Applying migration `20260720000000_baseline`
Error: P3018
Database error code: 42710          ← duplicate object: the tables already exist
```

P3018 records the migration as **failed** in `_prisma_migrations`, which then blocks *every subsequent deploy* until someone resolves it by hand. A broken deploy pipeline, not just a broken deploy.

**The resolve step must happen on every live environment before that
environment gets a deploy carrying the baseline.** For preview that means
before the branch is pushed; for production, before the PR merges. That
ordering is the whole point of this runbook, and getting it half-right — the
merge gate without the push gate — is what broke preview on 2026-09-27.

---

## Why this is needed

> **The "Correction (2026-09-25)" that stood here was itself wrong, and is
> retracted (2026-09-26). The original diagnosis below this line is correct and
> this runbook should be executed.**
>
> That correction claimed Prisma sorts migration directories lexicographically,
> where `'2'` (0x32) precedes `'_'` (0x5F), so `20260401214939_init` sorts first
> and the 8-digit directories do not jump ahead of it. It asserted this as
> "rehearsed" without ever running `migrate deploy` against an empty database —
> the check it claimed to have done was a shell `sort`, which is not Prisma's
> ordering.
>
> Prisma orders by the numeric timestamp prefix, exactly as originally
> documented. CI proved it on the first `pull_request` run of PR #46:
> `20260401_add_agreements_push_roles` failed with
> `42P01 relation "users" does not exist`. Reproduced directly against an empty
> Postgres 16 on 2026-09-26 — numeric-prefix order fails on that migration;
> `init`-first order applies all 16 cleanly.
>
> The `DROP TYPE IF EXISTS` fix from that pass is still correct and still
> needed. It was a second, real bug sitting behind this one — not a replacement
> for it.
>
> Everything below is the original, rehearsed guidance. Follow it.
>
> ~~Prisma sorts migration directories **lexicographically**, not by parsed
> numeric prefix, and `'2'` (0x32) sorts before `'_'` (0x5F) — so
> `20260401214939_init` sorts **first**, and the 8-digit directories do not jump
> ahead of it.~~
>
> The actual from-scratch failure was
> `20260704_drop_unused_audit_action/migration.sql`, which ran a bare
> `DROP TYPE "AuditAction"` on a type **no migration in this repo ever creates**
> — it exists in production only as pre-migration drift. On an empty database
> that statement errored, Prisma recorded the migration as failed, and P3009 then
> blocked every later migration, including `20260704_trust_v2` — which is what
> adds `accepted_at`, `user_a_happened`, `shift_date`, the `'accepted'` enum
> value, and **both partial unique indexes** the agreement conflict handling
> depends on. So a fresh environment did not merely lack a 409; its agreement
> flow did not work at all.
>
> Fixed by changing that one statement to `DROP TYPE IF EXISTS`.
>
> ~~**Rehearsed 2026-09-25: this squash is no longer needed.**~~ **Retracted
> 2026-09-26. The squash IS still needed and this runbook is live.** The claim
> that all 16 migrations apply cleanly in order was produced by a shell `sort`,
> not by `migrate deploy`, and is false under Prisma's ordering. CI has been
> reverted to `db push` + `partial-indexes.sql` until this runbook was executed.
> **Executed 2026-09-27 (PR #48 + the CI switch). CI is back on `migrate
> deploy` and `prisma/partial-indexes.sql` has been deleted.**
>
> Note for step 6: `db push` cannot express a partial unique index, so while CI
> is on `db push` its constraints are not identical to production's. That is a
> real cost and it is why finishing this runbook matters — but it is a weaker
> guarantee, not a broken one, because `partial-indexes.sql` adds the two
> indexes explicitly and CI asserts both exist.

~~Prisma orders migrations by the numeric prefix of the directory name. Actual apply order today:~~

```
20260401_add_agreements_push_roles     ← 20260401        applied FIRST
...
20260704_trust_v2                      ← 20260704
20260401214939_init                    ← 20260401214939  applied LAST
```

~~The real baseline sorts **last**, so the first migration applied `ALTER`s a `users` table that does not exist:~~

```
$ npx prisma migrate deploy          # against any empty database
Applying migration `20260401_add_agreements_push_roles`
ERROR: relation "users" does not exist
```

Production and preview are unaffected — they were built incrementally, one migration at a time. The defect only appears on a from-scratch build, which is why nothing has caught it: CI works around it with `db push`, and Neon branches inherit their parent's schema.

Consequences before the fix: no new environment could be stood up from this repo, disaster recovery had no tested path, and CI could not exercise the same migration path production uses.

---

## Generating the baseline

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > baseline.sql
```

Note `--to-schema`. Prisma 7 removed `--to-schema-datamodel`; the old flag exits 1 with an empty file, which is easy to miss in a pipeline.

That yields 15 tables, 23 indexes, 5 enums — **and zero partial indexes**:

```
$ grep -c 'WHERE' baseline.sql
0
```

The two partial unique indexes cannot be expressed in `schema.prisma`, so they must be appended from `prisma/partial-indexes.sql`:

```sql
CREATE UNIQUE INDEX "swap_agreements_swap_id_accepted_key"
  ON "swap_agreements" ("swap_id") WHERE status IN ('accepted', 'userA_confirmed');
CREATE UNIQUE INDEX "swap_agreements_swap_user_pending_key"
  ON "swap_agreements" ("swap_id", "user_a_id") WHERE status = 'pending';
```

Ship the baseline without them and duplicate proposals return **201 instead of 409** — a silent correctness regression in the agreement flow, with a green schema.

Final artifact: `prisma/migrations/20260720000000_baseline/migration.sql`, 413 lines.

---

## Rehearsal results

### A. Bare database → squashed baseline

```
$ npx prisma migrate deploy
Applying migration `20260720000000_baseline`
The following migration(s) have been applied:

tables: 16                     (15 + _prisma_migrations)
partial indexes: swap_agreements_swap_id_accepted_key,
                 swap_agreements_swap_user_pending_key
```

Full suite against that database: **66 tests, 65 pass, 0 fail, 1 expected skip.**

Drift check clean:

```
$ npx prisma migrate diff --from-schema prisma/schema.prisma --to-url "$DATABASE_URL" --script
(empty — no drift)
```

### B. Production-shaped database → resolve → deploy

Seeded to match production: schema present, all 16 old migration names recorded as applied.

Without resolve — the failure quoted at the top of this document. With resolve:

```
$ npx prisma migrate resolve --applied 20260720000000_baseline
Migration 20260720000000_baseline marked as applied.

$ npx prisma migrate deploy
No pending migrations to apply.
```

Clean no-op. This is the path to follow.

---

## Execution order

Do **not** reorder. Steps 3–4 must complete before step 5.

1. **Open the squash PR.** Delete the 16 migration dirs, add `20260720000000_baseline/`, keep `migration_lock.toml`. Do not merge yet.

   ⚠️ **Pushing the branch triggers a Vercel preview deploy, which runs
   `migrate deploy` against the PREVIEW database and will fail with P3018.**
   Either resolve preview before pushing, or push and then immediately run
   step 4 against preview to clear the failed row. Do not leave preview in a
   failed state — it blocks every later preview deploy.
2. **Verify CI.** The `test` job builds from `db push`, so it stays green either way — this step confirms nothing else broke, it does not validate the baseline. Validation is step 3.
3. **Rehearse on a fresh Neon branch off production.** Run `migrate resolve --applied 20260720000000_baseline`, then `migrate deploy`, and confirm `No pending migrations to apply`. Delete the branch. Repeat if anything is unclear — this is free.
4. **Resolve on each live environment,** preview first, then production:
   ```bash
   DATABASE_URL="<env-direct-url>" npx prisma migrate resolve --applied 20260720000000_baseline
   ```
   Confirm `_prisma_migrations` then contains exactly one row, `20260720000000_baseline`, with `rolled_back_at IS NULL`.
5. **Merge the PR.** The next deploy runs `migrate deploy` and should report `No pending migrations to apply`. Watch the deploy log to confirm.
6. **Switch CI to `migrate deploy`.** ✅ **DONE.** Replaced the `db push` + `db execute` pair in `.github/workflows/ci.yml` and deleted `prisma/partial-indexes.sql`. CI now exercises the same path production uses — the real prize.

Per CLAUDE.md, never echo a connection string. Pass URLs via env or redirect; verify blind with `grep -c`.

---

## Rollback

Before step 4, take a Neon point-in-time snapshot or note a restore timestamp for each environment.

- **Step 4 goes wrong (resolve on a live DB):** `_prisma_migrations` is bookkeeping only — no DDL runs. Restore the old rows, or re-insert the 16 original migration names, and revert the PR.
- **Step 5 goes wrong (deploy attempts to apply the baseline):** you will see P3018 / 42710. Do **not** retry the deploy — it will keep failing on the recorded failure. Run `migrate resolve --applied` on that environment, confirm `No pending migrations to apply`, then redeploy.
- **Schema actually damaged:** restore from the Neon snapshot. No step here runs destructive DDL, so this should not be reachable.

---

## Acceptance — status 2026-09-27

- [x] The baseline applies cleanly to a completely empty Postgres 16, producing
      15 tables, 5 enums and both partial unique indexes. Verified directly;
      `migrate deploy` itself is exercised by CI (the schema engine could not be
      downloaded in the environment where the baseline was built).
- [x] Both partial unique indexes exist afterward. The CI assertion step counts
      exactly 2 and fails the build otherwise.
- [x] A post-merge production deploy logs `No pending migrations to apply`.
      Confirmed in the build log of `dpl_JC2wGgduuSrsHPNZweDef5Vbiat5`
      (commit 38ab48b, datasource `ep-purple-pond`).
- [x] CI uses `migrate deploy`; `prisma/partial-indexes.sql` deleted.
- [ ] Full suite passes against a squash-built database — pending the first CI
      run on `migrate deploy`.

### Not satisfied, and why

- **`migrate diff` is NOT empty for production.** It reports two items, both
  predating this work: `playing_with_neon` (Neon's onboarding sample table,
  present in the database, absent from `schema.prisma` and the baseline) and
  the `blocks` foreign keys (`schema.prisma` implies `onUpdate: Cascade`; the
  database and the baseline both have `ON UPDATE NO ACTION`). The baseline
  matches the database on both counts, so the squash is faithful —
  `schema.prisma` is the file out of step. Tracked as a separate follow-up.

- **Production and preview do NOT show exactly one `_prisma_migrations` row.**
  `migrate resolve --applied` inserts the baseline row; it does not remove the
  16 stale rows, which remain recorded. `migrate deploy` is unaffected — it
  applies by name and the baseline is recorded — but `migrate status` will keep
  reporting the 16 as "not found locally". Cosmetic; delete those rows only
  deliberately, and never as part of a deploy.
