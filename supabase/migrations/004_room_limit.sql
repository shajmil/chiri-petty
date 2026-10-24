-- Run once in the Supabase SQL editor after 001_party.sql.
-- The room limit used to count every unexpired room a guest had created, so after five rooms
-- in 24 hours (leaving a room does not close it) that browser could not create another.
-- A host saves their room every few seconds while it is open, so only rooms saved in the last
-- minute are counted now: the rooms a guest is really hosting, plus any they just created.
create or replace function public.create_party(room_code text, initial_state jsonb, player_name text, player_avatar integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if length(trim(player_name)) not between 1 and 24 then raise exception 'Choose a name from 1 to 24 characters'; end if;
  if (select count(*) from party_rooms
      where host_id = auth.uid() and expires_at > now() and updated_at > now() - interval '1 minute') >= 5
    then raise exception 'You already have 5 rooms open. Close one or wait a minute, then try again.'; end if;
  if initial_state->>'hostId' <> auth.uid()::text or initial_state->>'code' <> room_code or initial_state->>'phase' <> 'LOBBY' then raise exception 'Invalid initial state'; end if;
  insert into party_rooms(code, host_id, state) values (room_code, auth.uid(), initial_state);
  insert into party_members(room_code, user_id, name, avatar) values (room_code, auth.uid(), trim(player_name), player_avatar);
end;
$$;
