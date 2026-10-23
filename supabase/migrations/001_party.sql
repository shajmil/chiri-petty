-- Run once in the Supabase SQL editor, then enable anonymous Auth.
create table public.party_rooms (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  host_id uuid not null references auth.users(id),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create table public.party_members (
  room_code text not null references public.party_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 24),
  avatar integer not null default 0 check (avatar between 0 and 5),
  joined_at timestamptz not null default now(),
  primary key (room_code, user_id)
);
create index party_members_user on public.party_members(user_id);
alter table public.party_rooms enable row level security;
alter table public.party_members enable row level security;

grant usage on schema public to authenticated, service_role;
grant select on public.party_rooms, public.party_members to authenticated;
grant select, delete on public.party_rooms to service_role;

create function public.is_party_member(room_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from party_members m join party_rooms r on r.code = m.room_code
    where m.room_code = $1 and m.user_id = auth.uid() and r.expires_at > now());
$$;
create policy "Members read their room" on public.party_rooms for select to authenticated using (public.is_party_member(code));
create policy "Members read participants" on public.party_members for select to authenticated using (public.is_party_member(room_code));

create function public.party_time() returns double precision language sql stable as $$
  select extract(epoch from clock_timestamp()) * 1000;
$$;
revoke all on function public.party_time() from public, anon;
grant execute on function public.party_time() to authenticated;

create function public.create_party(room_code text, initial_state jsonb, player_name text, player_avatar integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if length(trim(player_name)) not between 1 and 24 then raise exception 'Choose a name from 1 to 24 characters'; end if;
  if (select count(*) from party_rooms where host_id = auth.uid() and expires_at > now()) >= 5 then raise exception 'Room creation limit reached'; end if;
  if initial_state->>'hostId' <> auth.uid()::text or initial_state->>'code' <> room_code or initial_state->>'phase' <> 'LOBBY' then raise exception 'Invalid initial state'; end if;
  insert into party_rooms(code, host_id, state) values (room_code, auth.uid(), initial_state);
  insert into party_members(room_code, user_id, name, avatar) values (room_code, auth.uid(), trim(player_name), player_avatar);
end;
$$;

create function public.join_party(room_code text, player_name text, player_avatar integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare selected_room party_rooms;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into selected_room from party_rooms where code = room_code and expires_at > now() for update;
  if not found then raise exception 'Room not found or expired'; end if;
  if not exists(select 1 from party_members m where m.room_code = $1 and user_id = auth.uid()) then
    if selected_room.state->>'phase' <> 'LOBBY' then raise exception 'Match started. Join the next one.'; end if;
    if (select count(*) from party_members m where m.room_code = $1) >= 8 then raise exception 'Room is full'; end if;
    insert into party_members(room_code, user_id, name, avatar) values ($1, auth.uid(), trim(player_name), player_avatar);
  end if;
  return selected_room.state;
end;
$$;

create function public.save_party(room_code text, new_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if new_state->>'code' <> room_code or new_state->>'hostId' <> auth.uid()::text then raise exception 'Invalid room coordinator'; end if;
  update party_rooms set state = new_state, updated_at = now()
    where code = room_code and host_id = auth.uid() and expires_at > now()
    and (new_state->>'revision')::bigint > (state->>'revision')::bigint;
  if not exists(select 1 from party_rooms where code = room_code and host_id = auth.uid() and expires_at > now()) then raise exception 'Room access denied'; end if;
end;
$$;

create function public.recover_party(room_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare selected_room party_rooms;
begin
  if not public.is_party_member(room_code) then raise exception 'Room access denied'; end if;
  select * into selected_room from party_rooms where code = room_code for update;
  if selected_room.host_id = auth.uid() then return auth.uid(); end if;
  if selected_room.updated_at > now() - interval '11 seconds' then return selected_room.host_id; end if;
  -- The first connected candidate to claim the locked row wins. Clients order candidates by join time.
  update party_rooms set host_id = auth.uid(), updated_at = now(),
    state = jsonb_set(jsonb_set(state, '{hostId}', to_jsonb(auth.uid()::text)), '{phase}', '"LOBBY"')
    where code = room_code;
  return auth.uid();
end;
$$;

revoke all on function public.create_party(text,jsonb,text,integer), public.join_party(text,text,integer), public.save_party(text,jsonb), public.recover_party(text), public.is_party_member(text) from public, anon;
grant execute on function public.create_party(text,jsonb,text,integer), public.join_party(text,text,integer), public.save_party(text,jsonb), public.recover_party(text), public.is_party_member(text) to authenticated;

create policy "Members receive room messages" on realtime.messages for select to authenticated
using (public.is_party_member(substring(realtime.topic() from 7)));
create policy "Members send room messages" on realtime.messages for insert to authenticated
with check (public.is_party_member(substring(realtime.topic() from 7)));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('party-recordings', 'party-recordings', false, 2097152, array['audio/webm','audio/mp4','audio/ogg'])
on conflict (id) do nothing;

create policy "Members upload only their own takes" on storage.objects for insert to authenticated
with check (
  bucket_id = 'party-recordings'
  and public.is_party_member((storage.foldername(name))[1])
  and (storage.filename(name) = auth.uid()::text || '.webm' or storage.filename(name) = auth.uid()::text || '.mp4')
  and array_length(storage.foldername(name), 1) = 3
);
create policy "Members hear private room takes" on storage.objects for select to authenticated
using (bucket_id = 'party-recordings' and public.is_party_member((storage.foldername(name))[1]));
create policy "Owners remove their takes" on storage.objects for delete to authenticated
using (bucket_id = 'party-recordings' and owner_id = auth.uid()::text);

create function public.expired_party_clips(room_code text) returns table(name text)
language sql stable security definer set search_path = public as $$
  select o.name from storage.objects o join party_rooms r on r.code = $1
  where r.expires_at < now() and o.bucket_id = 'party-recordings'
  and (storage.foldername(o.name))[1] = r.code;
$$;
revoke all on function public.expired_party_clips(text) from public, anon, authenticated;
grant execute on function public.expired_party_clips(text) to service_role;
