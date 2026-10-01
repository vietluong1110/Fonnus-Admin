/**
 * How one interval reads on screen: the colour of its segment in the upper lane
 * of "The call", the tone of its holder pill in the Intervals card, the row the
 * playhead is inside, and the fixed wording the card carries above and under its
 * table (PLAN row A1b, ADR 0010).
 *
 * It is a separate module from `src/intervals.ts` for the reason ADR 0001 gives
 * `src/ui/row-click.ts`: this repo's test runner sees `.ts` files only — there is
 * no React renderer — so every rendering rule that can be a pure function lives
 * here, where a test can hold it, rather than inside a component nothing asserts.
 *
 * Colours are alias tokens and nothing else (ADR 0003 point 1): no hex ever
 * reaches a screen through this file.
 *
 * This module is pure: no Next.js, no React, no database.
 */
import { formatNumber } from '@/calls';
import { HOLDER_KINDS, type HolderKind, type TrailVerdict, type TrailVerdictKind } from '@/intervals';
import type { BadgeTone } from '@/ui/badge';
import { holderTerm, type Term } from '@/ui/glossary';

/** One interval as the lane draws it — the facts a coloured box can carry. */
export interface LaneSegment {
  /** On the recording clock; can be negative (ADR 0010 decision 4). */
  fromMs: number;
  toMs: number;
  kind: HolderKind;
  /** The pipeline's own holder string: `bot: reply 3`, `caller`, `silence`, `deaf`. */
  label: string;
  turnIdx: number | null;
  /** The interval starts at or after the trail's hole — §8 rule 7. */
  unsupported: boolean;
  /** The turn this interval replies on has a `failed_leg` (trap 7). */
  failed: boolean;
}

/**
 * The hatch both muted kinds wear: a bot wait and a deaf recogniser are
 * stretches in which the line was held by nobody the operator can hear, so
 * neither is a solid fill.
 */
function hatch(stripe: string): string {
  return `repeating-linear-gradient(135deg, ${stripe} 0 3px, var(--surface-card) 3px 6px)`;
}

/**
 * A segment wears its holder: the bot speaks in the first chart voice, the
 * caller in the second, a wait is that first voice hatched (nothing is audible
 * yet), a holding line is that first voice washed out inside a solid edge of
 * it (the bot is speaking, but not the answer — pipeline ADR 0030; not dashed,
 * which the lower lane already spends on "a reply never audible"), silence is the page ground behind a hairline, and a deaf recogniser is
 * the muted voice hatched. A reply on a failed turn takes the error tone, which
 * wins over the holder's own colour — a turn that failed mid-reply is the one
 * being looked for (trap 7), the same rule `blockColour` in `call-axis.tsx`
 * already applies to turn blocks.
 */
export function segmentStyle(
  kind: HolderKind,
  failed: boolean,
): { background: string; border: string | null } {
  switch (kind) {
    case 'reply':
      return { background: failed ? 'var(--error)' : 'var(--chart-1)', border: null };
    case 'greeting':
    case 'canned':
      return { background: 'var(--chart-1)', border: null };
    case 'waiting':
      // The wait of a failed turn is the one being looked for as much as its
      // reply: `event/reply_failed` ends exactly this span (§8 rule 3).
      return { background: hatch(failed ? 'var(--error)' : 'var(--chart-1)'), border: null };
    case 'holding': {
      // The line sits inside the reply's interval (§8 rule 3), so a failed
      // turn's line wears the error voice like its wait and its reply.
      const voice = failed ? 'var(--error)' : 'var(--chart-1)';
      return {
        background: `color-mix(in srgb, ${voice} 35%, var(--surface-card))`,
        border: `1px solid ${voice}`,
      };
    }
    case 'caller':
      return { background: 'var(--chart-2)', border: null };
    case 'silence':
      return { background: 'var(--surface-page)', border: '1px solid var(--border-hairline)' };
    case 'deaf':
      return { background: hatch('var(--chart-3)'), border: null };
  }
}

/** One swatch of the lane's legend: a holder kind the call actually has. */
export interface LegendSwatch {
  kind: HolderKind;
  term: Term;
  style: { background: string; border: string | null };
}

/**
 * The legend under the two lanes: one swatch per holder kind present on this
 * call, in `HOLDER_KINDS` order and labelled by the glossary, plus whether the
 * hatch needs its key — only a `waiting` or `deaf` segment wears one. A kind
 * the call never had is not listed: the legend explains this call's colours.
 */
export function laneLegend(segments: readonly { kind: HolderKind }[]): {
  swatches: LegendSwatch[];
  hatch: boolean;
} {
  const present = new Set(segments.map((segment) => segment.kind));
  const swatches = HOLDER_KINDS.filter((kind) => present.has(kind)).map((kind) => ({
    kind,
    term: holderTerm({ kind, label: kind, turnIdx: null }),
    style: segmentStyle(kind, false),
  }));
  return { swatches, hatch: present.has('waiting') || present.has('deaf') };
}

/**
 * The ground of one row of the Intervals table, by side: the bot's kinds on
 * the card ground, the caller on a faint wash of its own chart voice, and the
 * two kinds nobody spoke in on the page ground.
 */
export function rowTint(kind: HolderKind): string {
  switch (kind) {
    case 'greeting':
    case 'canned':
    case 'waiting':
    case 'holding':
    case 'reply':
      return 'var(--surface-card)';
    case 'caller':
      return 'color-mix(in srgb, var(--chart-2) 10%, transparent)';
    case 'silence':
    case 'deaf':
      return 'var(--surface-page)';
  }
}

/**
 * The sound-instant line as a note under "What was heard", or null: it is a
 * finding only when the caller's line carried sound and the recogniser
 * recognised nothing in the interval, or when the sound fell while the feed was
 * muted. Sound behind a recognised text is the text itself, said once.
 */
export function heardNote(
  interval: { energyMs: readonly number[]; unheard: boolean; finals: readonly unknown[]; overtaken: readonly unknown[] },
  callerLine: string,
): string | null {
  if (interval.energyMs.length === 0) return null;
  const recognised = interval.finals.length > 0 || interval.overtaken.length > 0;
  return recognised && !interval.unheard ? null : callerLine;
}

/** What a segment fades to past the trail's hole: shown, never hidden (§8 rule 7). */
export const UNSUPPORTED_OPACITY = 0.45;

/**
 * The reference prints the holder `deaf (stt exhausted)`; this console renders
 * the label alone and carries the explanation beside it (ADR 0010).
 */
export const DEAF_EXPLANATION = 'deaf — stt exhausted';

const UNSUPPORTED_NOTE = "after the trail's hole — unsupported";

/**
 * Seconds on the recording clock, as every column of `intervals.txt` prints
 * them (`call-evidence.ts:1041-1043`) and every offset of the card follows.
 */
export function seconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/**
 * The empty cell (`call-evidence.ts:566`): a column that has nothing is never
 * blank, it says so. The card asks whether a cell has content before it puts
 * a second line under it.
 */
export const EMPTY_CELL = '—';

/**
 * The two covers a caller-derived text wears instead of its bytes, explained
 * by `INTERVAL_CAVEATS.withheld` below. They live here, with the wording,
 * rather than in `src/intervals.ts`, so that `src/annotations.ts` — which the
 * interval cells consume — can share them without importing its own consumer.
 */
export const WITHHELD = '[withheld]';
/** This console's own reading of trap 10: a granted call whose payload is gone aged out. */
export const EXPIRED = '[expired]';

/**
 * Whether any cell of the card prints `[withheld]` or `[expired]` — the one
 * time the card owes the reader what the two marks mean. Structural, so this
 * file need not import the cells' own module (which imports this one).
 */
export function anyWithheld(
  rows: Array<{
    callerLine: string;
    recogniser: string;
    botText: string | null;
    annotations: Array<{ text: string }>;
  }>,
): boolean {
  return rows.some((row) =>
    [row.callerLine, row.recogniser, row.botText, ...row.annotations.map((item) => item.text)].some(
      (cell) => cell !== null && (cell.includes(WITHHELD) || cell.includes(EXPIRED)),
    ),
  );
}

/** What a screen reader says for a segment: who held the line, and from when to when. */
export function segmentLabel(segment: LaneSegment): string {
  return `${segment.label} ${seconds(segment.fromMs)}–${seconds(segment.toMs)} s`;
}

/** The same line under the pointer, with what colour alone cannot say. */
export function segmentTitle(segment: LaneSegment): string {
  const parts = [segmentLabel(segment)];
  if (segment.kind === 'deaf') parts.push(DEAF_EXPLANATION);
  if (segment.unsupported) parts.push(UNSUPPORTED_NOTE);
  return parts.join(' · ');
}

/**
 * The same note on a row of the card. Undefined rather than an empty string:
 * a `title` attribute of `''` still opens an empty tooltip.
 */
export function rowTitle(row: { unsupported: boolean }): string | undefined {
  return row.unsupported ? UNSUPPORTED_NOTE : undefined;
}

/**
 * The holder's pill: every bot kind in the accent tone (one voice for "the bot
 * held the line", whichever line it was), the caller in the second, and the two
 * kinds nobody spoke in neutral.
 */
export function holderTone(kind: HolderKind): BadgeTone {
  switch (kind) {
    case 'greeting':
    case 'canned':
    case 'waiting':
    case 'holding':
    case 'reply':
      return 'terracotta';
    case 'caller':
      return 'lemongrass';
    case 'silence':
    case 'deaf':
      return 'neutral';
  }
}

/**
 * Which interval the playhead is inside — `[from, to)`, with the last interval
 * keeping the instant that sits exactly on its end, the same edge `recordsOf`
 * in `src/intervals.ts` gives the last span. −1 when the playhead is before the
 * first interval (the trail's first record can start after 0, and it can start
 * before it).
 */
export function rowAtPlayhead(
  rows: readonly { fromMs: number; toMs: number }[],
  playheadMs: number,
): number {
  const last = rows.length - 1;
  for (const [i, row] of rows.entries()) {
    if (playheadMs < row.fromMs) continue;
    if (playheadMs < row.toMs || (i === last && playheadMs === row.toMs)) return i;
  }
  return -1;
}

// ── the card's fixed wording ────────────────────────────────────────────

/** The card's own name — this console's one coined term for row A1b. */
export const INTERVALS_CARD_TITLE = 'Intervals';

/** The pill beside the verdict, on the three verdicts that are not the plain case. */
export const VERDICT_BADGE: Partial<Record<TrailVerdictKind, { tone: BadgeTone; label: string }>> = {
  open: { tone: 'info', label: 'open' },
  truncated: { tone: 'warning', label: 'truncated' },
  gap: { tone: 'warning', label: 'gap' },
};

/**
 * The verdict in one sentence, above any interval (ADR 0010 decision 3). On a
 * `gap` the pipeline's own paragraph is shown instead — it names the hole and
 * what it costs the reader — and `absent` has no table at all, so neither is
 * here.
 */
export function verdictNote(verdict: TrailVerdict): string | null {
  switch (verdict.kind) {
    case 'complete':
      return `Trail complete — ${formatNumber(verdict.records)} records, first to recorder/finalized.`;
    case 'open':
      return 'Trail open — no recorder/finalized and no ended_at: the call is running, or died before it could finalize; intervals end at the last record.';
    case 'truncated':
      return 'Trail truncated — the call ended with no recorder/finalized; nothing past the last record is supported.';
    case 'gap':
    case 'absent':
      return null;
  }
}

/**
 * What a `gap` costs the intervals, after the pipeline's own paragraph. Null
 * when the hole has no seq to name — the `count(*) ≠ max(seq)` gap knows only
 * that writes are missing, so no interval is marked unsupported for it.
 */
export function gapNote(holeFromSeq: number | null): string | null {
  if (holeFromSeq === null) return null;
  return ` Intervals from seq ${formatNumber(holeFromSeq)} on are shown muted and unsupported.`;
}

/**
 * The caveats that travel with the table (CONTEXT.md §Look and feel: a caveat
 * sits with the number it qualifies, never in a footnote). `withheld` and
 * `unheard` are shown only when the call has the thing they explain.
 */
export const INTERVAL_CAVEATS = {
  trail:
    "Read from the call's event trail (contract §8); a record sits on the audio to about 100 ms, late never early.",
  text: "Reply text is the turn's assistant_text, the greeting's and the holding line's are the trail's; a canned line shows its label only.",
  withheld:
    '[withheld] — consent not granted, or not yet on record (contract trap 2); [expired] — the transcript passed its retention TTL (contract trap 10).',
  unheard:
    'unheard — the recogniser feed was muted at that instant, read from the trail’s mute/unmute effects.',
  annotation:
    'annotation — what a person who heard the call wrote afterwards (contract §3), current rows only: a corrected or retracted row is history, shown on demand. One row is shown on every interval it overlaps (§8). A call without granted consent, or without a recording_started_at, has no rows at all by the insert gate — not because nothing was wrong on it (trap 13).',
} as const;

/**
 * The summary of the history block, which is this console's own label for what
 * the pipeline's bundle prints as `annotations.txt`. Both counts are named
 * because the difference between them is the block's whole reason to exist:
 * the rows the table does not show are the corrections and the retractions.
 */
export function annotationHistorySummary(rows: number, current: number): string {
  return `Annotation history — ${formatNumber(rows)} rows, ${formatNumber(current)} current`;
}

/** The lane with no trail to draw: the turn blocks stay, under the reason. */
export const NO_TRAIL_LANE_CAVEAT = 'no event trail on record — lane drawn from turn marks';

/** A trail that cannot be placed: read, counted, and with no clock to sit on. */
export const NO_CLOCK_TITLE = 'Intervals cannot be placed';
export const NO_CLOCK_NOTE =
  'the call has no recording_started_at, so the trail has no clock (contract §8 rule 1)';

/** The card's `absent` state: the verdict names RECORD_CALLS and the four causes. */
export const NO_TRAIL_TITLE = 'No event trail';
