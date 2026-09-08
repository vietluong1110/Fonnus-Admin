# ADR 0004: Recording access — the browser plays `call.wav` straight from the bucket

**Status:** accepted · **Date:** 2026-09-08

## Decision

- **The bucket key is an optional group in `src/config.ts`.** `readConfig` reads the five
  `S3_*` keys of `.env.example` (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`) as one optional value `artifactStore`: all five set → the value;
  none set → `undefined` and every recording surface renders "recording access not
  configured"; some but not all set → `readConfig` throws naming the missing keys, the way a
  missing `DATABASE_URL` throws today. A half-configured group is a typo, and a typo must
  fail at start, never degrade into "not configured".
- **One module knows the bucket: `src/artifacts.ts`.** It holds (1) the archived predicate,
  copied from `../Fonnus/app/src/persistence/call-queries.ts:180-203` and pinned by a test —
  `artifact_state = 'archived' OR (artifact_state = 'expired' AND artifact_key_prefix IS NOT
  NULL)` — as `isFetchable(state, prefix)`; (2) the key `${artifact_key_prefix}/call.wav`
  (contract §6); (3) `recordingAccess(call, config)`, the one function that turns a call row
  plus the config into the state a screen renders — `not_configured` (no `S3_*`),
  `not_archived` (`spooled`, `failed`, NULL, or an unknown `artifact_state`), `gone`
  (`expired` with a null prefix), `withheld` (the consent gate of ADR 0005 says no),
  `playable`; and (4) `presignCallWav(prefix)` — `getSignedUrl(client, new GetObjectCommand({
  Bucket, Key }), { expiresIn: 900 })` from `@aws-sdk/s3-request-presigner` over one lazily
  built `S3Client` cached on `globalThis` like the `pg` pool (`src/db.ts`), so dev reloads do
  not stack clients.
- **The audio element points at a route of this app, which redirects to the presigned URL.**
  `<audio src="/calls/<id>/recording">`; `GET src/app/calls/[id]/recording/route.ts` reads
  the call row, runs `recordingAccess`, and answers `302` to a fresh presigned GET when the
  state is `playable`, `503` for `not_configured`, `404` for `not_archived` / `gone`, `403`
  for `withheld`, all with `Cache-Control: no-store`. The bytes flow bucket → browser; this
  app never proxies them and never fetches them itself.
- **Presign expiry is 900 s** (the SDK's own default, named as a constant), counted from
  the redirect, not from the page render. The route is re-asked whenever the element
  (re)loads its source; a browser that followed the redirect once keeps the presigned URL
  for its later Range requests (Chromium does — review finding, 2026-09-08), so the player
  answers an expired URL itself: on a network media error it remembers the position, calls
  `audio.load()` — one fresh trip through the route — restores the position and resumes,
  once per error episode. ASSUMED until a page is left open past 15 minutes and played:
  that the browser reports the bucket's 403 as `MEDIA_ERR_NETWORK`.
- **Client settings, explicit:** `forcePathStyle: false` (virtual-hosted keys, what the
  pipeline verified against Vietnix), `maxAttempts: 1`, `requestHandler: { connectionTimeout:
  5_000, requestTimeout: 10_000 }` — the pool's own bounds. Presigning makes no network call
  (the presigner signs the request locally), so today these bounds guard nothing; they are
  set so the first `HeadObject` a later screen adds inherits deliberate bounds instead of the
  SDK's silent retry default, the rule `docs/upstream.md` §Artifacts already states.
- **Versions pinned exactly, matching the pipeline:** `@aws-sdk/client-s3 3.1127.0` and
  `@aws-sdk/s3-request-presigner 3.1127.0` (the two ship in lockstep; both exist at that
  version on the registry as of 2026-09-08).
- **The list screen shows only a signal.** The "recording" column renders a play glyph when
  `isFetchable` holds and a muted "not yet" otherwise; it presigns nothing. Presigning is
  the detail route's alone.

## Why

- **Redirect route rather than a presigned URL baked into the rendered page.** A URL
  presigned at render time expires while the tab is open: the review page is exactly the
  kind of page left open, and a seek after the expiry is a `403` the browser reports as a
  silent media error. A redirect renews the URL on every media request at the cost of one
  round trip to this app per request, a cost a review page does not notice. The route is
  also the second place the consent gate is enforced for audio: a withheld call has no
  presigned URL anywhere, not even in the HTML, whatever a page renders. The presigned URL
  still lands in the browser's address of the media request — a copy of it plays for up to
  15 minutes; acceptable on an internal console behind Caddy's allow-list (ADR 0002).
- **Straight at the bucket rather than proxied through the app.** The box-to-Vietnix path
  measured ~0.9 MB/s in the pipeline's spike while the viewer's own line is far faster
  (`docs/upstream.md` §Artifacts); a proxy would also put the app in the byte path for
  Range requests it would have to forward correctly. `<audio src>` needs no CORS on the
  bucket, so the decision to leave the bucket without CORS (pipeline spike) stands. The
  price: the browser cannot `fetch()` the file, so no waveform can be drawn from the bytes —
  the player's time axis is the call strip built from the row's offsets, not an amplitude
  trace.
- **An optional group, not five optional keys.** "Configured or not" is the only question a
  screen asks; the group answers it in one place and the throw on a partial group keeps a
  misspelt key from looking like "not configured".
- **One `recordingAccess`.** The page decides whether to render a player, the route decides
  whether to presign, the list decides whether to show the glyph — three screens, one
  predicate, one test. Invariant: no other code compares `artifact_state` to a literal;
  enforced by the `isFetchable` tests and by review (grep `'archived'` under `src/`).
- **Unknown `artifact_state` is `not_archived`.** The contract's vocabulary is fixed
  (§6); a value outside it is rendered with the `Vocabulary` warning in the technical
  section and treated as "not in the bucket", never as playable.

## Rejected

- **Presign per server render** (the brief's default). Simpler by one route, but see the
  expiry argument above; and "simplest" would then need a client-side refresh of the URL
  on error, which is more code than the route.
- **A public bucket or a long-lived URL.** Every caller-derived byte is under the consent
  obligation; a URL that outlives the review is a copy nobody can revoke.
- **Streaming through the app** — see Why; also the pipeline's ADR 0019 chose the bucket
  precisely to take bytes off the box.
- **The pipeline's `tools/fetch-call.ts` path (download the directory, serve from disk).**
  Puts a spool on the console's box, needs a retention policy of its own, and the
  console's own posture (ADR 0002) is that nothing persists on the box but the container.
- **`ResponseContentType` / `ResponseContentDisposition` on the presigned GET.** The
  uploader already stores `call.wav` as `audio/wav` (`object-store.ts`); overriding it
  would hide the first evidence that an object was stored with the wrong type.

## Revisit when

- Vietnix rejects `expiresIn: 900` (ASSUMED accepted — the first `302` that plays settles
  it; the ceiling is written down here then).
- A screen needs more than `call.wav` — `turns/NNN/tts.output.wav` (row A4's per-sentence
  timeline) reuses the same route shape with a key parameter, not a second client.
- The clinic-facing UI (`../Fonnus` W5-A) needs per-tenant keys: the account-wide key
  becomes a per-tenant grant, and the group in `config.ts` becomes a lookup.
- The app ever needs the bytes itself (a waveform, a transcript alignment): CORS on the
  bucket or a proxy is decided then, not assumed now.
