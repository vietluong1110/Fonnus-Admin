# ADR 0012: `boot_report` is the source of the vendor and voice selects, and of the voice label

**Status:** accepted · **Date:** 2026-09-23 · **Row:** A15

Pipeline ADR 0029 (`../Fonnus` @ `89588cd`, W2-C11) added `tts.voice` — an optional leaf on
both `tts` branches of the runtime document — and `boot_report`, an append-only table the
process writes once per boot: the vendors it can run (`vendors.stt` / `vendors.tts`) and,
per available TTS vendor, its voice list (`voices.<vendor>[] = { id, label, is_default }`).
Contract §7 now says the console **must** take the `tts.voice` select from that table and
**may** narrow the two vendor selects to it. This ADR says how the tab reads the table, what
it shows when the table has nothing to say, and how a voice id is given its label — on the
tab's "last call" column and on the call detail's snapshot card. It amends ADR 0011 D5 and
D9 in place and rewrites rule 4 of `docs/redesign.md` §4.2; the pipeline's words are used
unchanged (`boot_report`, `vendors`, `voices`, `is_default`, `tts.voice`, `build_sha`,
`booted_at`, `runtime.version`, `reason: invalid`).

## Decision

**1. One report per tenant, read once per page: the newest `boot_report` row of the
tenant.** `latestBootReport(tenantId)` in `src/queries/boot-report.ts` runs
`select id, tenant_id, booted_at, build_sha, fonnus_env, providers, vendors, voices from
boot_report where tenant_id = $1 order by id desc limit 1` on the `console` pool — ADR 0029
D6's form; the contract's own line (§2, `order by id desc limit 1` with no tenant filter) is
the same row while the pilot has one tenant, and the filter is what `runtime_config` already
does here. No row → `null`, and the tab is in the **no-report state**: the box is not on
migration 0015 yet, or a `console` grant that predates the table (contract §2 "since
migration 0015"), or the dev database. The state is first-class, not an error: every vendor
is offered, `tts.voice` is a text box, and the caveats of ADR 0011 D9 (the old rule 4) return
word for word. A database without the table or the grant answers SQLSTATE `42P01` (undefined
table) or `42501` (insufficient privilege); both queries of this ADR catch exactly those two,
write one line to stderr naming the code, and return `null` — the same no-report state —
because "a box before migration 0015" is that state by definition, not an error page. Any
other error propagates.

**2. The table is parsed defensively, in the console's own words.** Migration 0015 promises
only that `vendors` and `voices` are JSON objects; the 1–20 entries, the 1–80-character
label and the one default per vendor live in the pipeline's app code. `parseBootReport` in
`src/boot-report.ts` reads the row with a zod schema written here (not a copy — nothing to
copy; the shape is prose in contract §2): `vendors.stt` / `vendors.tts` are arrays of
strings, `voices` is a record of arrays of `{ id: string, label: string, is_default:
boolean }`. An entry that does not fit is **dropped and named** — one caveat per dropped
entry, "voice entry N of `<vendor>` in boot report #`<id>` is malformed and was skipped" —
so a hand-edited or half-written row narrows the select instead of taking the page down.
`vendors` itself or `voices` itself not an object cannot happen (CHECK), and is treated as
empty with the same caveat if it does. `id` is `bigint` and arrives as text; `booted_at` is
a `Date`. A vendor of the report's `vendors.tts` with no key under `voices`, or an empty
list, is a vendor **with no voice list** — the `fake` row of a dev box (contract §2) — and
never an error.

**3. The vendor selects offer the report's vendors; a value outside them blocks the save.**
With a report, `stt.provider` offers `vendors.stt` and `tts.provider` offers `vendors.tts`
(each still intersected with the schema copy's `STT_PROVIDER_VALUES` /
`TTS_PROVIDER_VALUES`: a vendor the report names and the schema copy does not is the drift
`contract-hash.test.ts` catches, and is offered nowhere). A stored provider outside the
report's list renders through the existing `Unknown` option idiom with the wording
"`<value>` — not offered by this box (as of boot at `<booted_at>`)"; a value outside the
schema keeps the schema's wording ("not a value this build offers"), because that refusal
comes first in the pipeline too. At review the same fact is an **issue** at the leaf's path
— "`<vendor>` is not offered by this box as of boot at `<booted_at>`, build `<sha>`; the
process would refuse the whole row (`reason: provider`)" — and an issue blocks the save
(ADR 0011 D5). The check is `offeredIssues(document, report)` in `src/boot-report.ts`, a
pure function the action runs on both the `review` and the `save` intents against a fresh
`latestBootReport(tenant)`, so a report that changes between the two steps (a reboot) is
caught by the save, and a hand-made `save` POST is held to the same rule as the form. No
report → no issue: the console cannot check what it cannot read, and the pipeline still
refuses per call (`reason: provider`, ADR 0028).

**4. The `tts.voice` select shows labels and writes ids; "boot value" carries the default's
label.** The leaf exists on both `tts` branches and is offered only once `tts.provider` is
chosen (the schema's `discriminatedUnion('provider', …)` has no voice without a vendor —
copy :772–796). With JavaScript the control shows `voices[<the tts.provider the form
currently selects>]`: option text is `label`, option value is `id`, `.env` order kept. Its
first option is A14's "boot value" idiom carrying the default's label — "boot value
(`<label of the is_default entry>`)" — and choosing it leaves the leaf **unset**, exactly
like every other select; a list with no `is_default` entry (a `fake` row) shows plain "boot
value". A stored id outside the vendor's list renders as `Unknown` ("`<id>` — not in this
box's `<vendor>` voice list (as of boot at …)") and is an issue at review: "`<id>` is not in
`<vendor>`'s voice list as of boot at `<booted_at>`, build `<sha>`; the process would refuse
the row at the next call (`reason: invalid`)". The list is the rule even when the report's
`providers` is `fake` (the pipeline's own voice check runs under `PROVIDERS=real` only,
`schema.ts:790–830`): the row outlives the process that wrote the report, and the next real
boot refuses it. No report, or a vendor with no voice list → a **text box** with the schema
copy's bound (1–128 characters, trimmed) and a caveat in its hint: "the id cannot be checked
against this box — no boot report for this tenant" / "— this box's boot report lists no voice
for `<vendor>`". With JavaScript off the leaf is one merged control (ADR 0011 D4,
`mergeBranches`): the union of every vendor's voices, one `<optgroup>` per vendor, plain
"boot value" first. The schema copy cannot refuse a voice of the wrong vendor (it bounds a
string, nothing more), so here it is `offeredIssues` at review that refuses it — the D4
pattern with the console's check standing where the schema's stands for `tts.model`.

**5. One "as of boot" line beside what it qualifies, and the liveness trap rendered, never
inferred.** The `stt` card carries "vendors as of boot at `<booted_at>`, build
`<build_sha>`" under its title and the `tts` card "vendors and voices as of boot at …" — a
`Caveat`, because it changes with the data (the A13 rule), placed on the two cards that hold
the three selects rather than once in the head, so it stays beside the select it qualifies
on a long form. The trap of contract §2 (the newest row may describe a process that died
without a successor) is shown as a warm card above the form only when the console holds
both halves of the contract's own check: the tenant's newest call has `started_at >
booted_at` **and** its `config_snapshot->>'FONNUS_BUILD_SHA'` is present and differs from
the report's `build_sha` — "The newest call (`<started_at>`) ran build `<sha>`, not this
report's `<build_sha>`: the report may describe a process that is no longer answering
calls. `/healthz` on the box is the live signal." Before any call after the boot, or when the
snapshot carries no `FONNUS_BUILD_SHA`, nothing is said. For this `lastCallSnapshot`
returns the newest call's `started_at` beside its snapshot (`{ started_at, snapshot }`, both
columns the contract names).

**6. A voice id gets its label from the newest report booted before the call — never
withheld, sometimes caveated.** The contract's own rule for the label (§3.4: the report
"whose `build_sha` matches, or for an older call the newest report booted before
`started_at`") is ambiguous once two boots share a SHA (a voice list is `.env`, so adding a
voice is a restart, not a build). The console-own rule: **the label comes from the newest
`boot_report` row of the tenant with `booted_at <= started_at`**, which is always one row;
when that row's `build_sha` differs from the call's `FONNUS_BUILD_SHA`, the label is shown
with a caveat ("label from the boot report of build `<sha>`, booted `<booted_at>`; the call
ran build `<sha2>`"), not withheld; an id that no report knows reads "unlisted voice". The
id itself is never the text — a 36-character string no operator tells apart or remembers —
only the tooltip, for whoever has to look it up. The select's `Unknown` option and the
review's before and after columns name a voice the same way, by its label in any vendor's
list of the latest report. The
same rule labels the tab's "last call" value of `tts.voice` and the call detail's
`CARTESIA_VOICE_ID` / `ELEVENLABS_VOICE_ID`. The read is `bootReportBefore(tenantId,
at: Date)` — one statement, `where tenant_id = $1 and booted_at <= $2 order by id desc
limit 1` — rather than the tenant's whole table: the table is append-only and never swept
(nothing in the contract names a sweep), so "whole table" grows one row per boot forever
while a `limit 1` read stays one row, and the statement is the rule itself, testable by its
text like every query here. On the tab the second read is skipped when the latest report
already satisfies `booted_at <= started_at` (then it *is* the newest row before the call).
The call detail reads it once per page, on the `console` pool, with `call_log.tenant_id`
added to `getCall`'s select list (a contract column, §3, already read by `callsSinceRow`).
On the detail, the value cell reads the label and says "chosen by row #`<runtime.version>`"
when `runtime.config.tts.voice` is present in the snapshot, else "boot value" (the A14 idiom, the same words as the form's select) — the layer
rule of decision 8.

**7. Review shows what will be saved, and the diff is against the newest row (ADR 0011 D5
amended).** Two audit findings, fixed together because both are about the review being the
truth of the save: (a) the form loaded from a history row (`?from=`) diffed against itself,
so a restore showed "no change"; the diff is now always against the **newest row of the
tenant** (or boot config, `{}`, when there is no row or the newest row is one the schema copy
refuses — trap 6), and the head keeps saying which row the form was loaded from; (b) the
review, its diff and its hidden `document` carried the document as the form built it, while
the save inserted the parsed one, so a trimmed `context_text` or `tts.voice` was reviewed
untrimmed — review, diff and hidden `document` now carry the **parsed** document when it
parses (the raw one, with its issues, when it does not), so the inserted row is
byte-for-byte what was reviewed and the save's second parse is idempotent.

**8. Layer attribution beside every "last call" value (rule 7 of `docs/redesign.md` §4.2).**
Beside the value the last answered call ran on, the form says "row #`<runtime.version>`"
when the leaf's path is present in `config_snapshot.runtime.config` and "boot" otherwise; a
snapshot without `runtime` is boot (or a refused row — the D7 warning says which); a null
snapshot stays "not recorded". `layerOf(snapshot, path)` is a pure function in
`src/configuration/document.ts` beside `ranOn`, tested: `runtime.config` is the parsed
document the pipeline read (`buildConfigSnapshot(config, { version: row.id, config: doc })`,
`call-config.ts:149`), so a path present there came from the row and a path absent came
from boot config; a `runtime` that is not `{ version, config }` is read as absent. The same
function gives the detail card its "chosen by row #N / boot value".

**9. The name tooltip names the snapshot's vendor, not the form's.** For a per-vendor flat
key (`stt.model`, `tts.model`, `tts.params.speed`, `tts.params.pronunciation_dict_id`,
`tts.voice`) the tooltip's "snapshot key" line named the key of the vendor the form currently
selects, while the value beside it was resolved from the snapshot's own `STT_PROVIDER` /
`TTS_PROVIDER` (ADR 0011 D4). Both now come from one resolution: `flatKeyOf(snapshot,
field)` returns the key `ranOn` reads, the tooltip prints it, and when the snapshot names no
vendor for the leg it says "snapshot key per vendor: … (the last call's snapshot names no
`TTS_PROVIDER`)".

**10. The copies move to `89588cd` in the same change as `FLAT_KEYS`.** Re-copy
`runtime-document.ts` and `speakable.ts` byte for byte, re-pin the two `contract-hash`
lines (`b572f584…0389`, `934e0fe5…ac08`), and add `'tts.voice': { cartesia:
'CARTESIA_VOICE_ID', elevenlabs: 'ELEVENLABS_VOICE_ID' }` to `FLAT_KEYS` after `'tts.model'`
(the pipeline's order, which `flat-keys.test.ts` compares) — in one commit, because a copy
with a leaf the map lacks makes `flatKeyFor` throw and takes the page and the action down.
The count pins move with it, verified by running the walk against the new copy: 55 leaf
paths (was 54), 20 `tts` fields (was 18), five per-vendor paths (was four); the
`utterance_end_ms` bound 1000–5000 comes with the copy and is typed nowhere here. CI cannot
see `../Fonnus`, so a contract change is noticed the first time a checkout with the sibling
runs the tests; the hash pins in the test are the gate that can run anywhere, and no further
gate is added (audit finding 4).

## Why

- **The report over `/healthz`.** Rule 4 offered every vendor because the container could
  not reach `/healthz`; the report is the same fact (`vendors` is "exactly the value
  `/healthz` reports", contract §2) in the database the console already reads, so the tab
  can now refuse before the save what the pipeline would refuse on every call after it. The
  forces: a select narrowed to what the box can run, against the risk of a report that lies
  (a dead process, decision 5) or is absent (decision 1). Both are shown, neither is fatal.
- **Block, not warn, on a value outside the list.** A row naming a vendor the box holds no
  key for is refused whole at every call until replaced (ADR 0028 D3), so a save that goes
  through is a save of a row that will never run; an issue that blocks is cheaper than the
  "latest row not applied" card the operator would read next. The console's block is a
  convenience gate — the pipeline's refusal is the enforcer — which is why the no-report
  state does not pretend to check.
- **Label lookup by time, caveat by SHA.** The contract's SHA-first rule cannot pick one row
  when two boots share a SHA, and it withholds a label when the SHA moved but the list did
  not. Time is total and cheap; the SHA is worth a sentence, not a blank.
- **Two point reads over one table read.** Both reads are `limit 1` on a table without an
  index beyond its key (migration 0015); at one row per boot a sequential scan of it is
  nothing today, and a point read does not grow with the years while "the whole table" does.
- **Rule 7 now, not later.** The pipeline's own W2-C4 asked "which layer did each value come
  from"; the data is in every snapshot already (`runtime.config`), and a "last call" column
  that cannot say whether the value came from the row being edited or from boot config sends
  the operator to the history to guess.
- **Serial builds.** Dispatch A (re-copy, layer, the three form fixes) and dispatch B (the
  report) both edit `page.tsx`, `configuration-form.tsx` and `actions.ts` at their centres —
  the `Control` component, the props of `ConfigurationForm`, `reviewState` — and a merge of
  two hands in one 700-line component costs more than the day A takes. So A → B → C; B and C
  share only the query module, and C also carries `getCall`'s one new column.

## Rejected

- **Client-side validation of the voice against a list carried in hidden fields.** The
  hidden copy is the client's; the action re-reads the report on the `console` pool instead
  (decision 3), the same posture as the save's second parse.
- **The contract's SHA-matched report for the label** (decision 6): ambiguous on equal SHAs,
  a blank on a `.env`-only change.
- **Reading the tenant's whole `boot_report` table** once and picking rows in TypeScript:
  simpler code, unbounded growth (decision 6).
- **A separate component for the report-driven selects so A and B can run in parallel:**
  the voice options depend on the form's live `providers` state inside `EditStep`, so the
  component would still be wired through `Control` and `FieldRow` — the same file, the same
  merge.
- **Skipping the console's voice check when the report's `providers` is `fake`** (the
  pipeline skips its own): the row is saved for every later boot, real ones included.
- **Withholding the label when `build_sha` differs:** the operator loses the one word that
  makes the id readable to guard against a rename between boots that the caveat already names.

## Revisit when

- **The contract pins the shape of `vendors` / `voices` under a hash line or a CHECK** (the
  1–20 entries, the label bound, the one default): `parseBootReport` becomes a copy under
  rule 1 of §4.2 and its "dropped entry" caveats go.
- **The contract adds the boot `TTS_PROVIDER` / `STT_PROVIDER` to `boot_report`**: "boot
  value" on the provider selects can name the vendor the way the voice select names the
  default voice today.
- **A second tenant is real**: the per-tenant filter of decision 1 is then load-bearing
  rather than equivalent to the contract's line.
- **`boot_report` gains a sweep or an index on `(tenant_id, booted_at)`**: the statement of
  decision 6 keeps working; the sequential-scan assumption below is settled either way.
- **The pipeline records the fallback reason per call**: the review's "would refuse" sentences
  can point at the recorded reason instead of the log line.

## Verified facts

- `boot_report` DDL: `../Fonnus/app/drizzle/0015_boot_report.sql` — `id bigserial`,
  `tenant_id` FK, `booted_at timestamptz default now()`, `build_sha`, `fonnus_env`,
  `providers`, `vendors jsonb` and `voices jsonb` each `CHECK (jsonb_typeof(…) = 'object')`,
  no other index. The row's shape in prose: contract §2 `boot_report` and ADR 0029 D6.
- `tts.voice` is optional on both `tts` branches of a `discriminatedUnion('provider', …)`
  (`../Fonnus/app/src/config/runtime-document.ts:772–796`); `LEAF.tts.voice` is
  `z.string().trim().min(1).max(128)` (:497).
- The pipeline refuses a voice outside the list only under `PROVIDERS=real`
  (`../Fonnus/app/src/config/schema.ts:790–830`), with `reason: invalid` (`call-config.ts`,
  contract §7:805); a foreign vendor is refused before the merge with `reason: provider`.
- `runtime.config` in the snapshot is the parsed document the pipeline read
  (`../Fonnus/app/src/config/call-config.ts:149`, `snapshot.ts:40–66`), present only when a
  row was read and parsed.
- The re-copied `runtime-document.ts` differs from the current copy by three hunks only
  (`utterance_end_ms` 1000–5000, `LEAF.tts.voice`, `voice` on both branches); `speakable.ts`
  is identical; `sha256sum` of both pipeline files equals the two new §7 hash lines. The
  walk over the new copy yields 55 leaf paths, `tts` 20, and five per-vendor paths with
  `tts.voice` (run in the session scratchpad, 2026-09-23).
- `getCall` does not select `call_log.tenant_id` today (`src/queries/calls.ts:147–181`);
  `callsSinceRow` does, so the column is contract-named and already read.

## Assumed

- **`boot_report` stays small enough for a sequential scan** (one row per boot, no index
  beyond the key): settled by `select count(*) from boot_report` on the box after a few
  months, and by `EXPLAIN` of the decision-6 statement.
- **`runtime.version` in a snapshot prints the same digits as `runtime_config.id::text`**
  (carried from ADR 0011): settled on the box by the first row saved and the next call's
  snapshot.
- **The `console` role can read `boot_report` on the box** — the contract says the grant
  comes with migration 0015: settled by `select 1 from boot_report limit 1` as `console`.
