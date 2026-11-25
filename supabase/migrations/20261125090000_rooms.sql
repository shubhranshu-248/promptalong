-- Rooms, members, snapshots and rate limits.
--
-- Rules of this schema:
--   * Row-level security is enabled on every table. Members can read their own room's rows.
--   * Every write goes through the SQL functions below. They run as the owner (SECURITY DEFINER,
--     empty search_path), check who is calling with auth.uid(), and answer with JSON:
--     {"ok": true, ...} or {"ok": false, "reason": "..."}.
--   * No table has a column for model keys. Keys never reach the server.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- 6 characters, Crockford base32 without I, L, O, U and 0
  code text not null unique check (code ~ '^[1-9A-HJKMNP-TV-Z]{6}$'),
  -- the name given when the room was created (the live name is in the room document)
  name text not null check (char_length(name) between 1 and 60),
  host_uid uuid not null references auth.users (id) on delete cascade,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  uid uuid not null references auth.users (id) on delete cascade,
  slot smallint not null check (slot between 1 and 8),
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  -- refreshed by touch_room while the room is open; a seat is "active" for 90 seconds after it
  last_seen_at timestamptz not null default now(),
  -- left on their own (can come back)
  left_at timestamptz,
  -- removed by the host (cannot come back)
  removed_at timestamptz,
  primary key (room_id, uid)
);

create index room_members_uid_idx on public.room_members (uid);

create table public.room_snapshots (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  -- the whole room document (one encoded update), at most 8 MB
  state bytea not null check (octet_length(state) <= 8388608),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- one row per counted action, for the per-person rate limits
create table public.room_events_rl (
  uid uuid not null,
  kind text not null check (kind in ('create', 'join')),
  at timestamptz not null default now()
);

create index room_events_rl_idx on public.room_events_rl (uid, kind, at);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_snapshots enable row level security;
alter table public.room_events_rl enable row level security;

revoke all on table public.rooms from anon, authenticated;
revoke all on table public.room_members from anon, authenticated;
revoke all on table public.room_snapshots from anon, authenticated;
revoke all on table public.room_events_rl from anon, authenticated;

grant select on table public.rooms to authenticated;
grant select on table public.room_members to authenticated;
grant select on table public.room_snapshots to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- True when the caller currently has a seat in the room (not removed, has not left).
create function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members m
    where m.room_id = p_room
      and m.uid = (select auth.uid())
      and m.removed_at is null
      and m.left_at is null
  );
$$;

-- Records one action for a person unless they already reached the hourly limit.
create function public.rl_hit(p_uid uuid, p_kind text, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.room_events_rl e
  where e.uid = p_uid and e.kind = p_kind and e.at > now() - interval '1 hour';
  if v_count >= p_max then
    return false;
  end if;
  insert into public.room_events_rl (uid, kind) values (p_uid, p_kind);
  return true;
end;
$$;

-- One line of plain text: no control characters, single spaces, trimmed, at most p_max characters.
create function public.clean_line(p_text text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(left(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max));
$$;

create function public.room_json(p_room public.rooms)
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
    'created_at', p_room.created_at
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Policies: members read their own room; nobody writes a table directly
-- ---------------------------------------------------------------------------------------------

create policy "members read their room"
on public.rooms for select to authenticated
using (public.is_room_member(id));

create policy "members read who is in their room"
on public.room_members for select to authenticated
using (public.is_room_member(room_id));

create policy "members read their room's snapshot"
on public.room_snapshots for select to authenticated
using (public.is_room_member(room_id));

-- (room_events_rl has no policy: only the functions below touch it)

-- ---------------------------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------------------------

-- Creates a room with the caller as host. At most 5 rooms per person per hour.
create function public.create_room(p_code text, p_name text, p_display_name text)
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
  return jsonb_build_object('ok', true, 'room', public.room_json(v_room), 'slot', 1, 'uid', v_uid);
end;
$$;

-- Joins a room by its code. The room must exist, the caller must not have been removed, the room
-- must not be locked (people who already have a seat may come back) and fewer than 8 people may be
-- active. Gives the caller a colour slot. At most 30 counted attempts per person per hour: every
-- failed attempt and every first join counts, so codes cannot be guessed in bulk.
create function public.join_room(p_code text, p_display_name text)
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

  -- everyone else who is in the room right now
  select count(*) into v_active
  from public.room_members m
  where m.room_id = v_room.id
    and m.uid <> v_uid
    and m.removed_at is null
    and m.left_at is null
    and m.last_seen_at > now() - interval '90 seconds';

  if v_member.uid is null then
    -- a first join is a counted attempt, whatever its outcome
    if not public.rl_hit(v_uid, 'join', 30) then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    if v_room.locked then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'name', v_room.name);
    end if;
  end if;
  if v_active >= 8 then
    return jsonb_build_object('ok', false, 'reason', 'full', 'name', v_room.name);
  end if;

  -- keep the old colour when it is free, else the lowest slot nobody active is using
  select s.slot into v_slot
  from generate_series(1, 8) as s (slot)
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

  update public.rooms r set last_active_at = now()
  where r.id = v_room.id and r.last_active_at < now() - interval '5 minutes';

  return jsonb_build_object('ok', true, 'room', public.room_json(v_room), 'slot', v_slot, 'uid', v_uid);
end;
$$;

-- Heartbeat while a room is open: keeps the caller's seat and tells the client what changed
-- (locked, host) or that it is no longer in the room.
create function public.touch_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.room_members;
  v_room public.rooms;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  select * into v_member from public.room_members m where m.room_id = p_room and m.uid = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  if v_member.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'removed');
  end if;
  update public.room_members m set last_seen_at = now(), left_at = null
  where m.room_id = p_room and m.uid = v_uid;
  update public.rooms r set last_active_at = now()
  where r.id = p_room and r.last_active_at < now() - interval '5 minutes';
  select * into v_room from public.rooms r where r.id = p_room;
  return jsonb_build_object('ok', true, 'room', public.room_json(v_room));
end;
$$;

-- Gives the caller's seat back (they can join again later). A page that is closing sends its last
-- copy of the room with it (p_state, base64): one request, so the copy is saved while the seat is
-- still theirs. A refused copy (too large, invalid) does not stop the leaving.
create function public.leave_room(p_room uuid, p_state text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_state is not null then
    perform public.save_snapshot(p_room, p_state);
  end if;
  update public.room_members m set left_at = now()
  where m.room_id = p_room and m.uid = v_uid and m.removed_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Host powers
-- ---------------------------------------------------------------------------------------------

create function public.set_room_locked(p_room uuid, p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.rooms r set locked = coalesce(p_locked, false), last_active_at = now()
  where r.id = p_room and r.host_uid = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  return jsonb_build_object('ok', true, 'locked', coalesce(p_locked, false));
end;
$$;

-- Removes a person from the room for good. Their client leaves at its next heartbeat and
-- join_room refuses them from then on.
create function public.remove_member(p_room uuid, p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.rooms r where r.id = p_room and r.host_uid = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if p_uid = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.room_members m set removed_at = now()
  where m.room_id = p_room and m.uid = p_uid and m.removed_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Hands the room to another person who has a seat in it.
create function public.transfer_host(p_room uuid, p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.rooms r where r.id = p_room and r.host_uid = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if not exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.uid = p_uid and m.removed_at is null and m.left_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  update public.rooms r set host_uid = p_uid where r.id = p_room;
  return jsonb_build_object('ok', true, 'host_uid', p_uid);
end;
$$;

-- Deletes the room with its members and snapshot.
create function public.delete_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  delete from public.rooms r where r.id = p_room and r.host_uid = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Snapshots (the room document as base64 text on the wire, bytea at rest)
-- ---------------------------------------------------------------------------------------------

create function public.save_snapshot(p_room uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_state bytea;
begin
  if not public.is_room_member(p_room) then
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
  insert into public.room_snapshots (room_id, state, updated_at, updated_by)
  values (p_room, v_state, now(), v_uid)
  on conflict (room_id) do update
    set state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  update public.rooms r set last_active_at = now()
  where r.id = p_room and r.last_active_at < now() - interval '5 minutes';
  return jsonb_build_object('ok', true);
end;
$$;

create function public.load_snapshot(p_room uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot public.room_snapshots;
begin
  if not public.is_room_member(p_room) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  select * into v_snapshot from public.room_snapshots s where s.room_id = p_room;
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
-- Retention: rooms idle for 30 days, old rate-limit rows, and anonymous users with no room
-- ---------------------------------------------------------------------------------------------

create function public.delete_idle_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rooms r where r.last_active_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  delete from public.room_events_rl e where e.at < now() - interval '1 day';
  delete from auth.users u
  where u.is_anonymous is true
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from public.room_members m where m.uid = u.id)
    and not exists (select 1 from public.rooms r where r.host_uid = u.id);
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what: signed-in people only; the helpers and the clean-up job are internal
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;
revoke execute on function public.create_room(text, text, text) from public, anon;
grant execute on function public.create_room(text, text, text) to authenticated;
revoke execute on function public.join_room(text, text) from public, anon;
grant execute on function public.join_room(text, text) to authenticated;
revoke execute on function public.touch_room(uuid) from public, anon;
grant execute on function public.touch_room(uuid) to authenticated;
revoke execute on function public.leave_room(uuid, text) from public, anon;
grant execute on function public.leave_room(uuid, text) to authenticated;
revoke execute on function public.set_room_locked(uuid, boolean) from public, anon;
grant execute on function public.set_room_locked(uuid, boolean) to authenticated;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
revoke execute on function public.transfer_host(uuid, uuid) from public, anon;
grant execute on function public.transfer_host(uuid, uuid) to authenticated;
revoke execute on function public.delete_room(uuid) from public, anon;
grant execute on function public.delete_room(uuid) to authenticated;
revoke execute on function public.save_snapshot(uuid, text) from public, anon;
grant execute on function public.save_snapshot(uuid, text) to authenticated;
revoke execute on function public.load_snapshot(uuid) from public, anon;
grant execute on function public.load_snapshot(uuid) to authenticated;

revoke execute on function public.rl_hit(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.clean_line(text, integer) from public, anon, authenticated;
revoke execute on function public.room_json(public.rooms) from public, anon, authenticated;
revoke execute on function public.delete_idle_rooms() from public, anon, authenticated;
