# Validation and delivery status

Date: 2026-10-23. Local source: C:/shajmil/chiri-party.

## Executed checks

- `npm.cmd run typecheck`: passed with strict TypeScript.
- `npm.cmd test`: 8/8 passed. Covers readiness, duplicate/late/wrong-player/wrong-round submissions, the recording-to-upload deadline race, idempotent round points and rewards, multiplier consumption, sabotage, shields, identical audio, amplitude normalization, silence, invalid/short samples, clipping and dialogue limitations.
- `npm.cmd run build`: passed. All routes are statically prerendered; output is out/. No custom application server or API route is required.
- Production browser command: `PARTY_BASE_URL=http://localhost:3002 npm run test:e2e` (PowerShell uses `$env:PARTY_BASE_URL = 'http://localhost:3002'`). **6/6 passed in 3.1 minutes** against the exported static app served by a temporary static preview server.

Browser checks used installed Microsoft Edge, two pages sharing a browser context for the explicitly local BroadcastChannel/IndexedDB transport, and fake microphone hardware playing a bundled WAV. They exercised real MediaRecorder capture, Web Audio decoding/scoring, local blob transfer, ordered playback, two complete rounds, wheel spins, synchronized final totals, restart, host-loss recovery, invalid invitations, microphone denial, upload failure and a connected player who never submits. The final suite captures no uncaught page errors in the successful complete match.

One earlier suite failed at a real deadline race. It was fixed and the complete final suite passed. A diagnostic run also passed, but that earlier single run was not treated as sufficient verification. See bug-report.md.

## Visual checks

The skill's real-browser inspector ran against the static export at 1440×900, 768×1024 and 390×844. **0 FAIL, 2 WARN**. All six final screenshot sheets were opened. The warnings are defended in design-review.md: the optional packs extend below the first desktop fold, and 32px Malayalam phone type preserves legibility. Anek Malayalam is an explicit font exception to the initially dealt Inter face.

Source design lint: **0 FAIL**. Its warnings concern a shadow on a real floating notification, which is permitted, and the AudioManager method name `unlock`, which is code rather than promotional copy.

Screenshots: .taste-skill/home-1440.png, home-768.png, home-390.png, lobby-desktop.png, results-desktop.png and inspect/.

## Milestone status

| Milestone | Implemented files | Verified status | Remaining work |
| --- | --- | --- | --- |
| Research and architecture | replica/recon.md, kochi-study.md, architecture.md, implementation-plan.md, features.csv | Read source project and workflow files; inspected public reference and official managed-service docs | Live reference multiplayer could not be verified; it is an independent requirement |
| Room foundation | src/network/, src/game/Game.ts, supabase/migrations/001_party.sql | Local create/join, ready, host controls and recovery pass browser tests | Execute schema and verify private online channels in a user-owned project |
| Audio gameplay | src/core/AudioManager.ts, Game.ts | Real browser capture, decode, transfer and sequential playback pass with synthetic input | Verify real microphones and private Supabase Storage |
| Local scoring | src/core/LocalAudioScorer.ts, tests/scorer.test.ts | Unit and browser comparisons pass; invalid takes are handled | Not trained AI; no semantic/humor judgment or cheat resistance |
| Rewards and sabotage | src/game/rules.ts, ui/Party.tsx | Wheel changes totals in complete matches; echo/shield/multiplier rules pass unit checks | No claim of perceptually verified echo sound on physical speakers |
| Malayalam content and visuals | src/game/prompts.ts, public/audio/, src/world/Stage.ts, src/ui/, app/globals.css | 16 bundled WAVs, original stage, three viewport checks pass | Dialogue uses synthesized rhythm guides; natural authorized recordings can be added |
| Delivery | README.md, .env.example, tests/, out/, supabase/functions/cleanup-recordings/ | Local source, static build and automated test suite delivered | Supabase deployment, scheduled retention, HTTPS public hosting and physical-device QA |

## Explicit limits

No Supabase project URL/key was supplied. The online provider, SQL policies and managed cleanup function were prepared but **not run against a live Supabase project**. Separate-device internet play is therefore **implemented but not verified**, and the online release acceptance criterion remains open. Local tab tests are not represented as cross-device tests.

No physical phones, iOS Safari or human-recorded microphone quality were tested. There is no continuous voice chat. Scores and host-coordinated outcomes can be manipulated by modified clients. Bucket size/MIME policies are not trusted file-signature analysis. Room expiry denies access after 24 hours; physical deletion depends on enabling the supplied managed cleanup schedule.

No public site was published. Next.js is used as local/build tooling and the delivered out/ folder is static. Start the app with the README instructions, or configure Supabase and deploy out/ over HTTPS to test separate devices.

## Recorded audio replacement ? 2026-10-23
Replaced all 12 playable synthesized effects with CC0 recorded excerpts. Dialogue tones excluded from playable decks until speech is available. Ten tests pass, including exact asset duration, clipping headroom, self-match and silence rejection across all recordings. Static build passes. Edge decoded and played every bundled recorded WAV through an AudioContext/analyser; all 12 produced a nonzero playback signal. This is automated signal verification, not a human listening evaluation or physical-speaker quality claim. Sources and license records: public/audio/recorded/CREDITS.json.

## Malayalam movie voices: Mimicry pack and room clips · 2026-10-23

Research: Mimic Party sources ~195 of 200 clips from GitHub soundboards whose code licences do not cover the audio. Myinstants (81 Malayalam results) and Voicemod Tuna host uploader-ripped film clips; both sites' terms restrict use to personal, non-commercial use and forbid redistribution. Decision (user): public game, both routes.

Built: original Mimicry script (src/game/mimicry.json, 18 lines) and scripts/import-mimicry.mjs; "Your clips" pack with browser trimming, WAV re-encoding, host-only lobby upload, 12-clip limit, 0.5–6 s length and a per-clip rights confirmation; migration 003_room_clips.sql.

Executed: typecheck passed; unit tests 13/13 passed (adds room-clip validation and Mimicry script integrity); browser suite 7/7 passed in Edge tab mode, including a new test where the host uploads a clip, the friend sees it, both play a round on it and receive numeric scores. Import script dry-run in a scratch folder converted one OGG and one WAV take and skipped lines without takes. Clip panel screenshots checked at 1440 and 390 px; no horizontal overflow.

Not executed: migration 003 has not been applied to the live Supabase project, so online clip upload is unverified. No Mimicry lines are recorded yet, so the pack still plays only the three Commons words.

## Interactive stage, emotes, tomatoes and Commons sounds · 2026-10-23

Requested: reuse the Mimic Party clip list; make playback interactive (each performer's character comes to the mic, emotes, dance, rotten tomatoes, score shown after each performance).

Sounds: the 11 Wikimedia Commons entries from that list were imported by scripts/import-commons.mjs after an API licence check (Wilhelm Scream CC0; Scream-c/d/e, wagtail, munia and five German "Roboter" words CC BY-SA 4.0). The ~185 GitHub soundboard entries were not bundled: the repositories' Apache/MIT licences cover code, and the clips come from films, games and commercial products. Hosts can use such clips privately through "Your clips".

Built: jointed Three.js characters in each player's avatar colour with name labels; distance-driven walk cycle (step length from leg length and swing, so feet do not slide), acceleration and braking, delta-time movement; performer walks to the mic, take starts on arrival (playbackStartAt), score revealed for 3.5 s; round winner takes the mic during scoring; host-validated emotes, dance and tomatoes (0.6 s per-player rate limit, 30-event history, broadcast without a database save); tomato arc and face splats; shared wheel results; awards for best round, crowd favourite and tomato magnet.

Executed: typecheck passed; unit tests 16/16 passed; Edge browser suite 8/8 passed in 6.0 minutes, including a new test where a friend throws a tomato and laughs during the host's performance, both screens show the counts, the score appears before the next performer, tomato controls appear only for watchers, both spins are listed and the final awards are correct. An earlier full run had 3 failures: two from editing a source file mid-run (hot reload) and one from test helpers typing a name before React hydrated (the shared tab profile's saved name replaced it). The helpers now wait for the page to settle; the rerun passed. Stage screenshots with three players were inspected at 1440 and 390 px; no page errors.

Not verified: real phones, real microphones, online Supabase rooms with these new state fields, and how tomato/emote bursts behave under real network latency.

## Sound library replaced with the Mimic Party clip list · 2026-10-23

User instruction: remove all existing clips and use the supplied list (GitHub meme soundboards plus Wikimedia Commons) for the public game. Licensing risk was raised twice beforehand; the user chose to proceed.

Removed: 12 Freesound CC0 recordings, 3 Malayalam Commons words, the 11-file Commons folder (re-imported into the new library), 16 legacy synthesized WAVs, their manifests and their import/generator scripts. The legacy crow WAV is kept only as the browser-test microphone input (tests/fixtures/fake-mic.wav).

Built: scripts/import-library.mjs with one table of 195 clips (world, cue phrase, difficulty, source path), 191 imported; 4 left out for explicit language or drug references. GitHub files are fetched through the jsDelivr mirror (the GitHub API was rate-limited); every path is checked before download. Output: mono 22.05 kHz WAV, silence trimmed, at most 4.5 s, peak-normalized; 19 MB total. library.json and CREDITS.json record source repository/path, declared repository licence and SHA-256 hashes. Sources: 3kh0/soundboard 107 (Apache-2.0 file), jimmytop/soundmachine 33 (MIT), PareekshithPalat 22 (MIT), evansuong 10 (no licence file), EmanuelJrc 4 (MIT), Fazalhasann 3 (no licence file), bytevictor 1 (GPL), Wikimedia Commons 11 (CC0/CC BY-SA 4.0). Packs are now the ten sound worlds plus Full chaos and Your clips; Mimicry stays hidden until recorded. Prompt.malayalam was renamed to cue, and difficulty was added.

Executed: typecheck passed; unit tests 17/17 (new test checks all 191 clips' hashes, durations, peak range, sources, worlds and self-match scores). Pack picker and library (191 rows, Listen plays) screenshot-checked at 1440 and 390 px with no page errors or horizontal overflow.
- Browser suite: 8/8 passed in 6.5 minutes in Edge (tab mode), using the new library. Static build passed; out/audio contains only library/ (191 WAVs + CREDITS.json).

## Worlds trimmed; Malayalam Movie Memes world · 2026-10-23

Removed at the user's request: Comedy Cuts, Cosmic Radio and Game Day (57 clips and WAVs). Library now 134 clips in seven worlds.

Added a Malayalam Movie Memes world (first in the picker) with the ten Myinstants clips the user listed. Myinstants' terms forbid downloading and redistributing its sounds, and no GitHub mirror of these clips was found, so the import script does not fetch them: it reads files the owner saves to malayalam-memes/<id>.mp3, converts them like every other clip and credits the Myinstants page. Cue text uses the Myinstants titles rather than unverified dialogue. The world stays hidden until a file exists. Verified in a scratch copy: a dropped file was converted, filed under the world and credited.

Executed: typecheck passed; unit tests 17/17.

## Wheel and sabotage removed; clip-length takes, karaoke lyrics, character looks · 2026-10-23

User decisions: remove the reward wheel and all sabotage (echo, shield, double, bonus points); each take as long as its clip; show lyrics with timing while recording; give each character its own look; make recording more interactive. Reference: Mimic Party screenshots supplied by the user.

Built: phase REWARD_WHEEL, rewards, multipliers, shields, echo tokens, echo playback effect and the sabotage picker removed (rules, Game, AudioManager, UI, CSS, tests). Round points = take score. Recording window = clip length + 0.5 s (room.recordSeconds per round); the lobby setting is replaced by a note; practice uses the same rule. Karaoke lyrics (src/game/lyrics.ts, LyricsTrack) light up across the loud part of the reference during listening (timed from when this device started the reference), recording (from recordAt) and each performance. Count-in shows 3-2-1 with beeps that end before recording. Recording panel shows REC, elapsed/total time and a mic meter; the voice shape has a playhead and draws the live take under the reference. Score card shows feature bars and confidence. Six character looks (hair style/colour, skin, outfit detail, trousers/shoes, glasses, moustache) shared by the 3D stage and the 2D face icons.

Executed so far: typecheck passed; unit tests 20/20 (new: lyric splitting/timing, points without multipliers, recording window). Six-player round screenshots inspected at 1440 and 390 px with no page errors; an overlap of the cue stack on the cast was fixed by compacting the challenge card and removing the in-round credits footnote.

## Laptop layout and mandatory mic check · 2026-10-23

User request (with laptop screenshots): better layout on laptop screens; a mandatory mic check with an easy sample before starting.

Built: from 900 px wide, rounds use a one-screen layout (main.match-view): slim heading, 230 px player column, stage canvas ending above the reaction bar and voice shape, count-in centred over the empty mic spot, score card and round score list docked on the right, footer hidden. The stage camera aims higher during rounds (setRoundFraming) so the cast sits below the text. Mic check (src/ui/MicCheck.tsx): sample "I like turtles!" with karaoke lyrics, 3-2-1 beeps, one take of clip length + 0.5 s; passes only when the take can be scored; ready-up is blocked until passed once per visit.

Executed: typecheck passed; unit tests 20/20. Laptop screenshots at 1366x768 with four players: no page scroll during the round, no page errors; mic check, count-in, recording, score card and scoring list inspected. Fixed during inspection: bottom bar floating mid-panel (margin override), count-in fade made shorter.
- Browser suite 9/9 passed in 7.0 minutes (Edge, tab mode), including the new mandatory mic-check test (closing leaves you unready; a silent mic fails). Static build passed.

## Malayalam pack and compact stage ? 2026-10-23

- Imported all ten requested Malayalam MP3s; 144 normalized library WAVs on disk, 131 playable references after excluding 13 Music clips.
- `npm.cmd test`: 20/20 passed, including WAV metadata, peaks, hashes, scoring and pack filtering.
- Production static build passed.
- Edge browser: full two-player, two-round match passed with synthetic microphone capture and local tab transport.
- Practice dialog opens from the fixed home action and fits without scrolling at 1366?768 and 390?844. Screenshots: `.taste-skill/mic-1366.png`, `.taste-skill/mic-390.png`.
- These checks do not establish perceived sound quality on physical microphones or remote-device Supabase behavior.
- Quick mic check: synthetic recording completed; Hear my recording and Record again were available and playback was invoked. Result dialog measured 571px tall with no internal overflow at 1366�768.
