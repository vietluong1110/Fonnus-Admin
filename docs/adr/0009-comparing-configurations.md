# ADR 0009: Comparing configurations — flat keys plus `runtime.version`

**Status:** accepted 2026-09-18 · **Date:** 2026-09-18

## Decision

The Overview's "Configurations compared" card groups calls by one setting and shows, side
by side, only the settings that differ between the groups. The rules this console adds to
contract §3.4, which defines the snapshot but no comparison:

1. **The differing-key columns are top-level flat keys** of `config_snapshot` whose
   rendered values differ across the groups (`renderValue`, canonical JSON for objects and
   arrays, `absent` and `null` as two distinct sentinels), **plus one derived column,
   `runtime.version`** (`config_snapshot->'runtime'->>'version'`), shown when it differs.
   The `runtime` object is never itself a column and `runtime.config.*` is never
   descended.
2. **The grouping vocabulary** stays `none · llm_model · stt_model · tts_model · config ·
   key:<K>` and gains exactly one dotted path, `key:runtime.version` ("Runtime config
   row"). Any other `key:` names a top-level key; a dot in it is a key with a dot, not a
   path.
3. **The three renamed keys are one key each.** `key:DEEPGRAM_ENDPOINTING_MS`,
   `key:DEEPGRAM_UTTERANCE_END_MS`, `key:DEEPGRAM_TURN_TRIGGER` read the new name and fall
   back to the old `STT_*` spelling (the contract's own COALESCE instruction); asking for
   the old name resolves the same way, and the differing-key column carries the new name.
   Recorded in one table in `src/dashboard.ts`, deleted when the old rows have aged out.
4. **The default grouping is `key:OPENROUTER_MODEL`.** The `config` grouping (identity =
   the whole snapshot) stays available and is unchanged.

## Why

- The flat keys are the effective values a call ran on; the runtime document under
  `runtime.config` is their *source* (contract §3.4, pipeline ADR 0020). Every leaf a
  console edit changes surfaces as a flat-key difference, so descending would add a second
  column for each difference already shown — and would need the path-to-key map
  (`RUNTIME_KEY_MAP`, 54 paths and growing) copied from the pipeline, a copy that drifts
  with every editable key added.
- What the flat keys cannot show is "a new row that changed nothing effective", and that
  is exactly what the one derived column `runtime.version` shows. Grouping by it turns a
  console edit into an A/B with one label (`docs/redesign.md` §5).
- One dotted path, handled by name, is a two-line branch. A generic resolver would accept
  `runtime.config.llm.model` and silently duplicate `OPENROUTER_MODEL`.
- `OPENROUTER_MODEL` as the default because `llm_ttft` is the only leg a model change
  moves (Overview caption), and it is the change the loop makes most often.

## Rejected

- **Descending into `runtime.config` leaves.** Doubles every column and copies the key map.
- **`runtime` as one opaque canonical-JSON column.** A cell holding a 54-leaf document is
  unreadable, and it always differs when the version differs, so it says nothing the
  version column does not.
- **A generic `key:a.b.c` resolver.** Accepts paths that shadow flat keys (above).

## Revisit when

- The pipeline stops writing flat keys and snapshots the document alone: then the columns
  must descend, with the key map copied under a drift test like A9's `contract-hash`.
- Row A9 needs a diff of two `runtime_config` rows: that is a reader of
  `runtime_config.config`, not of the snapshot, and lives beside the form, not here.
