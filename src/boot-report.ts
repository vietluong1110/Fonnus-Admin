/**
 * The tenant's `boot_report` row as the console reads it (ADR 0012): what one
 * boot of the pipeline process could run — the vendors of each leg and, per TTS
 * vendor, its voice list — and the pure rules the Configuration tab and the
 * call detail draw from it.
 *
 * Nothing here touches Postgres, a request or a clock: the two reads live in
 * `src/queries/boot-report.ts`, and everything below is testable from a plain
 * row.
 *
 * The shape of `vendors` and `voices` is prose in `../Fonnus/docs/read-contract.md`
 * §2 and pipeline ADR 0029 D6, not DDL — migration 0015 CHECKs only that both are
 * JSON objects — so the schema here is the console's own (D2), not a copy, and a
 * malformed entry is dropped and named instead of taking the page down.
 */
import { z } from 'zod';
import { formatWhen, shortSha } from '@/calls';
import {
  STT_PROVIDER_VALUES,
  TTS_PROVIDER_VALUES,
} from '@/contract/config/runtime-document';
import { layerOf, type DocumentIssue, type Layer } from '@/configuration/document';
import { voiceIdOf } from '@/dashboard';

/** One entry of a TTS vendor's voice list, in the pipeline's own names. */
export interface BootReportVoice {
  id: string;
  label: string;
  is_default: boolean;
}

export interface BootReport {
  /** `bigint`, arrives as text. */
  id: string;
  tenant_id: string;
  booted_at: Date;
  build_sha: string;
  fonnus_env: string;
  /** `real` or `fake`. */
  providers: string;
  vendors: { stt: string[]; tts: string[] };
  /** Per TTS vendor, its voice list in `.env` order; a vendor may have no key or `[]`. */
  voices: Record<string, BootReportVoice[]>;
  /** One caveat per malformed part skipped while parsing, in the D2 wording. */
  dropped: string[];
}

/** The columns themselves: `not null` in migration 0015, so a misfit here is a real failure. */
const rowSchema = z.object({
  id: z.union([z.string(), z.number(), z.bigint()]).transform(String),
  tenant_id: z.string(),
  booted_at: z.coerce.date(),
  build_sha: z.string(),
  fonnus_env: z.string(),
  providers: z.string(),
  vendors: z.unknown(),
  voices: z.unknown(),
});

/**
 * One voice. The id is at least one character: an empty id could never be a
 * `tts.voice` (the schema copy bounds it 1–128) and would collide with the
 * select's "boot value" option, whose value is the empty string.
 */
const voiceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  is_default: z.boolean(),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The row as the console uses it. `vendors.stt` / `vendors.tts` are lists of
 * strings and `voices` a record of lists of `{ id, label, is_default }`; every
 * entry that does not fit is skipped with one caveat naming it (ADR 0012 D2),
 * and `vendors` or `voices` that is not an object — which migration 0015's
 * CHECK forbids — reads as empty with a caveat. A TTS vendor with no key under
 * `voices`, or an empty list, is a vendor with no voice list: the `fake` row of
 * a dev box, never an error.
 */
export function parseBootReport(row: Record<string, unknown>): BootReport {
  const columns = rowSchema.parse(row);
  const dropped: string[] = [];
  const where = `boot report #${columns.id}`;

  const vendors = { stt: [] as string[], tts: [] as string[] };
  if (!isObject(columns.vendors)) {
    dropped.push(`vendors in ${where} is not an object and was read as empty`);
  } else {
    for (const leg of ['stt', 'tts'] as const) {
      const list = columns.vendors[leg];
      if (!Array.isArray(list)) {
        dropped.push(`vendors.${leg} in ${where} is not a list and was read as empty`);
        continue;
      }
      list.forEach((entry: unknown, index) => {
        if (typeof entry === 'string' && entry !== '') vendors[leg].push(entry);
        else dropped.push(`${leg} vendor entry ${String(index + 1)} in ${where} is malformed and was skipped`);
      });
    }
  }

  const voices: Record<string, BootReportVoice[]> = {};
  if (!isObject(columns.voices)) {
    dropped.push(`voices in ${where} is not an object and was read as empty`);
  } else {
    for (const [vendor, list] of Object.entries(columns.voices)) {
      if (!Array.isArray(list)) {
        dropped.push(`voices.${vendor} in ${where} is not a list and was read as empty`);
        voices[vendor] = [];
        continue;
      }
      const kept: BootReportVoice[] = [];
      list.forEach((entry: unknown, index) => {
        const parsed = voiceSchema.safeParse(entry);
        if (parsed.success) kept.push(parsed.data);
        else dropped.push(`voice entry ${String(index + 1)} of ${vendor} in ${where} is malformed and was skipped`);
      });
      voices[vendor] = kept;
    }
  }

  return {
    id: columns.id,
    tenant_id: columns.tenant_id,
    booted_at: columns.booted_at,
    build_sha: columns.build_sha,
    fonnus_env: columns.fonnus_env,
    providers: columns.providers,
    vendors,
    voices,
    dropped,
  };
}

/** "as of boot at <booted_at>" — the part the `Unknown` options carry (D3, D4). */
export function asOfBootAt(report: BootReport): string {
  return `as of boot at ${formatWhen(report.booted_at)}`;
}

/** "as of boot at <booted_at>, build <build_sha>"; the caller prefixes "vendors" / "vendors and voices" (D5). */
export function asOfBoot(report: BootReport): string {
  return `${asOfBootAt(report)}, build ${shortSha(report.build_sha)}`;
}

/** `FONNUS_BUILD_SHA` of a snapshot, when it carries a non-empty string. */
function snapshotBuild(snapshot: Record<string, unknown> | null): string | null {
  const sha = snapshot?.['FONNUS_BUILD_SHA'];
  return typeof sha === 'string' && sha !== '' ? sha : null;
}

/**
 * The liveness trap of contract §2, rendered and never inferred (D5): text only
 * when the newest call started after the boot AND its snapshot names a
 * `FONNUS_BUILD_SHA` that differs from the report's. Before any call after the
 * boot, or with no build in the snapshot, the console has only half the check
 * and says nothing.
 */
export function staleReport(
  report: BootReport,
  lastCall: { started_at: Date; snapshot: Record<string, unknown> | null } | null,
): string | null {
  if (lastCall === null || lastCall.started_at <= report.booted_at) return null;
  const ran = snapshotBuild(lastCall.snapshot);
  if (ran === null || ran === report.build_sha) return null;
  return `The newest call (${formatWhen(lastCall.started_at)}) ran build ${shortSha(ran)}, not this report's ${shortSha(report.build_sha)}: the report may describe a process that is no longer answering calls. /healthz on the box is the live signal.`;
}

/** The value at a dotted path, or undefined when any step of it is absent. */
function valueAt(document: unknown, path: string): unknown {
  let node: unknown = document;
  for (const segment of path.split('.')) {
    if (!isObject(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * What the report says a row may name, as issues on the leaf paths the review
 * renders (D3, D4): a provider outside the report's vendors — the process would
 * refuse the whole row (`reason: provider`) — and a `tts.voice` outside the
 * chosen vendor's voice list when that vendor has one (`reason: invalid`).
 *
 * A provider the schema copy does not offer is left to the schema's own issue,
 * which comes first in the pipeline too. No report → no issue: the console
 * cannot check what it cannot read. A vendor with no voice list → no voice
 * issue. The voice check holds on a `fake` report as well: the row outlives the
 * process that wrote the report (D4, Rejected).
 */
export function offeredIssues(document: unknown, report: BootReport | null): DocumentIssue[] {
  if (report === null) return [];
  const asOf = asOfBoot(report);
  const issues: DocumentIssue[] = [];

  const legs = [
    { path: 'stt.provider', schema: STT_PROVIDER_VALUES as readonly string[], offered: report.vendors.stt },
    { path: 'tts.provider', schema: TTS_PROVIDER_VALUES as readonly string[], offered: report.vendors.tts },
  ];
  for (const { path, schema, offered } of legs) {
    const vendor = valueAt(document, path);
    if (typeof vendor !== 'string' || !schema.includes(vendor) || offered.includes(vendor)) continue;
    issues.push({
      path,
      message: `${vendor} is not offered by this box ${asOf}; the process would refuse the whole row (reason: provider)`,
    });
  }

  const vendor = valueAt(document, 'tts.provider');
  const voice = valueAt(document, 'tts.voice');
  if (typeof vendor === 'string' && typeof voice === 'string') {
    const list = report.voices[vendor] ?? [];
    // The schema copy trims the leaf, so the id the row would carry is trimmed.
    const id = voice.trim();
    if (list.length > 0 && id !== '' && !list.some((entry) => entry.id === id)) {
      issues.push({
        path: 'tts.voice',
        message: `${id} is not in ${vendor}'s voice list ${asOf}; the process would refuse the row at the next call (reason: invalid)`,
      });
    }
  }
  return issues;
}

/** D6: the label of a voice id under a vendor, or null when the report lists no such id. */
export function voiceLabel(report: BootReport | null, vendor: string, id: string): string | null {
  if (report === null) return null;
  return report.voices[vendor]?.find((entry) => entry.id === id)?.label ?? null;
}

/**
 * D6, the choice of which report labels a call's voice: the latest report
 * already is "the newest booted at or before the call" when it booted no later
 * than the call started; only when it booted after does a second read
 * (`bootReportBefore`) have anything to find. No latest report means the tenant
 * has none at all, so there is nothing older either.
 */
export function needsReportBefore(latest: BootReport | null, startedAt: Date): boolean {
  return latest !== null && latest.booted_at > startedAt;
}

/**
 * The effective voice id of a call's snapshot, labelled by the report D6 chose:
 * the label when that report lists the id under the call's own `TTS_PROVIDER`,
 * with a caveat when the report's build differs from the call's
 * `FONNUS_BUILD_SHA` — never withheld for it. An id no report knows gets no
 * label, and the bare id is shown.
 */
export function labelVoice(
  report: BootReport | null,
  snapshot: Record<string, unknown>,
  id: string,
): { label: string | null; labelCaveat: string | null } {
  const vendor = snapshot['TTS_PROVIDER'];
  const label = report === null || typeof vendor !== 'string' ? null : voiceLabel(report, vendor, id);
  if (report === null || label === null) return { label: null, labelCaveat: null };
  const ran = snapshotBuild(snapshot);
  const labelCaveat =
    ran === null || ran === report.build_sha
      ? null
      : `label from the boot report of build ${shortSha(report.build_sha)}, booted ${formatWhen(report.booted_at)}; the call ran build ${shortSha(ran)}`;
  return { label, labelCaveat };
}

/** The call detail's effective voice (D6, D8): which key, its id, the label, and the layer that chose it. */
export interface VoiceFact {
  key: 'CARTESIA_VOICE_ID' | 'ELEVENLABS_VOICE_ID';
  id: string;
  /** The label from the report booted before the call; null when no report knows the id. */
  label: string | null;
  /** The D6 caveat when the labelling report's build differs from the call's `FONNUS_BUILD_SHA`. */
  note: string | null;
  layer: Layer;
}

function isVoiceKey(key: unknown): key is VoiceFact['key'] {
  return key === 'CARTESIA_VOICE_ID' || key === 'ELEVENLABS_VOICE_ID';
}

/**
 * The effective voice of a call: which key and id by `voiceIdOf`, the one
 * voice rule the Overview's `voice` grouping uses too — the snapshot's own
 * `TTS_PROVIDER` picks the key, and a snapshot naming no known vendor takes
 * whichever voice key is present. The label comes from `report` — the one
 * booted at or before the call — by `labelVoice`; the layer is
 * `layerOf(snapshot, 'tts.voice')`.
 *
 * Null when there is nothing to say: no snapshot, or no voice id by that rule.
 */
export function voiceFact(
  snapshot: Record<string, unknown> | null,
  report: BootReport | null,
): VoiceFact | null {
  if (snapshot === null) return null;
  const voice = voiceIdOf(snapshot);
  if (voice === null || !isVoiceKey(voice.key)) return null;
  const { label, labelCaveat } = labelVoice(report, snapshot, voice.id);
  return {
    key: voice.key,
    id: voice.id,
    label,
    note: labelCaveat,
    layer: layerOf(snapshot, 'tts.voice'),
  };
}

/**
 * What the Configuration form is handed from the report — plain strings and
 * lists, so the client component formats no date and reaches for no query.
 * Null is the no-report state (D1).
 */
export interface Offered {
  vendors: { stt: string[]; tts: string[] };
  voices: Record<string, BootReportVoice[]>;
  /** "as of boot at <booted_at>, build <build_sha>" — the card line (D5). */
  asOf: string;
  /** "as of boot at <booted_at>" — what an `Unknown` option carries (D3, D4). */
  asOfAt: string;
  /** `dropped`: one line per malformed part skipped (D2). */
  caveats: string[];
}

export function offeredOf(report: BootReport | null): Offered | null {
  if (report === null) return null;
  return {
    vendors: report.vendors,
    voices: report.voices,
    asOf: asOfBoot(report),
    asOfAt: asOfBootAt(report),
    caveats: report.dropped,
  };
}

/**
 * The vendors a provider select offers (D3): with a report, its vendors in its
 * own (`/healthz`) order, kept only where the schema copy offers them too — a
 * vendor the copy lacks is the drift `contract-hash.test.ts` catches, offered
 * nowhere; without one, every vendor the schema copy offers.
 */
export function providerOptions(
  schema: readonly string[],
  offered: Offered | null,
  leg: 'stt' | 'tts',
): string[] {
  if (offered === null) return [...schema];
  return offered.vendors[leg].filter((vendor) => schema.includes(vendor));
}

/** The vendor's voice list when it has one to choose from, else null — the text box (D4). */
export function voiceList(offered: Offered | null, vendor: string): BootReportVoice[] | null {
  const list = offered?.voices[vendor] ?? [];
  return list.length === 0 ? null : list;
}

/**
 * The one merged `tts.voice` control of the no-script form (D4, ADR 0011 D4):
 * one group per TTS vendor the report offers, when every one of them has a
 * voice list. Null when a single vendor has none — a select cannot carry a
 * free id, so the text box stays the control that accepts every valid row.
 */
export function mergedVoices(
  offered: Offered | null,
): { vendor: string; list: BootReportVoice[] }[] | null {
  if (offered === null) return null;
  const groups: { vendor: string; list: BootReportVoice[] }[] = [];
  for (const vendor of providerOptions(TTS_PROVIDER_VALUES, offered, 'tts')) {
    const list = voiceList(offered, vendor);
    if (list === null) return null;
    groups.push({ vendor, list });
  }
  return groups.length === 0 ? null : groups;
}

/**
 * Why `tts.voice` is a text box, for its hint (D4): no report, or a vendor
 * whose list the report does not carry. Null when the voice is a select.
 */
export function voiceUncheckable(offered: Offered | null, vendors: readonly string[]): string | null {
  const prefix = 'the id cannot be checked against this box';
  if (offered === null) return `${prefix} — no boot report for this tenant`;
  const without = vendors.filter((vendor) => voiceList(offered, vendor) === null);
  if (without.length === 0) return null;
  return `${prefix} — this box's boot report lists no voice for ${without.join(', ')}`;
}
