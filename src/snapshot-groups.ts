/**
 * `call_log.config_snapshot`, grouped by key prefix for reading — a rendering
 * choice only (`docs/upstream.md` §Call detail), never a claim about the
 * pipeline's own structure: the column is one flat object plus the nested
 * `runtime` and `faq` keys (`../Fonnus/docs/read-contract.md` §3.4).
 *
 * Two rules the grouping may never break, both from §3.4 and trap 6:
 *   - no key is ever dropped. A key this console does not know falls to Other
 *     and is rendered as it stands; the pipeline adds tunables additively, and
 *     a reader that hides what it does not recognise hides the change it was
 *     opened to find.
 *   - a vendor group is headed by `STT_PROVIDER` / `TTS_PROVIDER`, which are
 *     read before any vendor key: a vendor's keys are present only on a call
 *     that ran that vendor, so an absent `DEEPGRAM_*` key means "that vendor
 *     did not run", never "the default applied".
 *
 * The prefixes below are derived from the keys a snapshot actually carries —
 * `CONFIG_SNAPSHOT_KEYS` in `../Fonnus/app/src/config/schema.ts` (74 keys at
 * 2026-09-18) — plus the three `STT_*` spellings rows written before the
 * pipeline's 2026-09-17 rename still hold (§3.4's one allowed rename).
 */

import { formatNumber } from '@/calls';

/** The group names, in the order the card renders them. Console-own labels. */
export const SNAPSHOT_GROUPS = [
  'Speech to text',
  'Language model',
  'Text to speech',
  'Turn taking',
  'Call limits',
  'Consent & recording',
  'Texts',
  'FAQ entries',
  'Runtime config row',
  'Other',
] as const;

export type SnapshotGroupName = (typeof SNAPSHOT_GROUPS)[number];

export interface SnapshotGroup {
  name: SnapshotGroupName;
  /** Key and value as the column holds them; the caller renders the value. */
  entries: { key: string; value: unknown }[];
}

/** The nested key holding the FAQ entries the call ran with (§3.4, pipeline ADR 0031). */
export const SNAPSHOT_FAQ = 'faq';

/*
 * Which group a key belongs to, tried in order: the first rule that matches
 * wins, so `STT_PROVIDER` lands in Speech to text before the `*_PROVIDER`
 * question arises and `TTS_TTFB_MS` in Text to speech rather than in any timing
 * bucket. Every entry names keys that exist in `CONFIG_SNAPSHOT_KEYS`.
 */
const RULES: { group: SnapshotGroupName; prefixes: readonly string[]; keys: readonly string[] }[] = [
  {
    group: 'Speech to text',
    // `STT_*` covers `STT_PROVIDER`, `STT_LANGUAGE`, the queue and mute knobs,
    // and the pre-2026-09-17 `STT_ENDPOINTING_MS` / `STT_UTTERANCE_END_MS` /
    // `STT_TURN_TRIGGER` spellings older rows still carry.
    prefixes: ['STT_', 'DEEPGRAM_', 'SONIOX_', 'SPEECHMATICS_'],
    // The recogniser's input rate; the artboard reads it in this group.
    keys: ['SAMPLE_RATE'],
  },
  { group: 'Language model', prefixes: ['LLM_', 'OPENROUTER_'], keys: [] },
  { group: 'Text to speech', prefixes: ['TTS_', 'CARTESIA_', 'ELEVENLABS_'], keys: [] },
  {
    group: 'Turn taking',
    prefixes: ['BARGE_IN_', 'VAD_'],
    // `HOLDING_LINE_AFTER_MS`: how long a committed turn waits before the
    // holding line (pipeline ADR 0030).
    keys: ['MAX_TURN_REOPENS', 'NO_INPUT_TIMEOUT_MS', 'HOLDING_LINE_AFTER_MS'],
  },
  {
    group: 'Call limits',
    prefixes: [],
    keys: [
      'MAX_CALL_DURATION_SEC',
      'MAX_TURNS_PER_CALL',
      'MAX_REPROMPTS',
      'MAX_CONSECUTIVE_FAILURES',
      'FAREWELL_GRACE_MS',
    ],
  },
  { group: 'Consent & recording', prefixes: [], keys: ['CONSENT_MODE', 'RECORD_CALLS'] },
  {
    group: 'Texts',
    prefixes: ['CANNED_'],
    keys: ['SYSTEM_PROMPT', 'GREETING_TEXT', 'HOLDING_LINES'],
  },
  { group: 'FAQ entries', prefixes: [], keys: [SNAPSHOT_FAQ] },
  { group: 'Runtime config row', prefixes: [], keys: ['runtime'] },
];

/** The keys that head their group, read before any other key of it (§3.4). */
const HEAD_KEYS: Partial<Record<SnapshotGroupName, string>> = {
  'Speech to text': 'STT_PROVIDER',
  'Text to speech': 'TTS_PROVIDER',
};

function groupOf(key: string): SnapshotGroupName {
  for (const rule of RULES) {
    if (rule.keys.includes(key)) return rule.group;
    if (rule.prefixes.some((prefix) => key.startsWith(prefix))) return rule.group;
  }
  return 'Other';
}

/**
 * Every key of the snapshot in exactly one group, groups in `SNAPSHOT_GROUPS`
 * order and empty ones left out. Inside a group the head key comes first and
 * the rest are sorted, so two calls' snapshots read in the same order.
 */
export function groupSnapshot(snapshot: Record<string, unknown>): SnapshotGroup[] {
  const buckets = new Map<SnapshotGroupName, { key: string; value: unknown }[]>();
  for (const key of Object.keys(snapshot)) {
    const group = groupOf(key);
    const bucket = buckets.get(group) ?? [];
    bucket.push({ key, value: snapshot[key] });
    buckets.set(group, bucket);
  }

  const groups: SnapshotGroup[] = [];
  for (const name of SNAPSHOT_GROUPS) {
    const entries = buckets.get(name);
    if (entries === undefined) continue;
    const head = HEAD_KEYS[name];
    entries.sort((a, b) => {
      if (a.key === head) return -1;
      if (b.key === head) return 1;
      return a.key.localeCompare(b.key);
    });
    groups.push({ name, entries });
  }
  return groups;
}

/** One FAQ entry as the call read it; a field that is not a string is null, shown as "—". */
export interface SnapshotFaqEntry {
  key: string | null;
  question: string | null;
  answer: string | null;
  description: string | null;
}

/**
 * The snapshot's `faq` key (contract §3.4): `{ count, entries: [{ key,
 * question, answer, description }] }`, the tenant's `faq_entry` rows as the
 * call read them, present only when the call ran with at least one. Absent is
 * `none` — no enabled rows, every row refused, or a failed read — and never a
 * zero. A `count` that is not a non-negative integer is null (not reported);
 * an entry is kept whatever its shape, with each field it lacks as null, so
 * no entry the call had is dropped from the card. The texts are the
 * snapshot's only: nothing here reads `faq_entry`.
 */
export type SnapshotFaq =
  | { kind: 'none' }
  | { kind: 'entries'; count: number | null; entries: SnapshotFaqEntry[] };

export function snapshotFaq(snapshot: Record<string, unknown>): SnapshotFaq {
  if (!Object.hasOwn(snapshot, SNAPSHOT_FAQ)) return { kind: 'none' };
  const faq = asObject(snapshot[SNAPSHOT_FAQ]);
  const count = faq['count'];
  const entries = Array.isArray(faq['entries']) ? (faq['entries'] as unknown[]) : [];
  return {
    kind: 'entries',
    count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null,
    entries: entries.map((raw) => {
      const entry = asObject(raw);
      const field = (name: string): string | null =>
        typeof entry[name] === 'string' ? entry[name] : null;
      return {
        key: field('key'),
        question: field('question'),
        answer: field('answer'),
        description: field('description'),
      };
    }),
  };
}

/**
 * The FAQ group's head line. Absent reads as the two things it can mean, never
 * as "0 entries" (`../Fonnus/docs/console-call-view.md`, FAQ entries).
 */
export function faqHeadline(faq: SnapshotFaq): string {
  if (faq.kind === 'none') return 'No FAQ entries — none enabled, or the read failed';
  if (faq.count === null) {
    return `Entry count not reported; ${formatNumber(faq.entries.length)} listed (as the call read them)`;
  }
  return `${formatNumber(faq.count)} ${faq.count === 1 ? 'entry' : 'entries'} (as the call read them)`;
}

/** A jsonb value as fields to read by name; anything but a plain object has none. */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
