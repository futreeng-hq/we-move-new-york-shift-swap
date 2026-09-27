-- DropEnum
-- AuditAction was never referenced: AuditLog.action is a plain String and no
-- code imports the enum. Dropping an unused type is safe.
-- IF EXISTS is required, not cosmetic: no migration in this repo ever CREATEs
-- this type (it exists in production only as pre-migration drift), so a bare
-- DROP fails on any database built from scratch. That failure is recorded in
-- _prisma_migrations, which then blocks every later `migrate deploy` with
-- P3009 — including 20260704_trust_v2, whose partial unique indexes the
-- agreement conflict handling depends on.
DROP TYPE IF EXISTS "AuditAction";
