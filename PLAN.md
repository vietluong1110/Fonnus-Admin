# PLAN — roadmap & backlog

The one live tracker. Status: ⬜ not started · 🔨 in progress · ✅ done. Updated in the
commit that finishes the work. "Continue" = the 🔨 row, or the first ⬜ if there is none.
Current state only, never history. A Notes cell is a pointer, not a record: what still
binds and where the detail lives (`CONTEXT.md` §, `docs/upstream.md`, an ADR, a
`../Fonnus` row).

Row order is a proposal — veto freely. Rows that wait on the pipeline repo say so and
name the `../Fonnus/PLAN.md` row; they are not started before it lands.

## Roadmap

| Step | Status | Notes |
|---|---|---|
| A0 scaffold — Next.js (App Router, TypeScript) via `create-next-app`, pnpm 11, `tsconfig` strict flags mirroring `../Fonnus/app/tsconfig.json`, ESLint flat config with `strictTypeChecked`, a `pg` Pool with the same four bounds as `../Fonnus/app/src/persistence/db.ts` (connect 5 s, idle 30 s, statement and query 10 s, `pool.on('error')` wired), `.env` loaded once and `DATABASE_URL` the only key, `/api/healthz` running `select 1` as `console` and reporting the role name it connected as; `pnpm typecheck` / `lint` / `test` green on the empty app | ⬜ | S–M. ADR 0001. Dev target: the pipeline's dev Postgres or the VPS through the tunnel (`README.md`). Acceptance: `/api/healthz` returns the role `console` against a real database |
| A1 call list + call detail — list: `call_log` LEFT JOIN `consent_record` (the join the pipeline's own `recentCalls` uses; a missing consent row = not finalized), newest first, columns when / duration / `end_reason` / consent outcome / turns on record / cost with the floor caveat. Detail: header (ids, models, `did`, the `config_snapshot` the call ran under, with the build SHA), the turns with caller text **withheld unless `outcome = 'granted'`**, and per turn a **waterfall of the six legs** computed from `turn.marks` with the pipeline's partition (`stt_emit` and `playback` outside the partition, drawn as such; a reversed span rendered "not measured", never negative), the two headline spans against the ADR 0007 targets (1 200 ms pipeline, 3 600 ms caller-perceived), tokens, `tts_chars`/`tts_bytes` | ⬜ | M. `docs/upstream.md` §Call list, §Call detail. The leg partition is copied from `../Fonnus/app/src/domain/latency.ts` (`LEGS`, `legSpans`) — copy, not import; a test here pins the copy against the six leg names in `PIPELINE_ARCHITECTURE.md` §6. Acceptance: opens every call in `../Fonnus/docs/baselines/2026-09-05-w2v2.json` (`callIds`) without error; an unconsented call shows the outcome in place of caller text; the header shows the snapshot |
| A2 latency dashboard — per-leg P50 / P95 / max over a window (`since` like the pipeline's `report-calls`: `7d`, `36h`, ISO), nearest-rank percentiles (the pipeline's choice, `tools/lib/call-report.ts`, because samples are small), trend by day, the count of calls and turns each number stands on, the two headline percentiles (which the pipeline's baseline JSON does not carry — compute here from `caller_perceived_ms` / `pipeline_ms`), and a "turns outside the percentile" table (turns with no `first_audio_out`). Grouping: by `llm_model` / `stt_model` / `tts_model` and **by `config_snapshot`** (whole object, or one key — `docs/upstream.md` §Dashboard); the failure reason column once F2 lands | ⬜ | M. `docs/upstream.md` §Dashboard. Acceptance: on the same window the per-leg numbers equal `report-calls` run on the pipeline side (same source, same percentile rule) — checked once by hand against `docs/baselines/2026-09-05-w2v2.md` |
| A1b call timeline — one time axis per turn (and one for the greeting from `answered`) carrying every record of the call event table: STT partials and final with text under the consent rule, turn end, LLM request → first token → last token with the reasoning collapsed under the reply, each TTS sentence as sent → frame sent → first byte → settled, first audio out, playback start/end, failure markers with stage and ms; the seven marks of A1's waterfall stay as the summary row above the axis | ⬜ | M. **Waits on `../Fonnus` PLAN row W2-L3 F5** (the table); draws what F6 and F7 add as they land. Pairing rules and the record list: `docs/upstream.md` §The call timeline; `CONTEXT.md` trap 8 (first sentence includes the socket handshake until F6). Acceptance: on a baseline call the timeline's per-sentence and per-turn numbers match `inspect-call` run on the pipeline side for the same call |
| A3 deploy on the VPS with a public domain — multi-stage `Dockerfile` on `node:22-bookworm-slim`, `compose.yml` with `admin` (joins `fonnus_default` as `external: true`, `DATABASE_URL` → `postgres:5432`) and `caddy` (auto-TLS, `basic_auth` one operator account, the only listener on 80/443), `Caddyfile`, `ufw allow 80,443/tcp`, a deploy-by-hand runbook (`docs/deploy.md`: build on the laptop or GHCR, `docker compose pull && up -d` in `~/fonnus-admin`), and **the live-state block of `../Fonnus/CONTEXT.md` §Deployment updated in the same change** (new listeners on the box) | ⬜ | M. ADR 0002 (proposed → accepted when this ships). Domain not chosen — placeholder `admin.<domain>`. Acceptance: the call list opens over HTTPS from a laptop with no tunnel, refuses without the account, and `docker compose down` in `~/fonnus` reports the attached network rather than failing silently |
| A4 audio + artifact views — play `call.wav` (stereo, L = caller, R = bot), the per-sentence TTS timeline (`tts/sentence` → `tts/first_byte` → `tts/settled` from `events.jsonl`), the verbatim LLM stream per turn; consent rule applied to every caller-derived byte | ⬜ | M–L. **Waits on `../Fonnus` PLAN row W2-L1** (the bucket on Vietnix S3, the read-only key, the object-key half of the read contract). Timing comes from the event table (A1b) once F5 lands; the bucket serves the audio and the verbatim files. Decided by W2-L1's spike (2026-09-07): presigned GET with `Range` works, so the player links at the bucket through a short-lived presigned URL and this app never proxies audio (`docs/upstream.md` §Artifacts). Acceptance adds one observation: which stored `Content-Type` plays inline (`audio/wav` vs `audio/vnd.wave`) — report it to the pipeline's W2-L1 row |

**Product view at A3 exit.** The operator opens a domain, logs in, and for any call sees the
transcript (consent permitting), a waterfall of where the reply's time went, and cost; the
dashboard shows whether last week's change to a pipeline setting moved the P95, grouped by
the configuration each call ran under. Not yet: the per-step timeline (A1b, after F5);
audio; a clinic's own view.

## Waiting on `../Fonnus`

| Pipeline row | What it unlocks here | Status there |
|---|---|---|
| W2-L3 F1 config snapshot per call (`call_log.config_snapshot`, build SHA) | A2 grouping by configuration — the reason the dashboard exists | ✅ 2026-09-06 |
| W2-L3 F2 end-of-turn marks (`llm_last_token`, `tts_last_byte`, `playback_end`) + `turn.failed_*` | A1 waterfall extends past first byte; A2 "why is this turn outside the percentile" | ⬜ |
| W2-L3 F3 greeting marks (`call_log.greeting_marks`, `greeting_first_audio_ms`) | A1 header: time from answer to the first audible greeting byte | ⬜ |
| W2-L3 F4 `tts/first_byte` record in `events.jsonl` | A1b per-sentence bars (through F5) | ⬜ (builds with F2 and F3 as one batch) |
| W2-L3 F5 call event table — every `events.jsonl` record in Postgres | A1b entirely | ⬜ (L, needs an ADR there) |
| W2-L3 F6 sub-stage instants — STT socket open and first frame forwarded, LLM request sent, TTS generation frame sent per sentence, `answered`, `chunk_played` fields | A1b sub-steps; retires trap 8 | ⬜ (with F5) |
| W2-L3 F7 LLM reasoning on record — `turn.reasoning_text`, reasoning lines in `llm.stream.jsonl` | A1b reasoning panel under each reply | ⬜ |
| W2-L1 artifact bucket on Vietnix S3 + read-only key + object-key contract | A4 entirely | ⬜ (spike done 2026-09-07; the build is next in that repo after W2-L3) |
| W5-A tenant runtime (calls carry a tenant a filter can use) | Backlog: tenant filter | ⬜ |

## Backlog

| Item | Status | Notes |
|---|---|---|
| Tenant filter — one clinic sees only its calls | ⬜ | After `../Fonnus` W5-A; the query gains one `where`, the login gains a tenant claim; ADR 0017's revisit trigger (one role per reader or row-level security) is the pipeline's decision, not ours |
| Real login replacing Caddy `basic_auth` | ⬜ | The moment a second person needs access, or a clinic does. ADR 0002 revisit |
| Baseline import — read `../Fonnus/docs/baselines/*.json` (`report-calls --baseline` output) and overlay the committed numbers on the dashboard | ⬜ | S once A2 exists; the JSON shape is documented in `docs/upstream.md` §Baselines |
| Unpriced-model caveat from data, not from a constant — read the pipeline's `/healthz` `unpricedModels` (loopback on the box; reachable from the `admin` container only with host networking or a proxy) or derive from `turn.llm_model` against a copied price table | ⬜ | Until then the cost column always carries the floor caveat text |
| Retention-aware display — compare `started_at` against `RECORDING_TTL_DAYS` / `TRANSCRIPT_TTL_DAYS` / `PHONE_TTL_DAYS` to label a null as "expired" rather than "absent" (contract trap 5). The TTL values live in the pipeline's `config/prod.env`; F1 ships them per call in `config_snapshot` since 2026-09-06, so read them from the call's own snapshot and fall back to copied constants for older calls | ⬜ | S |
