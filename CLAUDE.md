# Fonnus-Admin

The internal admin console for Fonnus, the AI voice receptionist. It reads the pipeline
repo's Postgres and, later, its artifact bucket, and shows calls, transcripts and
per-stage latency so the pipeline can be tuned against numbers instead of by ear. It
reads as the role `console` and writes only the two rows the read contract's §7 allows
(a configuration edit, an annotation), as the role `console_editor`, under the account
the reverse proxy authenticated (ADR 0007). Product and constraints: `CONTEXT.md`.

The pipeline lives in the sibling repository `../Fonnus` (`github.com/VoidKeishi/Fonnus`).
Every path below of the form `../Fonnus/…` is that checkout; it must exist beside this
one for the pointers to resolve.

## Which door

| Situation | Command |
|---|---|
| ALL console work, any size (requirement → design → build → acceptance) | `claude --agent pm` |
| Deploy hand-work on the box, bug investigation, a review the user asks for | plain `claude` |

The personas in `.claude/agents/` (`pm`, `architect`, `builder`, `code-reviewer`,
`explore`) and the `requirement` skill are this repo's own copies of the pipeline repo's,
rewired to this repo's spine: the read contract and `docs/upstream.md` in place of
`PIPELINE_ARCHITECTURE.md`, `pnpm build` in place of `check-config`, "worth a look" in place
of "worth a listen". Never call `architect`, `builder`, or `code-reviewer` directly — they
are the pm persona's executors and refuse prompts without their input contracts. Sizing is
the pm's: S edits directly · M states the change, one approval, then builds · L writes the
decision down in `docs/adr/` before code.

## Read first, every session

1. `PLAN.md` — where the task fits ("continue" = the 🔨 row, else the first ⬜).
2. `CONTEXT.md` — what the console is, who uses it, what it must never do; §Why now
   says which loop the console serves and why the pipeline roadmap waits on it.
3. `docs/upstream.md` — which pipeline tables, columns and rows each screen depends on,
   and what this repo is still waiting for from `../Fonnus`.
4. The upstream documents the task touches, in this order of authority:
   - `../Fonnus/docs/read-contract.md` — **the contract.** Tables, columns, fixed
     vocabularies, the `turn.marks` keys, and five traps a reader gets wrong. Nothing
     is read from Postgres that this file does not name.
   - `../Fonnus/PIPELINE_ARCHITECTURE.md` §6 (latency legs and the two clocks) and §7
     (persistence, artifact layout, the readers paragraph).
   - `../Fonnus/docs/adr/0007-latency-two-clocks.md` (what a mark is and the two
     headline metrics), `0013-repo-boundaries.md` (why this repo exists and what it may
     not do), `0017-console-read-access.md` (the `console` role and the network paths).
   - `../Fonnus/PLAN.md` — the rows this repo waits on: W2-L3 F2–F4 (marks), F5 (the
     call event table behind the timeline, row A1b here), F6–F7 (sub-stage instants,
     reasoning), W2-L1 (the bucket on Vietnix S3).

## Ground rules

- **Vocabulary is the pipeline's.** Turn, leg, mark, consent outcome, end reason,
  artifact directory, retention sweep — defined in `../Fonnus/PIPELINE_ARCHITECTURE.md`
  and used here unchanged (ADR 0013). This repo coins no term for a pipeline concept;
  a screen label is a rendering of a pipeline term, never a new one.
- **Reads as `console`, writes as `console_editor`, nothing else (ADR 0007).** Every
  screen reads through the `console` pool, which cannot write (pipeline migration 0006).
  The only `INSERT`s live under `src/writes/`, run through the `console_editor` pool,
  and carry `created_by = console:<account>` from the `X-Console-Account` header Caddy
  sets; no `UPDATE` or `DELETE` anywhere — a correction is a new row. Tree-scan tests
  hold all of it. No header, no account, no write.
- **The consent obligation lives in this reader.** `turn.caller_text` is rendered only
  when the call's `consent_record.outcome = 'granted'`; otherwise it is withheld with
  the outcome shown in its place. Storage does not enforce this; we do
  (`../Fonnus/docs/read-contract.md` §5 trap 4).
- **Cost is a floor while any model is unpriced** and the screen says so. Latency
  percentiles come from consented calls only, because unconsented calls have no `turn`
  rows. `tts_ttfb` is the first sentence of a reply only. Each of these caveats travels
  with the number it qualifies, on the screen, not in a footnote.
- **SQL is hand-written against the read contract.** No ORM schema copy — a copied
  schema drifts from the pipeline's and lies silently. Every column read is one the
  contract names; a column the contract does not name is not read even if it exists.
- `.env` holds `DATABASE_URL` (the `console` password), `EDITOR_DATABASE_URL` (the
  `console_editor` password — optional; set, it must name that role or the console
  refuses to start) and the read-only bucket key. No pipeline secret, ever. `.env*` is
  gitignored; `.env.example` is the list.
- Do NOT commit unless the user asks. End of task = print a ready-to-run commit block:
  explicit `git add <files>` (never `-A`) + `git commit` per §Commit messages.
- Converse in the language the user writes in; Vietnamese replies keep English
  technical terms in English. Everything written down — docs, code, commits — is English.
- Docs record current state only — history lives in git and `docs/adr/`.
- A claim about the pipeline (a column's meaning, a mark's semantics) is verified
  against `../Fonnus` source or its contract, or marked ASSUMED with what would settle
  it — the same verification rule as `../Fonnus/docs/adr/0011-verification-principles.md`.

## Doc map

| Doc | Holds |
|---|---|
| `PLAN.md` | Roadmap + backlog — the single live tracker; updated in the finishing commit |
| `CONTEXT.md` | Product, users, constraints, stack, deployment posture |
| `docs/upstream.md` | Dependency map onto the pipeline repo: screen → table/column → trap; the "waiting on Fonnus" table |
| `docs/adr/` | Decisions with rationale and revisit triggers (stack, deployment posture) |
| `README.md` | How to run it: local through the SSH tunnel, or on the box |
| `.claude/agents/`, `.claude/skills/` | The pm persona, its executors and the requirement skill — the working method, versioned with the repo |

## Commands

`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test`. The smoke check
against a real database is `curl localhost:3000/api/healthz` (`README.md`).

## Commit messages

English. One summary line, a complete clause naming the change (`A1: call detail — …`),
blank line, then bullets, one complete sentence each, for the why, a decision, or a
behavior change the summary can't carry. Not a file inventory; short comes from fewer
points, never from clipped words. Rationale lives in ADRs.
