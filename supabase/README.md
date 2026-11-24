# supabase/

Database migrations, row-level security policies and seed data for the free Supabase project.

- `migrations/` - SQL migrations, applied in order. Empty until the persistence phase.
- Every table has RLS enabled. No table has a column for model keys.

The tables planned so far (rooms, room_members, room_snapshots, rate limits) are described in
[docs/architecture.md](../docs/architecture.md).
