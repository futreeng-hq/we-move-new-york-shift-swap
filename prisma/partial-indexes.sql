-- Partial unique indexes — NOT expressible in schema.prisma.
--
-- Prisma's schema language has no syntax for a UNIQUE INDEX with a WHERE
-- clause, so these live only as raw SQL in prisma/migrations/. That is fine
-- for production and preview, which are built by `prisma migrate deploy`.
--
-- These indexes are created by 20260704_trust_v2, so any database built with
-- `prisma migrate deploy` has them. This file exists for two other cases:
--
--   1. A database built with `prisma db push`, which syncs from schema.prisma
--      and silently omits them. The visible symptom is conflict tests returning
--      201 instead of 409: without the pending index a duplicate proposal
--      inserts cleanly instead of tripping P2002.
--   2. Repairing a database where one was dropped.
--
-- RETRACTION (2026-09-26): a "CORRECTION" added here on 2026-09-25 claimed CI
-- could use `migrate deploy` because Prisma sorts lexicographically, where '2'
-- (0x32) precedes '_' (0x5F) and 20260401214939_init would sort first. That
-- claim was false and was never actually tested against an empty database.
--
-- Prisma orders migrations by the numeric timestamp prefix. The fifteen
-- hand-named 8-digit dirs (20260401, 20260402, ...) therefore sort AHEAD of
-- the 14-digit baseline 20260401214939_init, so init runs last and the first
-- migration applied fails with 42P01 relation "users" does not exist. CI
-- reproduced this on the first pull_request run of PR #46, and it was then
-- reproduced directly against an empty Postgres 16.
--
-- The SQL is correct; the directory names are the defect. Renaming them is
-- the real fix, but it changes the names in _prisma_migrations and would make
-- production re-apply fifteen migrations over an existing schema (verified to
-- fail with 'type "UserRole" already exists'). That needs a deliberate
-- `migrate resolve --applied` reconciliation first. Until then CI stays on
-- db push and this file remains load-bearing.
--
-- Keep this file in sync when a migration adds or changes a partial index.

-- One live (accepted) agreement per swap.
CREATE UNIQUE INDEX IF NOT EXISTS "swap_agreements_swap_id_accepted_key"
  ON "swap_agreements" ("swap_id")
  WHERE status IN ('accepted', 'userA_confirmed');

-- One pending proposal per (swap, proposer) — the 409 duplicate-proposal path.
CREATE UNIQUE INDEX IF NOT EXISTS "swap_agreements_swap_user_pending_key"
  ON "swap_agreements" ("swap_id", "user_a_id")
  WHERE status = 'pending';
