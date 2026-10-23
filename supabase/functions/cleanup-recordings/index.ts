// Runs in Supabase's managed Deno environment, never in the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async request => {
  const suppliedSecret = request.headers.get('x-cleanup-secret');
  if (request.method !== 'POST' || !suppliedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: authorized, error: authorizationError } = await client.rpc('verify_cleanup_secret', { candidate: suppliedSecret });
  if (authorizationError || !authorized) return new Response('Unauthorized', { status: 401 });
  const { data: expiredRooms, error } = await client.from('party_rooms').select('code').lt('expires_at', new Date().toISOString()).limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let deletedRooms = 0;
  for (const room of expiredRooms ?? []) {
    while (true) {
    const { data: clips, error: listingError } = await client.rpc('expired_party_clips', { room_code: room.code });
    if (listingError) return Response.json({ error: listingError.message }, { status: 500 });
    const paths = (clips ?? []).map((clip: { name: string }) => clip.name);
    if (paths.length === 0) break;
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error: removalError } = await client.storage.from('party-recordings').remove(paths.slice(offset, offset + 100));
      if (removalError) return Response.json({ error: removalError.message }, { status: 500 });
    }
    }
    const { error: roomError } = await client.from('party_rooms').delete().eq('code', room.code);
    if (roomError) return Response.json({ error: roomError.message }, { status: 500 });
    deletedRooms++;
  }
  return Response.json({ deletedRooms });
});
