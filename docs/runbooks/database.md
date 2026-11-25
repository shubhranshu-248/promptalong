# Database runbook

The app works without any database (rooms then live on one device, or sync through the local
relay). With a Supabase project it gets sign-in, saved rooms, locking and private channels.

## Test the rules without anything running

```bash
pnpm --filter @promptalong/db test
```

Runs every migration in `supabase/migrations` on an in-process Postgres and checks the row-level
security rules and SQL functions. This is part of `pnpm test` and of CI.

## Local stack (Docker)

```bash
npx supabase start          # database, auth and realtime, with the migrations applied
npx supabase status         # prints the local API URL and the public (anon) key
npx supabase db reset       # start again from the migrations
npx supabase stop
```

`supabase/config.jsonc` switches anonymous sign-ins on for the local stack. Point the app at it
with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (in `apps/web/.env.local`, or as environment
variables for one command). End-to-end tests against it:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<public key from status> \
  E2E_REALTIME=supabase pnpm e2e
```

## Hosted project

1. Apply the migrations in order: paste each file of `supabase/migrations` into the SQL editor,
   or run `npx supabase link` and `npx supabase db push`.
2. Authentication > Sign In / Providers: switch **Allow anonymous sign-ins** on.
3. Authentication > Rate Limits: anonymous sign-ins are limited per IP address (30 an hour by
   default). A class or a hackathon behind one Wi-Fi address shares that limit: raise it before
   an event.
4. Realtime > Settings: switch **Allow public access** off, so only private channels work.
5. Optional: Database > Extensions: enable `pg_cron`, then run the statement in
   `supabase/migrations/20261125090200_retention_schedule.sql` again to schedule the daily
   clean-up.

The app only needs the project URL and the public (anon) key. The database password and the
service-role key are never used by the app and must never be put in a `VITE_*` variable.

## Clean-up

Rooms idle for 30 days, rate-limit rows older than a day and anonymous users older than 30 days
with no room are deleted by:

```sql
select public.delete_idle_rooms();
```

With `pg_cron` this runs every day at 03:17 UTC. Without it, run it by hand from the SQL editor
now and then; the free plan allows 500 MB, and one room snapshot is at most 8 MB.

## A paused project

Free projects pause after about a week without activity. While it is paused, rooms cannot be
opened ("Rooms cannot be opened right now"); copies saved on people's devices still open when
they are offline. Restore the project from its dashboard; nothing is lost.
