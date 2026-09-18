/**
 * `call_log.config_snapshot`, grouped by key prefix for reading — a rendering
 * choice only (`docs/upstream.md` §Call detail), never a claim about the
 * pipeline's own structure: the column is one flat object plus the nested
 * `runtime` key (`../Fonnus/docs/read-contract.md` §3.4).
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

/** The group names, in the order the card renders them. Console-own labels. */
export const SNAPSHOT_GROUPS = [
  'Speech to text',
  'Language model',
  'Text to speech',
  'Turn taking',
  'Call limits',
  'Consent & recording',
  'Texts',
  'Runtime config row',
  'Other',
] as const;

export type SnapshotGroupName = (typeof SNAPSHOT_GROUPS)[number];

export interface SnapshotGroup {
  name: SnapshotGroupName;
  /** Key and value as the column holds them; the caller renders the value. */
  entries: { key: string; value: unknown }[];
}

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
    keys: ['MAX_TURN_REOPENS', 'NO_INPUT_TIMEOUT_MS'],
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
    keys: ['SYSTEM_PROMPT', 'GREETING_TEXT'],
  },
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
