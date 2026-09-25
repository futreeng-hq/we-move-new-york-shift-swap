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
-- CORRECTION (2026-09-25): this header used to claim CI could not use
-- `migrate deploy` because the hand-named 8-digit dirs sorted ahead of the
-- 14-digit baseline. That was wrong — Prisma sorts lexicographically and '2'
-- (0x32) precedes '_' (0x5F), so 20260401214939_init sorts first. The real
-- blocker was a bare DROP TYPE in 20260704_drop_unused_audit_action on a type
-- no migration creates; it is now DROP TYPE IF EXISTS. All 16 migrations have
-- since been verified to apply cleanly to an empty Postgres 16, with both
-- indexes present afterwards, and CI now uses `migrate deploy`.
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
