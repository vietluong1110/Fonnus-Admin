# Fonnus-Admin

The internal admin console for Fonnus, the AI voice receptionist. It reads the pipeline's
Postgres (and, later, its artifact bucket) and shows calls, transcripts and per-stage
latency, so the pipeline is tuned against numbers instead of by ear. Product, users and
constraints: `CONTEXT.md`.

The pipeline is the sibling checkout `../Fonnus` (`github.com/VoidKeishi/Fonnus`). Every
`../Fonnus/…` path below assumes it exists beside this repo.

## Which door

| Situation | Command |
|---|---|
| All console work, any size: requirement, design, build, acceptance | `claude --agent pm` |
| Deploy hand-work on the box, bug investigation, a review the user asks for | plain `claude` |

`.claude/agents/` holds the pm and its executors (`architect`, `builder`, `code-reviewer`,
`explore`); `.claude/skills/` holds `requirement` and `playwright-cli`. Only the pm
dispatches `architect`, `builder` and `code-reviewer`; they refuse prompts that lack their
input contracts.

## Read first, every session

1. `PLAN.md` — where the task fits. "Continue" means the 🔨 row, else the first ⬜.
2. `CONTEXT.md` — what the console is for (§Why now), what it shows, what it must never do.
3. `docs/upstream.md` — which pipeline tables and columns each screen reads, and what this
   repo still waits on from `../Fonnus`.
4. The upstream documents the task touches, highest authority first:
   `../Fonnus/docs/read-contract.md` (the contract — nothing is read that it does not
   name), then `../Fonnus/PIPELINE_ARCHITECTURE.md` §6 (latency) and §7 (persistence),
   then pipeline ADRs 0007 (marks, the two clocks), 0013 (repo boundaries) and 0017 (the
   `console` role), then `../Fonnus/PLAN.md` for the rows this repo waits on.

## Ground rules

- **The pipeline's vocabulary, unchanged.** Turn, leg, mark, consent outcome, end reason,
  artifact directory and retention sweep are defined upstream (pipeline ADR 0013). This
  repo coins no term for a pipeline concept; a screen label renders a pipeline term.
- **Read as `console`, write as `console_editor`, nothing else (ADR 0007).** Screens read
  through the `console` pool, which cannot write. The only `INSERT`s live in
  `src/writes/`, go through the `console_editor` pool, and carry
  `created_by = console:<account>` from the `X-Console-Account` header Caddy sets. No
  header, no write. No `UPDATE` or `DELETE` anywhere: a correction is a new row.
  Tree-scan tests enforce this.
- **Consent is enforced here, not by storage.** `turn.caller_text` and every other
  caller-derived byte render only when the call's `consent_record.outcome = 'granted'`;
  otherwise the outcome shows in its place (contract §5 trap 4).
- **Each caveat travels with its number, on screen.** Cost is a floor while any model is
  unpriced; latency percentiles cover consented calls only; `tts_ttfb` is the first
  sentence of a reply only.
- **Hand-written SQL against the contract.** No ORM, no copied schema. A column the
  contract does not name is not read, even if it exists.
- **A claim about the pipeline is verified or marked ASSUMED** — verified against
  `../Fonnus` source or its contract; ASSUMED names the observation that would settle it
  (pipeline ADR 0011).
- **Secrets.** `.env` holds `DATABASE_URL` (the `console` role), the optional
  `EDITOR_DATABASE_URL` (must name `console_editor`, or the app refuses to start) and the
  read-only bucket keys. Never a pipeline secret. `.env.example` is the list.
- **Never write to `../Fonnus`.** A fact the console needs and the pipeline does not
  record becomes a row in `PLAN.md` §Waiting on `../Fonnus`.
- **Docs record current state only.** History lives in git and `docs/adr/`.
- **Language.** Converse in the user's language, keeping English technical terms in
  English. Everything written down — docs, code, commits — is English.
- **Do not commit unless asked.** At the end of a task, print a commit block: explicit
  `git add <files>` (never `-A`), then `git commit -F - <<'EOF' … EOF`.

## Commit messages

English. A summary line that is one complete clause naming the change
(`A1: call detail — …`), a blank line, then bullets, one complete sentence each, for the
why, a decision, or a behaviour change the summary cannot carry. Not a file inventory.
Short comes from choosing fewer points, never from clipped words. Rationale lives in ADRs.

## Doc map

| Doc | Holds |
|---|---|
| `PLAN.md` | Roadmap and backlog, the one live tracker; updated in the finishing commit |
| `CONTEXT.md` | Product, users, constraints, stack, deployment posture |
| `docs/upstream.md` | Screen → pipeline table/column → trap; the "waiting on Fonnus" table |
| `docs/redesign.md` | The product draft reconciled with the data; the artboards themselves are in the gitignored `docs/design/` |
| `docs/adr/` | Decisions with rationale and revisit triggers |
| `README.md` | How to run it: locally (SSH tunnel or the pipeline's dev database) or on the box |

## Commands

`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test`. The smoke check
against a real database is `curl -s localhost:3000/api/healthz` (its three answers are in
`README.md`). To look at a running screen, use the `playwright-cli` skill; its output
lands in the gitignored `.playwright-cli/`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
