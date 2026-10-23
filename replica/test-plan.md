# Validation plan

Unit: scoring identical/altered/silent/clipped audio, phase deadlines, readiness, duplicate/late submissions, totals, wheel idempotency, multiplier consumption, shield and sabotage.

Browser: create/join in independent pages using same-browser test provider, ready/start, capture synthetic microphone through real MediaRecorder, upload/download test-provider blobs, sequential playback, scoring, wheel, final results and restart. Invalid codes, blocked microphone, non-submitting player and host loss must recover. Test 1440/768/390 layouts and keyboard controls.

Online integration requires Supabase URL/public key, migrated schema, anonymous auth enabled and configured private Realtime/Storage policies. Verify two independent browser contexts and actual phones on HTTPS, room isolation, late submissions and retention job. Never equate BroadcastChannel tests with cross-device verification.
