# Backend-light architecture

Next.js static export, React HUD, strict TypeScript, Three.js Stage and Web Audio AudioManager. Node is build/dev tooling only. The deployed out/ folder requires HTTPS static hosting. No custom backend or server functions.

Small RealtimeProvider interface. SupabaseProvider uses anonymous auth, membership-checked private realtime channels, room snapshots and private storage. A BroadcastChannel provider supports explicitly labeled same-browser tab testing; it cannot connect separate devices. Online mode never silently falls back to local tabs.

Host-authoritative Game coordinates LOBBY → ANNOUNCING → LISTENING → RECORDING → SUBMISSION_LOCK → PLAYBACK → SCORING → REWARD_WHEEL → NEXT_ROUND → FINISHED. Events include unique IDs, room/match/round identity, sender ID and protocol version. Snapshots have monotonic revisions. Each submission has one deterministic round/player key. Host enforces deadline and membership; a modified host or locally fabricated score can cheat.

Shared clock: use database server timestamp for online clock offset; host absolute deadlines with countdown lead. This bounds normal network jitter but is not sample-accurate synchronization. Host snapshots persist phase/deadlines; periodic heartbeat detects loss. Recovery returns an interrupted match to lobby under the elected connected player, preserving no partial competitive result. Avoid unsafe continuation of half-played rounds. Rejoining players request a fresh snapshot.

Audio is captured with MediaRecorder, decoded locally, scored against bundled WAVs, and uploaded over HTTPS to private Storage, never realtime messages. Storage paths room/match/round/user.webm or .mp4. Authenticated members download through SDK; practice audio stays in memory, while the local tab provider uses IndexedDB. SQL policies enforce membership and ownership. Limit 2 MB; configured bucket MIME allowlist. Clients cannot securely validate file signatures against hostile uploads: document that prototype limitation. Room access expires after 24 hours. Physical deletion requires deploying and scheduling the supplied managed cleanup function; no cleanup schedule was deployed in this local build.

LocalAudioScorer extracts normalized energy envelope, duration, pitch contour, onset count/timing and spectral characteristics. Reliability gates silence/clipping/too-short data. Configurable category weights. Scores are approximate acoustic resemblance, never semantic, humor or trained-AI judgments.

Setup requires a user-owned Supabase project. Never put service-role credentials in the client. Without configured infrastructure, the UI provides honest setup guidance, solo microphone practice and a same-browser test mode.
