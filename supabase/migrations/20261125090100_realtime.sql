-- Private Realtime channels: only people with a seat in a room may receive or send on its
-- channel `room:{room id}`. The app opens the channel with `private: true`.
-- (Turn off "Allow public access" in the project's Realtime settings so that public channels
-- cannot be used at all.)

create function public.can_use_room_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_room_member(substring(p_topic from 6)::uuid)
    else false
  end;
$$;

revoke execute on function public.can_use_room_topic(text) from public, anon;
grant execute on function public.can_use_room_topic(text) to authenticated;

create policy "room members receive on their room channel"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_use_room_topic((select realtime.topic()))
);

create policy "room members send on their room channel"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.can_use_room_topic((select realtime.topic()))
);
