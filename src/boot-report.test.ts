import { describe, expect, it } from 'vitest';
import {
  asOfBoot,
  labelVoice,
  mergedVoices,
  needsReportBefore,
  offeredIssues,
  offeredOf,
  parseBootReport,
  providerOptions,
  staleReport,
  voiceFact,
  voiceLabel,
  voiceList,
  voiceUncheckable,
  type BootReport,
} from './boot-report';
import { formatWhen } from './calls';
import { STT_PROVIDER_VALUES, TTS_PROVIDER_VALUES } from './contract/config/runtime-document';

/*
 * The pure half of ADR 0012: how a `boot_report` row is read, and every rule
 * the Configuration tab and the call detail draw from it. The row shape is
 * pipeline ADR 0029 D6's, in its own names.
 */

const BOOTED_AT = new Date('2026-09-23T01:00:00Z');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';

/** A `real` row of a box running deepgram and soniox, cartesia and elevenlabs. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '12',
    tenant_id: 'pilot',
    booted_at: BOOTED_AT,
    build_sha: SHA,
    fonnus_env: 'prod',
    providers: 'real',
    vendors: { stt: ['deepgram', 'soniox'], tts: ['cartesia', 'elevenlabs'] },
    voices: {
      cartesia: [
        { id: 'linh', label: 'Linh — nữ, miền Nam', is_default: true },
        { id: 'minh', label: 'Minh — nam, miền Bắc', is_default: false },
      ],
      elevenlabs: [{ id: 'ngoc', label: 'Ngọc', is_default: true }],
    },
    ...overrides,
  };
}

const REPORT: BootReport = parseBootReport(row());

describe('parseBootReport (D2)', () => {
  it('reads the ADR 0029 D6 shape as it is', () => {
    expect(REPORT).toEqual({
      id: '12',
      tenant_id: 'pilot',
      booted_at: BOOTED_AT,
      build_sha: SHA,
      fonnus_env: 'prod',
      providers: 'real',
      vendors: { stt: ['deepgram', 'soniox'], tts: ['cartesia', 'elevenlabs'] },
      voices: {
        cartesia: [
          { id: 'linh', label: 'Linh — nữ, miền Nam', is_default: true },
          { id: 'minh', label: 'Minh — nam, miền Bắc', is_default: false },
        ],
        elevenlabs: [{ id: 'ngoc', label: 'Ngọc', is_default: true }],
      },
      dropped: [],
    });
  });

  it('reads a bigint id handed over as a number, and a booted_at as text', () => {
    const report = parseBootReport(row({ id: 12, booted_at: '2026-09-23T01:00:00Z' }));
    expect(report.id).toBe('12');
    expect(report.booted_at).toEqual(BOOTED_AT);
  });

  it('drops a malformed voice entry and names it, keeping the rest in order', () => {
    const report = parseBootReport(
      row({
        voices: {
          cartesia: [
            { id: 'linh', label: 'Linh', is_default: true },
            { id: 'bad', label: 7, is_default: false },
            { id: 'minh', label: 'Minh', is_default: false },
          ],
        },
      }),
    );
    expect(report.voices['cartesia']?.map((voice) => voice.id)).toEqual(['linh', 'minh']);
    expect(report.dropped).toEqual([
      'voice entry 2 of cartesia in boot report #12 is malformed and was skipped',
    ]);
  });

  it('reads a vendor missing from voices, or with [], as a vendor with no voice list', () => {
    const report = parseBootReport(
      row({ providers: 'fake', voices: { cartesia: [] } }),
    );
    expect(report.voices['cartesia']).toEqual([]);
    expect(report.voices['elevenlabs']).toBeUndefined();
    expect(report.dropped).toEqual([]);
  });

  it('reads vendors that is not an object as empty lists, with a caveat', () => {
    const report = parseBootReport(row({ vendors: ['deepgram'] }));
    expect(report.vendors).toEqual({ stt: [], tts: [] });
    expect(report.dropped).toEqual(['vendors in boot report #12 is not an object and was read as empty']);
  });

  it('reads voices that is not an object as empty, with a caveat', () => {
    const report = parseBootReport(row({ voices: 'none' }));
    expect(report.voices).toEqual({});
    expect(report.dropped).toEqual(['voices in boot report #12 is not an object and was read as empty']);
  });

  it('skips a vendor name that is not a string, and a vendor list that is not a list', () => {
    const report = parseBootReport(row({ vendors: { stt: ['deepgram', 3], tts: 'cartesia' } }));
    expect(report.vendors).toEqual({ stt: ['deepgram'], tts: [] });
    expect(report.dropped).toEqual([
      'stt vendor entry 2 in boot report #12 is malformed and was skipped',
      'vendors.tts in boot report #12 is not a list and was read as empty',
    ]);
  });
});

describe('asOfBoot', () => {
  it('names the boot time and the short build', () => {
    expect(asOfBoot(REPORT)).toBe(`as of boot at ${formatWhen(BOOTED_AT)}, build 0123456`);
  });
});

describe('staleReport (D5)', () => {
  const after = new Date('2026-09-23T02:00:00Z');

  it('says nothing before any call', () => {
    expect(staleReport(REPORT, null)).toBeNull();
  });

  it('says nothing when the newest call started before the boot', () => {
    const before = new Date('2026-09-22T23:00:00Z');
    expect(staleReport(REPORT, { started_at: before, snapshot: { FONNUS_BUILD_SHA: OTHER_SHA } })).toBeNull();
  });

  it('says nothing when the call after the boot records no FONNUS_BUILD_SHA', () => {
    expect(staleReport(REPORT, { started_at: after, snapshot: { STT_PROVIDER: 'deepgram' } })).toBeNull();
    expect(staleReport(REPORT, { started_at: after, snapshot: null })).toBeNull();
  });

  it('says nothing when the call ran the report’s build', () => {
    expect(staleReport(REPORT, { started_at: after, snapshot: { FONNUS_BUILD_SHA: SHA } })).toBeNull();
  });

  it('names the call’s start and both builds when they differ', () => {
    const text = staleReport(REPORT, { started_at: after, snapshot: { FONNUS_BUILD_SHA: OTHER_SHA } });
    expect(text).toBe(
      `The newest call (${formatWhen(after)}) ran build fedcba9, not this report's 0123456: the report may describe a process that is no longer answering calls. /healthz on the box is the live signal.`,
    );
  });
});

describe('offeredIssues (D3, D4)', () => {
  const narrow = parseBootReport(
    row({
      vendors: { stt: ['deepgram'], tts: ['cartesia', 'elevenlabs'] },
      voices: { cartesia: [{ id: 'linh', label: 'Linh', is_default: true }], elevenlabs: [] },
    }),
  );

  it('checks nothing without a report', () => {
    expect(offeredIssues({ stt: { provider: 'soniox' }, tts: { provider: 'cartesia', voice: 'x' } }, null)).toEqual([]);
  });

  it('refuses a provider outside the report’s vendors, in the provider wording', () => {
    expect(offeredIssues({ stt: { provider: 'soniox' } }, narrow)).toEqual([
      {
        path: 'stt.provider',
        message: `soniox is not offered by this box ${asOfBoot(narrow)}; the process would refuse the whole row (reason: provider)`,
      },
    ]);
  });

  it('leaves a provider outside the schema to the schema’s own issue', () => {
    expect(offeredIssues({ stt: { provider: 'whisper' } }, narrow)).toEqual([]);
  });

  it('refuses a voice outside the chosen vendor’s list, in the invalid wording', () => {
    expect(offeredIssues({ tts: { provider: 'cartesia', voice: 'ngoc' } }, narrow)).toEqual([
      {
        path: 'tts.voice',
        message: `ngoc is not in cartesia's voice list ${asOfBoot(narrow)}; the process would refuse the row at the next call (reason: invalid)`,
      },
    ]);
  });

  it('takes a listed voice, trimmed as the schema would store it', () => {
    expect(offeredIssues({ tts: { provider: 'cartesia', voice: ' linh ' } }, narrow)).toEqual([]);
  });

  it('cannot refuse a voice of a vendor with no voice list, nor one of a vendor absent from voices', () => {
    expect(offeredIssues({ tts: { provider: 'elevenlabs', voice: 'anything' } }, narrow)).toEqual([]);
    const noKey = parseBootReport(row({ voices: {} }));
    expect(offeredIssues({ tts: { provider: 'cartesia', voice: 'anything' } }, noKey)).toEqual([]);
  });

  it('checks the voice list on a fake report too — the row outlives it', () => {
    const fake = parseBootReport(row({ providers: 'fake' }));
    expect(offeredIssues({ tts: { provider: 'cartesia', voice: 'ngoc' } }, fake).map((i) => i.path)).toEqual([
      'tts.voice',
    ]);
  });

  it('checks nothing in an empty document — boot config names no vendor', () => {
    expect(offeredIssues({}, narrow)).toEqual([]);
  });
});

describe('voiceLabel (D6)', () => {
  it('finds the label under the vendor', () => {
    expect(voiceLabel(REPORT, 'cartesia', 'minh')).toBe('Minh — nam, miền Bắc');
  });

  it('answers null for an id the vendor does not list, another vendor’s id, and no report', () => {
    expect(voiceLabel(REPORT, 'cartesia', 'nobody')).toBeNull();
    expect(voiceLabel(REPORT, 'elevenlabs', 'linh')).toBeNull();
    expect(voiceLabel(null, 'cartesia', 'linh')).toBeNull();
  });

  it('reads a vendor as an own key the schema names, never through the prototype', () => {
    expect(voiceLabel(REPORT, 'constructor', 'linh')).toBeNull();
    expect(voiceList(offeredOf(REPORT), 'toString')).toBeNull();
    // A `__proto__` key in the column stays a key, and is still no vendor.
    const report = parseBootReport(row({ voices: JSON.parse('{"__proto__":[{"id":"x","label":"X","is_default":true}]}') as unknown }));
    expect(Object.getPrototypeOf(report.voices)).toBe(Object.prototype);
    expect(voiceLabel(report, '__proto__', 'x')).toBeNull();
  });
});

describe('which report labels the last call’s voice (D6)', () => {
  it('needs a second read only when the latest report booted after the call', () => {
    expect(needsReportBefore(REPORT, new Date('2026-09-23T02:00:00Z'))).toBe(false);
    expect(needsReportBefore(REPORT, BOOTED_AT)).toBe(false);
    expect(needsReportBefore(REPORT, new Date('2026-09-22T23:00:00Z'))).toBe(true);
    expect(needsReportBefore(null, BOOTED_AT)).toBe(false);
  });

  it('labels by the call’s own TTS_PROVIDER, with no caveat on the same build', () => {
    expect(labelVoice(REPORT, { TTS_PROVIDER: 'cartesia', FONNUS_BUILD_SHA: SHA }, 'linh')).toEqual({
      label: 'Linh — nữ, miền Nam',
      labelCaveat: null,
    });
  });

  it('keeps the label and names both builds when they differ', () => {
    expect(labelVoice(REPORT, { TTS_PROVIDER: 'cartesia', FONNUS_BUILD_SHA: OTHER_SHA }, 'linh')).toEqual({
      label: 'Linh — nữ, miền Nam',
      labelCaveat: `label from the boot report of build 0123456, booted ${formatWhen(BOOTED_AT)}; the call ran build fedcba9`,
    });
  });

  it('gives no label for an id no report knows, or a snapshot naming no vendor', () => {
    expect(labelVoice(REPORT, { TTS_PROVIDER: 'cartesia', FONNUS_BUILD_SHA: OTHER_SHA }, 'nobody')).toEqual({
      label: null,
      labelCaveat: null,
    });
    expect(labelVoice(REPORT, {}, 'linh')).toEqual({ label: null, labelCaveat: null });
    expect(labelVoice(null, { TTS_PROVIDER: 'cartesia' }, 'linh')).toEqual({ label: null, labelCaveat: null });
  });
});

describe('voiceFact — the call detail’s effective voice (D6, D8)', () => {
  it('reads the cartesia key of a cartesia call and labels it from the report', () => {
    const snapshot = { TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'minh', FONNUS_BUILD_SHA: SHA };
    expect(voiceFact(snapshot, REPORT)).toEqual({
      key: 'CARTESIA_VOICE_ID',
      id: 'minh',
      label: 'Minh — nam, miền Bắc',
      note: null,
      layer: { kind: 'boot' },
    });
  });

  it('reads the elevenlabs key of an elevenlabs call', () => {
    const snapshot = { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_VOICE_ID: 'ngoc', FONNUS_BUILD_SHA: SHA };
    expect(voiceFact(snapshot, REPORT)).toEqual({
      key: 'ELEVENLABS_VOICE_ID',
      id: 'ngoc',
      label: 'Ngọc',
      note: null,
      layer: { kind: 'boot' },
    });
  });

  it('never reads another vendor’s key in place of the call’s own (contract §3.4)', () => {
    expect(voiceFact({ TTS_PROVIDER: 'elevenlabs', CARTESIA_VOICE_ID: 'linh' }, REPORT)).toBeNull();
  });

  it('says nothing without a snapshot or a non-empty string id', () => {
    expect(voiceFact(null, REPORT)).toBeNull();
    expect(voiceFact({ TTS_PROVIDER: 'fake' }, REPORT)).toBeNull();
    expect(voiceFact({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 7 }, REPORT)).toBeNull();
    expect(voiceFact({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: '' }, REPORT)).toBeNull();
  });

  it('reads the present voice key when the snapshot names no known vendor, as the Overview does', () => {
    expect(voiceFact({ CARTESIA_VOICE_ID: 'linh' }, REPORT)?.id).toBe('linh');
    expect(voiceFact({ TTS_PROVIDER: 'fake', ELEVENLABS_VOICE_ID: 'ngoc' }, REPORT)?.key).toBe(
      'ELEVENLABS_VOICE_ID',
    );
  });

  it('gives the bare id, and no caveat, when no report is there', () => {
    expect(voiceFact({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'linh', FONNUS_BUILD_SHA: OTHER_SHA }, null)).toEqual({
      key: 'CARTESIA_VOICE_ID',
      id: 'linh',
      label: null,
      note: null,
      layer: { kind: 'boot' },
    });
  });

  it('keeps the label and adds the D6 caveat when the report’s build differs', () => {
    const fact = voiceFact(
      { TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'linh', FONNUS_BUILD_SHA: OTHER_SHA },
      REPORT,
    );
    expect(fact?.label).toBe('Linh — nữ, miền Nam');
    expect(fact?.note).toBe(
      `label from the boot report of build 0123456, booted ${formatWhen(BOOTED_AT)}; the call ran build fedcba9`,
    );
  });

  it('names the row when runtime.config carries tts.voice, boot when it does not', () => {
    const base = { TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'minh' };
    expect(
      voiceFact({ ...base, runtime: { version: 41, config: { tts: { provider: 'cartesia', voice: 'minh' } } } }, REPORT)
        ?.layer,
    ).toEqual({ kind: 'row', version: '41' });
    expect(
      voiceFact({ ...base, runtime: { version: 41, config: { tts: { provider: 'cartesia' } } } }, REPORT)?.layer,
    ).toEqual({ kind: 'boot' });
  });
});

describe('what the form offers (D3, D4)', () => {
  const offered = offeredOf(
    parseBootReport(
      row({
        vendors: { stt: ['soniox', 'whisper'], tts: ['elevenlabs', 'cartesia'] },
        voices: {
          cartesia: [
            { id: 'linh', label: 'Linh', is_default: false },
            { id: 'minh', label: 'Minh', is_default: true },
          ],
          elevenlabs: [],
        },
      }),
    ),
  );

  it('hands the form the report and its words, or null for the no-report state', () => {
    expect(offeredOf(null)).toBeNull();
    expect(offered?.asOf).toBe(`as of boot at ${formatWhen(BOOTED_AT)}, build 0123456`);
    expect(offered?.asOfAt).toBe(`as of boot at ${formatWhen(BOOTED_AT)}`);
  });

  it('offers the report’s vendors in its order, only where the schema copy offers them', () => {
    expect(providerOptions(STT_PROVIDER_VALUES, offered, 'stt')).toEqual(['soniox']);
    expect(providerOptions(TTS_PROVIDER_VALUES, offered, 'tts')).toEqual(['elevenlabs', 'cartesia']);
  });

  it('offers every vendor of the schema copy without a report', () => {
    expect(providerOptions(STT_PROVIDER_VALUES, null, 'stt')).toEqual([...STT_PROVIDER_VALUES]);
  });

  it('gives a vendor a select only when its list has entries', () => {
    expect(voiceList(offered, 'cartesia')?.map((voice) => voice.id)).toEqual(['linh', 'minh']);
    expect(voiceList(offered, 'elevenlabs')).toBeNull();
    expect(voiceList(null, 'cartesia')).toBeNull();
  });

  it('merges every offered vendor’s list for the no-script form, or none when one lacks a list', () => {
    expect(mergedVoices(offered)).toBeNull();
    expect(mergedVoices(null)).toBeNull();
    const both = offeredOf(REPORT);
    expect(mergedVoices(both)?.map(({ vendor, list }) => [vendor, list.length])).toEqual([
      ['cartesia', 2],
      ['elevenlabs', 1],
    ]);
  });

  it('says why the voice is a text box', () => {
    expect(voiceUncheckable(null, ['cartesia'])).toBe(
      'the id cannot be checked against this box — no boot report for this tenant',
    );
    expect(voiceUncheckable(offered, ['elevenlabs'])).toBe(
      "the id cannot be checked against this box — this box's boot report lists no voice for elevenlabs",
    );
    expect(voiceUncheckable(offered, ['cartesia'])).toBeNull();
  });
});
