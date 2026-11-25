# supabase/

- `migrations/` - SQL migrations, applied in order: tables with row-level security, the SQL
  functions every write goes through, the private Realtime channel policies, the clean-up job.
- `config.jsonc` - the local stack (`npx supabase start`): anonymous sign-ins on.

Every table has RLS enabled. No table has a column for model keys. The rules are tested by
`pnpm --filter @promptalong/db test` on an in-process Postgres.

How to set up a local stack or a hosted project: [docs/runbooks/database.md](../docs/runbooks/database.md).
The design: [docs/architecture.md](../docs/architecture.md).
