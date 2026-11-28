-- Sessions: a room is a project; each session has its own conversation, members and saved copy.
--
--   * Every room has one default session ("General"). New people are added to it when they first
--     join; the host can take them out of it.
--   * Only the host creates, renames, deletes sessions and chooses their members (1 to 64 people
--     listed each, at most 24 sessions per room). A person may be in several sessions. A room has
--     at most 16 people in it at once; a session's list also keeps people who left and may come
--     back, so it can be longer.
--   * A session is private: only its members and the room's host can read its row, its member
--     list, its saved copy, or use its live channel `session:{session id}`.
--   * Rooms hold up to 16 people (was 8).
--   * rooms.sessions_rev goes up whenever a session or its members change; touch_room returns it,
--     so every open page notices within one heartbeat (the host's page also signals at once
--     through the room document).

-- ---------------------------------------------------------------------------------------------
-- Rooms of 16
-- ---------------------------------------------------------------------------------------------

alter table public.room_members drop constraint room_members_slot_check;
alter table public.room_members add constraint room_members_slot_check check (slot between 1 and 16);

alter table public.rooms add column sessions_rev integer not null default 0;

-- (room_json is replaced to carry sessions_rev)
create or replace function public.room_json(p_room public.rooms)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_room.id,
    'code', p_room.code,
    'name', p_room.name,
    'host_uid', p_room.host_uid,
    'locked', p_room.locked,
    'created_at', p_room.created_at,
    'sessions_rev', p_room.sessions_rev
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  is_default boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index sessions_room_idx on public.sessions (room_id);
create unique index sessions_one_default_idx on public.sessions (room_id) where is_default;

create table public.session_members (
  session_id uuid not null references public.sessions (id) on delete cascade,
  uid uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (session_id, uid)
);

create index session_members_uid_idx on public.session_members (uid);

create table public.session_snapshots (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  -- the session document (one encoded update, gzip-compressed by the app), at most 8 MB
  state bytea not null check (octet_length(state) <= 8388608),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.session_snapshots enable row level security;

revoke all on table public.sessions from anon, authenticated;
revoke all on table public.session_members from anon, authenticated;
revoke all on table public.session_snapshots from anon, authenticated;

grant select on table public.sessions to authenticated;
grant select on table public.session_members to authenticated;
grant select on table public.session_snapshots to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- True when the caller has a seat in the session's room and is either one of its members or the
-- room's host.
create function public.is_session_member(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    join public.rooms r on r.id = s.room_id
    where s.id = p_session
      and public.is_room_member(s.room_id)
      and (
        r.host_uid = (select auth.uid())
        or exists (
          select 1 from public.session_members sm
          where sm.session_id = s.id and sm.uid = (select auth.uid())
        )
      )
  );
$$;

-- The caller is the room's host and has a seat in it.
create function public.is_room_host(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_room_member(p_room)
    and exists (select 1 from public.rooms r where r.id = p_room and r.host_uid = (select auth.uid()));
$$;

create function public.session_json(p_session public.sessions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'room_id', p_session.room_id,
    'name', p_session.name,
    'is_default', p_session.is_default,
    'created_at', p_session.created_at,
    'members', coalesce(
      (select jsonb_agg(sm.uid order by sm.added_at, sm.uid)
       from public.session_members sm where sm.session_id = p_session.id),
      '[]'::jsonb
    )
  );
$$;

create function public.bump_sessions_rev(p_room uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rooms r set sessions_rev = r.sessions_rev + 1, last_active_at = now()
  where r.id = p_room;
$$;

-- Checks a member list: 1 to 64 distinct people, each with a seat in the room (not removed).
create function public.valid_session_members(p_room uuid, p_members uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(p_members), 0) between 1 and 64
    and (select count(distinct x) from unnest(p_members) as x) = cardinality(p_members)
    and not exists (
      select 1 from unnest(p_members) as x
      where not exists (
        select 1 from public.room_members m
        where m.room_id = p_room and m.uid = x and m.removed_at is null
      )
    );
$$;

-- ---------------------------------------------------------------------------------------------
-- Policies: members (and the host) read; nobody writes a table directly
-- ---------------------------------------------------------------------------------------------

create policy "members read their sessions"
on public.sessions for select to authenticated
using (public.is_session_member(id));

create policy "members read who is in their sessions"
on public.session_members for select to authenticated
using (public.is_session_member(session_id));

create policy "members read their session's snapshot"
on public.session_snapshots for select to authenticated
using (public.is_session_member(session_id));

-- ---------------------------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------------------------

-- The sessions the caller may open: all of them for the host, their own for everyone else.
create function public.list_sessions(p_room uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rev integer;
begin
  if not public.is_room_member(p_room) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  select r.sessions_rev into v_rev from public.rooms r where r.id = p_room;
  return jsonb_build_object(
    'ok', true,
    'rev', v_rev,
    'sessions', coalesce(
      (select jsonb_agg(public.session_json(s) order by s.is_default desc, s.created_at, s.id)
       from public.sessions s
       where s.room_id = p_room and public.is_session_member(s.id)),
      '[]'::jsonb
    )
  );
end;
$$;

create function public.create_session(p_room uuid, p_name text, p_members uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.clean_line(p_name, 40);
  v_session public.sessions;
begin
  if not public.is_room_host(p_room) then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if v_name = '' or not public.valid_session_members(p_room, p_members) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if (select count(*) from public.sessions s where s.room_id = p_room) >= 24 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.sessions (room_id, name, created_by)
  values (p_room, v_name, v_uid)
  returning * into v_session;
  -- (one microsecond apart: the list keeps the order the host chose)
  insert into public.session_members (session_id, uid, added_at)
  select v_session.id, t.x, now() + t.n * interval '1 microsecond'
  from unnest(p_members) with ordinality as t (x, n);
  perform public.bump_sessions_rev(p_room);
  return jsonb_build_object('ok', true, 'session', public.session_json(v_session));
end;
$$;

-- Renames a session and/or replaces its member list (null = keep).
create function public.update_session(p_session uuid, p_name text, p_members uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_name text;
begin
  select * into v_session from public.sessions s where s.id = p_session for update;
  if not found or not public.is_room_host(v_session.room_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if p_name is not null then
    v_name := public.clean_line(p_name, 40);
    if v_name = '' then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
    update public.sessions s set name = v_name where s.id = p_session;
  end if;
  if p_members is not null then
    if not public.valid_session_members(v_session.room_id, p_members) then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
    delete from public.session_members sm
    where sm.session_id = p_session and not (sm.uid = any (p_members));
    insert into public.session_members (session_id, uid, added_at)
    select p_session, t.x, now() + t.n * interval '1 microsecond'
    from unnest(p_members) with ordinality as t (x, n)
    on conflict do nothing;
  end if;
  perform public.bump_sessions_rev(v_session.room_id);
  select * into v_session from public.sessions s where s.id = p_session;
  return jsonb_build_object('ok', true, 'session', public.session_json(v_session));
end;
$$;

-- Deletes a session with its saved copy (the room's default session cannot be deleted).
create function public.delete_session(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  select * into v_session from public.sessions s where s.id = p_session;
  if not found or not public.is_room_host(v_session.room_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if v_session.is_default then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  delete from public.sessions s where s.id = p_session;
  perform public.bump_sessions_rev(v_session.room_id);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.save_session_snapshot(p_session uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_state bytea;
  v_room uuid;
begin
  if not public.is_session_member(p_session) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  begin
    v_state := decode(p_state, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end;
  if v_state is null or octet_length(v_state) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if octet_length(v_state) > 8388608 then
    return jsonb_build_object('ok', false, 'reason', 'too_large');
  end if;
  insert into public.session_snapshots (session_id, state, updated_at, updated_by)
  values (p_session, v_state, now(), v_uid)
  on conflict (session_id) do update
    set state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  select s.room_id into v_room from public.sessions s where s.id = p_session;
  update public.rooms r set last_active_at = now()
  where r.id = v_room and r.last_active_at < now() - interval '5 minutes';
  return jsonb_build_object('ok', true);
end;
$$;

create function public.load_session_snapshot(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot public.session_snapshots;
begin
  if not public.is_session_member(p_session) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  select * into v_snapshot from public.session_snapshots s where s.session_id = p_session;
  if not found then
    return jsonb_build_object('ok', true, 'state', null);
  end if;
  return jsonb_build_object(
    'ok', true,
    'state', replace(encode(v_snapshot.state, 'base64'), E'\n', ''),
    'updated_at', v_snapshot.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_room and join_room: rooms of 16, and the default session
-- ---------------------------------------------------------------------------------------------

create or replace function public.create_room(p_code text, p_name text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.clean_line(p_name, 60);
  v_display text := public.clean_line(p_display_name, 24);
  v_room public.rooms;
  v_session uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_code is null or p_code !~ '^[1-9A-HJKMNP-TV-Z]{6}$' or v_display = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_name = '' then
    v_name := 'Untitled room';
  end if;
  select * into v_room from public.rooms r where r.code = p_code;
  if found then
    -- asking twice for the same new room (a double click, a retry) is not an error
    if v_room.host_uid = v_uid then
      return jsonb_build_object('ok', true, 'room', public.room_json(v_room), 'slot', 1, 'uid', v_uid);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'code_taken');
  end if;
  if not public.rl_hit(v_uid, 'create', 5) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  begin
    insert into public.rooms (code, name, host_uid)
    values (p_code, v_name, v_uid)
    returning * into v_room;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'code_taken');
  end;
  insert into public.room_members (room_id, uid, slot, display_name)
  values (v_room.id, v_uid, 1, v_display);
  insert into public.sessions (room_id, name, is_default, created_by)
  values (v_room.id, 'General', true, v_uid)
  returning id into v_session;
  insert into public.session_members (session_id, uid) values (v_session, v_uid);
  return jsonb_build_object('ok', true, 'room', public.room_json(v_room), 'slot', 1, 'uid', v_uid);
end;
$$;

-- Joins a room by its code (as before, now up to 16 active people and 16 colour slots). A first
-- join also adds the person to the room's default session, if it has room for them.
create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_display text := public.clean_line(p_display_name, 24);
  v_room public.rooms;
  v_member public.room_members;
  v_active integer;
  v_slot smallint;
  v_default uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_code is null or p_code !~ '^[1-9A-HJKMNP-TV-Z]{6}$' or v_display = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_room from public.rooms r where r.code = p_code for update;
  if not found then
    if not public.rl_hit(v_uid, 'join', 30) then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_member from public.room_members m where m.room_id = v_room.id and m.uid = v_uid;
  if found and v_member.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'removed', 'name', v_room.name);
  end if;

  select count(*) into v_active
  from public.room_members m
  where m.room_id = v_room.id
    and m.uid <> v_uid
    and m.removed_at is null
    and m.left_at is null
    and m.last_seen_at > now() - interval '90 seconds';

  if v_member.uid is null then
    if not public.rl_hit(v_uid, 'join', 30) then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    if v_room.locked then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'name', v_room.name);
    end if;
  end if;
  if v_active >= 16 then
    return jsonb_build_object('ok', false, 'reason', 'full', 'name', v_room.name);
  end if;

  select s.slot into v_slot
  from generate_series(1, 16) as s (slot)
  where not exists (
    select 1
    from public.room_members m
    where m.room_id = v_room.id
      and m.uid <> v_uid
      and m.slot = s.slot
      and m.removed_at is null
      and m.left_at is null
      and m.last_seen_at > now() - interval '90 seconds'
  )
  order by (s.slot = v_member.slot) desc nulls last, s.slot
  limit 1;

  insert into public.room_members (room_id, uid, slot, display_name)
  values (v_room.id, v_uid, v_slot, v_display)
  on conflict (room_id, uid) do update
    set slot = excluded.slot,
        display_name = excluded.display_name,
        last_seen_at = now(),
        left_at = null;

  if v_member.uid is null then
    select s.id into v_default from public.sessions s where s.room_id = v_room.id and s.is_default;
    if v_default is not null
      and (select count(*) from public.session_members sm where sm.session_id = v_default) < 64 then
      insert into public.session_members (session_id, uid) values (v_default, v_uid)
      on conflict do nothing;
      update public.rooms r set sessions_rev = r.sessions_rev + 1 where r.id = v_room.id
      returning * into v_room;
    end if;
  end if;

  update public.rooms r set last_active_at = now()
  where r.id = v_room.id and r.last_active_at < now() - interval '5 minutes';

  return jsonb_build_object('ok', true, 'room', public.room_json(v_room), 'slot', v_slot, 'uid', v_uid);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Realtime: `room:{id}` for people with a seat, `session:{id}` for session members and the host
-- ---------------------------------------------------------------------------------------------

create or replace function public.can_use_room_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_room_member(substring(p_topic from 6)::uuid)
    when p_topic ~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_session_member(substring(p_topic from 9)::uuid)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Rooms made before sessions: one default session with everyone who still has a seat
-- (their conversation is copied into it from the room's saved copy by the app, once)
-- ---------------------------------------------------------------------------------------------

insert into public.sessions (room_id, name, is_default, created_by)
select r.id, 'General', true, r.host_uid
from public.rooms r
where not exists (select 1 from public.sessions s where s.room_id = r.id and s.is_default);

insert into public.session_members (session_id, uid)
select s.id, m.uid
from public.sessions s
join lateral (
  select m.uid from public.room_members m
  where m.room_id = s.room_id and m.removed_at is null
  order by m.joined_at
  limit 64
) m on true
where s.is_default
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.is_session_member(uuid) from public, anon;
grant execute on function public.is_session_member(uuid) to authenticated;
revoke execute on function public.list_sessions(uuid) from public, anon;
grant execute on function public.list_sessions(uuid) to authenticated;
revoke execute on function public.create_session(uuid, text, uuid[]) from public, anon;
grant execute on function public.create_session(uuid, text, uuid[]) to authenticated;
revoke execute on function public.update_session(uuid, text, uuid[]) from public, anon;
grant execute on function public.update_session(uuid, text, uuid[]) to authenticated;
revoke execute on function public.delete_session(uuid) from public, anon;
grant execute on function public.delete_session(uuid) to authenticated;
revoke execute on function public.save_session_snapshot(uuid, text) from public, anon;
grant execute on function public.save_session_snapshot(uuid, text) to authenticated;
revoke execute on function public.load_session_snapshot(uuid) from public, anon;
grant execute on function public.load_session_snapshot(uuid) to authenticated;

revoke execute on function public.is_room_host(uuid) from public, anon, authenticated;
revoke execute on function public.session_json(public.sessions) from public, anon, authenticated;
revoke execute on function public.bump_sessions_rev(uuid) from public, anon, authenticated;
revoke execute on function public.valid_session_members(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.room_json(public.rooms) from public, anon, authenticated;
