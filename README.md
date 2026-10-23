# Chiri Party · ചിരി പാർട്ടി

A browser voice party for 2–8 friends. Built with **Next.js static export, TypeScript, Three.js, Web Audio and Supabase**. There is no custom Node.js backend, API route, AI service or application server. Node.js is used for development and building, as Vite is in the studied Kochi project.

## Run locally

Requires Node 22.12+ (Node 24 recommended).

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:3001**. On Windows, `npm.cmd` works when PowerShell blocks `npm.ps1`. `npm` works normally in other shells.

Without Supabase, use **Try the microphone first** for solo recording/scoring, or choose **Local tab test** under Room connection. Create a room in one tab, open another tab in the same browser profile, join with the code, enable microphones and ready both players. The host can then start a complete match. Tab mode uses BroadcastChannel plus IndexedDB for audio; it does **not** connect other devices or browser profiles.

## Online rooms on separate devices

1. Create a Supabase project. In Authentication → Providers, enable anonymous sign-ins. For a public launch, configure abuse controls/CAPTCHA appropriate to the project; the prototype uses Supabase's configured anonymous-auth rate limits.
2. Run `supabase/migrations/001_party.sql` in the SQL editor once. It creates room/member tables, transactional room creation/join/recovery functions, member-only Realtime policies and a private 2 MB recording bucket. Then run `supabase/migrations/003_room_clips.sql` so hosts can upload room clips.
3. In Realtime settings, **disable public channel access**. The app joins private `party:CODE` channels.
4. Copy `.env.example` to `.env.local` and enter the project's URL and public publishable/anon key:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-public-publishable-or-anon-key
```

Never put a service-role key in a `NEXT_PUBLIC_` variable or send it to the browser. These two public variables are embedded at build time; rebuild after changing them.

5. Restart development or build/deploy the static app. Each friend opens the HTTPS site in their own browser/device, enters a name, and creates/joins a room. Online identity is per browser profile. To simulate separate people on one computer, use separate browser profiles/private contexts.
6. Enable the recording retention job below before using real players' recordings.

No Supabase credentials are included. Live cross-device behavior and the SQL policies must be tested against your configured project before describing this as a verified online release.

## Recording retention

Rooms expire after **24 hours**, after which SQL policies deny access to their recordings. This is separate from physically deleting the files.

The managed Edge Function deletes expired recordings through the Storage API before deleting expired rooms. Migration 002_party_cleanup_schedule.sql configures an hourly Cron job (0 * * * *) and generates a private secret in Supabase Vault. The function checks the x-cleanup-secret header using the service-role-only verify_cleanup_secret RPC. No cleanup secret is stored in browser code or source files. JWT gateway verification is disabled because the function performs this authentication itself. Supabase supplies its URL and service-role key in the function environment.

Deployed to project dvzovsjneyrsoypiqrtl on 2026-10-23. The hourly job is active. Physical deletion occurs at the next successful cleanup after 24-hour expiry, normally within 24–25 hours; failed jobs require monitoring/retry. The schedule migration contains this project's function URL; change it when deploying elsewhere.

Local tab recordings persist in IndexedDB until **Clear local test recordings** in Rules, scoring & privacy or browser site-data deletion. Practice recordings stay in memory. No microphone stream is sent through Realtime and there is no continuous voice chat.

## Game rules and protocol

- 2–8 players. Host selects 2–5 rounds and a pack. Everyone must ready up. Before a player's first ready-up in a visit they must pass a quick mic check: an easy sample ("I like turtles!") plays with karaoke lyrics, a 3-2-1 count-in follows, and one take is recorded; it passes only if the take can be scored (not silent or too quiet). Closing the check or failing it leaves the player unready. Each take is as long as its clip plus half a second (a 1.0 s clip gives a 1.5 s take); there is no fixed recording-window setting.
- `LOBBY → ANNOUNCING → LISTENING → RECORDING → SUBMISSION_LOCK → PLAYBACK → SCORING → NEXT_ROUND → FINISHED`. There is no reward wheel or sabotage.
- Recording starts after a three-second countdown at the shared absolute timestamp. Online clients estimate clock offset from a database timestamp. Network/device scheduling can introduce skew; this is not sample-accurate synchronized audio.
- MediaRecorder captures once per round. Web Audio decodes the take and compares it locally; the short compressed file uploads separately over HTTPS. A 12-second upload grace period prevents a slow/non-submitting player from deadlocking a match.
- Versioned envelopes carry UUID event IDs, room, sender, match, round, timestamp and command/snapshot. The host deduplicates commands and enforces phase, round identity, player identity, path, score range and deadlines. Snapshots use increasing revisions; database saves reject older revisions.
- Playback follows the original player order, one take at a time. Each performer's character walks to the mic (1.8 s), their take plays when they arrive, then their score is revealed for 3.5 s before the next performer walks up. Slow downloads skip ahead rather than overlapping later performances. Autoplay restrictions may require tapping the audio-resume control.
- Every player has a stage character in their avatar colour with one of six looks (hair style and colour, skin tone, outfit detail, glasses or moustache) that matches their face icon, with their name above it and a lime ring under your own. While scores are shown, the round's top scorer takes the mic.
- Anyone can send emotes (😂 🔥 👏 😱 🤦 ❤️) or dance, in the lobby and during rounds. During someone else's performance you can throw a 🍅 tomato, which flies across the stage and splats on the performer. The host accepts at most one reaction per player every 0.6 s and keeps the last 30. Only a watcher's first 😂 and first 🍅 per performance count toward the end-of-match awards (crowd favourite, tomato magnet). Tomatoes are for fun and do not change scores.
- While the clip plays and while you record, its cue is shown as karaoke lyrics that light up in time with the loud parts of the reference (there is no word-level timing, so pieces are spread across the sound by length). A playhead runs across the reference waveform and your take is drawn underneath as you record. The count-in shows 3-2-1 with a beep each second; the beeps end before recording starts. Recording shows a REC panel with elapsed time and a mic meter. After each performance the score card shows Timing, Melody, Energy, Texture and Length bars and a confidence level.
- Round points equal the take's score (0–100) and are awarded once per round.
- The host emits heartbeats/snapshots. After 12 seconds of silence, connected candidates are ordered by join time then ID; the first connected candidate claims coordination transactionally. A disrupted match returns to the lobby to restart safely. It does not attempt to reconstruct half-played audio. A reconnecting client receives fresh snapshots. Refreshing a tab-test page creates a new guest; online refresh retains the Supabase guest identity.

This is a **host-coordinated prototype**. A modified host can cheat; clients can fabricate locally calculated scores or spoof protocol metadata within an authorized room. Realtime authorization and private Storage protect room access, not tournament integrity. Bucket MIME/size constraints do not provide trusted file-signature or duration analysis. There is no claim of secure competition or trained-AI scoring.

## Sound and scoring

The sound library is the clip list in `scripts/import-library.mjs`: meme clips from public GitHub soundboards (3kh0/soundboard, PareekshithPalat/IDE-Error-Soundboard, evansuong/Meme-Soundboard-Webpage, Fazalhasann/Fazals-Meme-SoundBoard, bytevictor/FAAAAH-meme-sound-multiplatform, jimmytop/soundmachine, EmanuelJrc/WeeBoard) eleven Wikimedia Commons sounds, and Malayalam movie meme clips saved locally by the project owner. The playable library has seven sound worlds: Malayalam Movie Memes, Meme Classics, Viral Reactions, Cartoon Chaos, Daily Drama, Wild Calls and Machine Room. Music is excluded from pack selection and mixed rounds. Four clips with explicit language or drug references are left out for a family audience; they are named in a comment in the script.

Run `node scripts/import-library.mjs` to rebuild it (needs network access and Edge or BROWSER_PATH). It fetches GitHub files through the jsDelivr mirror, checks every path exists before downloading, trims silence, cuts each clip to at most 4.5 seconds, converts to mono 22.05 kHz WAV and peak-normalizes. `src/game/library.json` and `public/audio/library/CREDITS.json` record each clip's world, cue, source repository and path, the licence that repository declares, and the source and final SHA-256 hashes. Existing files are reused, so a run interrupted by rate limits can be repeated.

**Malayalam Movie Memes.** All ten requested clips are imported from the supplied Myinstants download pages: Avante Montha, Ayyo Enta Amma Damu, Namaskaar Damu, Basil Joseph Laugh, Thorappa, Manasilayo, Malayalam Actor Lal, Aadu 2 Enganeadauve, Perfect OK, and Damu Angane Paranjooda. Local MP3s live in `malayalam-memes/`; run `node scripts/import-library.mjs` to regenerate their normalized WAVs. The importer itself reads these files locally. Source-page attribution records provenance, not verified redistribution permission. Music assets remain on disk but are excluded from the 131 playable references.

**Licensing risk.** A repository's MIT or Apache licence covers what its authors own. Many of these clips come from films, games, TV and commercial products whose owners have not licensed them here, so a public release can receive takedown requests. To remove a clip, delete its line from the list in the script, delete its WAV and run the script again.

### Malayalam movie-style voices

Movie and meme clips from sites such as Myinstants or Voicemod Tuna are film rips without a licence, and those sites' terms allow only personal, non-commercial use. They are **not bundled**. Chiri Party offers two routes instead:

1. **Original Mimicry pack (ships with the game).** src/game/mimicry.json holds 18 original meme-style lines (Ayyooo!, Shivaneee!, Manasilaayo?, Kunjimone…) with Malayalam script, meaning and delivery notes. A line becomes playable only after a real performance is imported:
   1. Record each line with any voice recorder. Keep each take short (under 4.5 seconds) and match the delivery note.
   2. Save it as `mimicry-takes/<id>.wav|mp3|m4a|ogg|webm`, for example `mimicry-takes/mm-ayyo.m4a`. The folder is git-ignored.
   3. Run `node scripts/import-mimicry.mjs`. It trims silence, normalizes and writes `public/audio/mimicry/<id>.wav`, then records the duration in mimicry.json.
   Only record performances the project owns, such as your own voice or a performer who agreed in writing. Do not use AI voice clones of actors.
2. **Your clips (private rooms).** The host picks the "Your clips" pack, chooses any audio file, trims up to 6 seconds, types what players should say and confirms they have the right to use it. The browser re-encodes just that part as a WAV and uploads it to the room's private storage path `ROOMCODE/custom/`. Only room members can play it, and it is deleted with the room. Online rooms need `supabase/migrations/003_room_clips.sql`. Clips can be added only in the lobby, up to 12 per room.

Scoring is an approximate local comparison of duration, energy, pitch contour, onsets and texture. It does not understand words or judge humor. Automated checks establish file decoding and playback signal, not perceived sound quality on every device.

## Project layout

```text
app/                       Static Next shell and shared styles
src/game/Game.ts           Host-coordinated game loop and deadlines
src/game/rules.ts          Submission, scoring totals, reward and sabotage rules
src/game/prompts.ts        Pack content and configurable brand
src/game/mimicry.json      Original Mimicry pack script (playable once recorded)
src/ui/CustomClips.tsx     Host clip upload and trimming for private rooms
src/core/AudioManager.ts   Microphone, recording, playback and count-in beeps
src/core/LocalAudioScorer.ts Browser acoustic features and comparison
src/world/Stage.ts         Three.js stage: cast, walking to the mic, emotes, dances, tomatoes
src/world/Character.ts     Jointed player characters (six looks), name labels and emote sprites
src/game/lyrics.ts         Splits a cue into karaoke pieces and times them to the reference
src/ui/LyricsTrack.tsx     Karaoke cue display
src/ui/MicCheck.tsx        Mandatory sample mic test before ready-up
src/ui/ReactionBar.tsx     Emote, dance and tomato buttons
src/network/               Small provider contract implementations
src/ui/                    React HUD, room controls and accessible dialogs
public/audio/              Original reference WAVs
replica/                   Research, Kochi study, architecture and validation
supabase/                  Schema, policies and managed retention function
tests/                     Rule/scorer tests and browser flows
```

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
# In another terminal, with the dev server running:
npm.cmd run test:e2e
npm.cmd run build
```

Browser tests use installed Microsoft Edge on Windows, real MediaRecorder with a synthetic microphone input, and the same-browser tab provider. Override `BROWSER_PATH` for another installed Chromium executable. They are not evidence of physical-device microphone quality or verified Supabase integration. See `replica/validation.md` for actual results and limits.

## Static deployment

`npm.cmd run build` emits **out/**. Deploy that folder to an HTTPS static host such as Cloudflare Pages, Netlify or static Vercel hosting. No runtime Next.js server is required. Set the public Supabase configuration before the build. HTTPS is required for microphones on phones; an HTTP LAN address is not a supported microphone origin. Localhost is allowed for local testing.

This source was prepared locally in `C:/shajmil/chiri-party`. No public deployment is implied by a localhost URL.

### Compact stage and microphone controls

The home microphone button stays fixed on hover and press. Mic dialogs use a compact responsive layout; device selection carries through into the game. Quick mic check supports listening back and recording again. Face selection updates the stage performer, and recording moves the camera toward your own character. Emotes sit below Voice Shape. Score details are expandable; the standings show names and totals without repeated technical explanations.
