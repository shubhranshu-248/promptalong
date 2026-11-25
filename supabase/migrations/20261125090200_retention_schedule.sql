-- Runs the clean-up once a day when the pg_cron extension is enabled (Database > Extensions).
-- Without pg_cron nothing is scheduled: run `select public.delete_idle_rooms();` by hand
-- (docs/runbooks/database.md).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'promptalong-delete-idle-rooms',
      '17 3 * * *',
      'select public.delete_idle_rooms();'
    );
  end if;
end;
$$;
