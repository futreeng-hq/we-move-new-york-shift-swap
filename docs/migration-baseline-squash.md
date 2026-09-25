# Migration Baseline Squash — Runbook

Executes [#40](https://github.com/wemovenewyork/we-move-new-york-shift-swap/issues/40). Every step below was rehearsed end-to-end on throwaway Neon branches; the observed output is quoted inline.

---

## ⚠️ Read this first

**`vercel-build` runs `prisma migrate deploy` on every production deploy.**

```json
"vercel-build": "prisma migrate deploy && next build"
```

So merging the squash PR *before* running `migrate resolve --applied` on each live environment does not fail safely. Rehearsed on a database seeded to look like production:

```
Applying migration `20260720000000_baseline`
Error: P3018
Database error code: 42710          ← duplicate object: the tables already exist
```

P3018 records the migration as **failed** in `_prisma_migrations`, which then blocks *every subsequent deploy* until someone resolves it by hand. A broken deploy pipeline, not just a broken deploy.

**The resolve step must happen on every live environment before the PR merges.** That ordering is the whole point of this runbook.

---

## Why this is needed

> **Correction (2026-09-25).** The diagnosis below this line was wrong, and the
> same wrong explanation was copied into `.github/workflows/ci.yml`. Prisma sorts
> migration directories **lexicographically**, not by parsed numeric prefix, and
> `'2'` (0x32) sorts before `'_'` (0x5F) — so `20260401214939_init` sorts
> **first**, and the 8-digit directories do not jump ahead of it. Applying all 16
> `migration.sql` files in order against an empty Postgres 16 succeeds through
> the first 15.
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
> **Rehearsed 2026-09-25: this squash is no longer needed.** All 16 migrations
> apply cleanly, in order, to an empty Postgres 16, and both partial unique
> indexes are present afterwards (they come from `20260704_trust_v2`, which the
> P3009 block had been preventing from ever running). CI has been switched from
> `db push` to `migrate deploy` accordingly, so it now builds the database
> exactly as production does — under `db push` its constraints were not the same
> as production's, because `db push` cannot express a partial unique index.
>
> The rest of this document is kept for history. Do not run the 6-step runbook
> below; it resolves a problem that does not exist, and `migrate resolve
> --applied` against production's `_prisma_migrations` on a misdiagnosis is not
> a harmless no-op.

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
2. **Verify CI.** The `test` job builds from `db push`, so it stays green either way — this step confirms nothing else broke, it does not validate the baseline. Validation is step 3.
3. **Rehearse on a fresh Neon branch off production.** Run `migrate resolve --applied 20260720000000_baseline`, then `migrate deploy`, and confirm `No pending migrations to apply`. Delete the branch. Repeat if anything is unclear — this is free.
4. **Resolve on each live environment,** preview first, then production:
   ```bash
   DATABASE_URL="<env-direct-url>" npx prisma migrate resolve --applied 20260720000000_baseline
   ```
   Confirm `_prisma_migrations` then contains exactly one row, `20260720000000_baseline`, with `rolled_back_at IS NULL`.
5. **Merge the PR.** The next deploy runs `migrate deploy` and should report `No pending migrations to apply`. Watch the deploy log to confirm.
6. **Switch CI to `migrate deploy`.** Replace the `db push` + `db execute` pair in `.github/workflows/ci.yml` and delete `prisma/partial-indexes.sql`. CI then exercises the same path production uses — the real prize.

Per CLAUDE.md, never echo a connection string. Pass URLs via env or redirect; verify blind with `grep -c`.

---

## Rollback

Before step 4, take a Neon point-in-time snapshot or note a restore timestamp for each environment.

- **Step 4 goes wrong (resolve on a live DB):** `_prisma_migrations` is bookkeeping only — no DDL runs. Restore the old rows, or re-insert the 16 original migration names, and revert the PR.
- **Step 5 goes wrong (deploy attempts to apply the baseline):** you will see P3018 / 42710. Do **not** retry the deploy — it will keep failing on the recorded failure. Run `migrate resolve --applied` on that environment, confirm `No pending migrations to apply`, then redeploy.
- **Schema actually damaged:** restore from the Neon snapshot. No step here runs destructive DDL, so this should not be reachable.

---

## Acceptance

- [ ] `npx prisma migrate deploy` succeeds against a completely empty database
- [ ] Both partial unique indexes exist afterward (conflict tests return 409, not 201)
- [ ] Full suite passes against a squash-built database
- [ ] `migrate diff --from-schema … --to-url …` is empty for production and preview
- [ ] Production and preview each show exactly one `_prisma_migrations` row
- [ ] A post-merge production deploy logs `No pending migrations to apply`
- [ ] CI uses `migrate deploy`; `prisma/partial-indexes.sql` deleted
