-- Room clips: the host uploads short WAV references that only members of that room can hear.
-- Path: ROOMCODE/custom/<host user id>-<8 hex>.wav. The existing select policy already
-- limits reads to room members, and the cleanup job deletes everything under ROOMCODE/.
update storage.buckets
set allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']
where id = 'party-recordings';

create policy "Hosts add room clips" on storage.objects for insert to authenticated
with check (
  bucket_id = 'party-recordings'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'custom'
  and storage.filename(name) ~ ('^' || auth.uid()::text || '-[a-f0-9]{8}\.wav$')
  and exists (
    select 1 from public.party_rooms r
    where r.code = (storage.foldername(name))[1]
      and r.host_id = auth.uid()
      and r.expires_at > now()
  )
);
