# Defects found during implementation

## Fixed

- Local tab room codes originally used hexadecimal UUID slices, which could include 0/1 while the join form excluded them. Both providers now use the same secure 32-character invitation alphabet.
- Match option labels included nested option text in their accessible names. Explicit accessible labels now identify the rounds and recording-window selectors.
- A submission arriving milliseconds after the recording deadline could be rejected while the host was still in RECORDING, before its next timer tick changed to SUBMISSION_LOCK. The submission validator now recognizes the same absolute 12-second upload grace window in both phases. The phase transition extends the existing deadline, rather than calculating a fresh grace window from a delayed tick. Boundary regression assertions cover the gap and the final cutoff.
- The reward stage unnecessarily waited for the full timer after every connected player spun. It now advances after all spins and at least four seconds for wheel animation.
- Host recovery could choose a stale participant. Every client now observes peer heartbeats and excludes candidates that have stopped sending them.
- Deprecated Three.js PCFSoftShadowMap usage was replaced with PCFShadowMap after the actual browser warning.

## Verification limits

- No Supabase project configuration was supplied. Private-channel policies, storage authorization, transactional recovery and scheduled deletion are implemented but not executed against a live project.
- Browser tests use synthetic microphone capture. Physical microphones, iOS Safari and real mobile-network timing still need verification.
- Local scoring, audio metadata and host state can be manipulated by an authorized modified client. This is an explicit prototype design limit, not a claim of secure competitive scoring.
