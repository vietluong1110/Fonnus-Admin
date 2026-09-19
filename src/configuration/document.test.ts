import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  diffDocuments,
  documentFromForm,
  fieldsOf,
  formFromDocument,
  leafPaths,
  mergeBranches,
  parseDocument,
  ranOn,
  type Field,
} from './document';
import { SHIPPED_TEXT } from '@/contract/config/runtime-document';

/*
 * The Configuration form's pure half. The fields are generated from the copied
 * schema, so most of what is asserted here is that the WALK reads the schema —
 * a hand-written expectation of each leaf would be the second schema ADR 0011
 * decision 4 exists to avoid.
 */

const field = (path: string, vendor?: string): Field => {
  const found = fieldsOf().find((f) => f.path === path && (vendor === undefined || f.vendor === vendor));
  if (found === undefined) throw new Error(`no field ${path}`);
  return found;
};

const form = (entries: Record<string, string>): Record<string, unknown> =>
  documentFromForm(Object.entries(entries));

describe('fieldsOf', () => {
  it('covers every leaf of every group, once per branch that carries it', () => {
    const fields = fieldsOf();
    const byGroup = (group: string) => fields.filter((f) => f.group === group);
    // 11 turn leaves; stt = the discriminator plus the three branches' leaves
    // (8 deepgram, 7 soniox, 6 speechmatics); llm = model, fallback and five
    // params; tts = the discriminator plus 7 cartesia and 10 elevenlabs; the
    // five texts. A leaf the pipeline adds moves one of these numbers.
    expect(byGroup('turn')).toHaveLength(11);
    expect(byGroup('stt')).toHaveLength(22);
    expect(byGroup('llm')).toHaveLength(7);
    expect(byGroup('tts')).toHaveLength(18);
    expect(byGroup('text')).toHaveLength(5);
    // The shared paths are one path with one field per branch.
    expect(leafPaths()).toHaveLength(54);
    expect(fields.filter((f) => f.path === 'stt.params.language').map((f) => f.vendor)).toEqual([
      'deepgram',
      'soniox',
      'speechmatics',
    ]);
  });

  it('reads the discriminator as a field of its own, outside every branch', () => {
    expect(field('stt.provider')).toMatchObject({
      vendor: null,
      kind: 'enum',
      options: ['deepgram', 'soniox', 'speechmatics'],
      flatKey: 'STT_PROVIDER',
    });
    expect(field('tts.provider').options).toEqual(['cartesia', 'elevenlabs']);
  });

  it('reads each kind, its options and its bounds from the leaf schema', () => {
    // `z.int().positive()`: an integer above zero, the bound exclusive.
    expect(field('turn.max_call_duration_sec')).toMatchObject({
      kind: 'integer',
      min: 0,
      minExclusive: true,
      max: null,
    });
    // `z.number().min(-1).max(1)`: both bounds inclusive, not an integer.
    expect(field('stt.params.endpoint_sensitivity')).toMatchObject({
      kind: 'number',
      min: -1,
      max: 1,
      minExclusive: false,
      maxExclusive: false,
    });
    // `z.number().gt(0).max(1)`: the one leaf with one bound of each kind.
    expect(field('llm.params.top_p')).toMatchObject({
      min: 0,
      minExclusive: true,
      max: 1,
      maxExclusive: false,
    });
    expect(field('turn.barge_in_enabled').kind).toBe('boolean');
    expect(field('llm.params.reasoning')).toMatchObject({ kind: 'enum' });
    expect(field('llm.params.reasoning').options).toContain('omit');
    expect(field('stt.params.keyterms').kind).toBe('list');
    expect(field('stt.params.sounds_like').kind).toBe('record');
    expect(field('llm.model').kind).toBe('text');
    expect(field('text.greeting').kind).toBe('textarea');
  });

  it('gives a string leaf a box or a line by the length it accepts, not by its group', () => {
    // 2000 characters of biasing text, outside the `text` group: a box.
    expect(field('stt.params.context_text', 'soniox').kind).toBe('textarea');
    // At most 128, and a model id has no maximum at all: one line each.
    expect(field('tts.params.pronunciation_dict_id', 'cartesia').kind).toBe('text');
    expect(field('llm.model').kind).toBe('text');
    expect(field('llm.fallback_model').kind).toBe('text');
    expect(field('stt.params.language', 'deepgram').kind).toBe('text');
  });

  it('bounds the same path differently in each vendor branch — the reason the branches exist', () => {
    expect(field('tts.params.speed', 'cartesia')).toMatchObject({ min: 0.6, max: 1.5 });
    expect(field('tts.params.speed', 'elevenlabs')).toMatchObject({ min: 0.7, max: 1.2 });
    expect(field('stt.model', 'deepgram').options).toEqual(['nova-3']);
    expect(field('stt.model', 'soniox').options).toEqual(['stt-rt-v5']);
  });
});

describe('mergeBranches — the control a shared path renders without JavaScript', () => {
  const branchesOf = (path: string): Field[] => fieldsOf().filter((f) => f.path === path);

  it('offers every branch\u2019s options, deduplicated, in declaration order', () => {
    const branches = branchesOf('stt.model');
    const { field: merged } = mergeBranches(branches);
    // Deepgram's catalogue alone would mark a stored Soniox model as one this
    // build does not offer — a false sentence on the screen.
    expect(merged.options).toEqual([...new Set(branches.flatMap((b) => b.options ?? []))]);
    for (const branch of branches) {
      for (const option of branch.options ?? []) expect(merged.options).toContain(option);
    }
  });

  it('carries no bound of its own and names each vendor\u2019s in the hint', () => {
    const merge = mergeBranches(branchesOf('tts.params.speed'));
    // A `min`/`max` attribute from one vendor would refuse a value another
    // vendor accepts; the schema refuses the wrong one at review instead.
    expect(merge.field.min).toBeNull();
    expect(merge.field.max).toBeNull();
    expect(merge.vendorBounds).toBe('cartesia 0.6\u20131.5 · elevenlabs 0.7\u20131.2');
  });

  it('leaves a path only one branch carries exactly as it is', () => {
    const branches = branchesOf('stt.params.endpointing_ms');
    expect(branches).toHaveLength(1);
    expect(mergeBranches(branches)).toEqual({ field: branches[0], vendorBounds: null });
  });
});

describe('formFromDocument', () => {
  it('ticks the leaves the document carries and renders each as its control shows it', () => {
    const { values, set } = formFromDocument({
      turn: { max_turns_per_call: 12, barge_in_enabled: false },
      stt: { provider: 'speechmatics', params: { sounds_like: { amoxicillin: ['a mốc'] } } },
      llm: { params: { stop: ['Người gọi:', 'Khách:'] } },
    });
    expect(set).toEqual([
      'turn.max_turns_per_call',
      'turn.barge_in_enabled',
      'stt.provider',
      'stt.params.sounds_like',
      'llm.params.stop',
    ]);
    expect(values['turn.max_turns_per_call']).toBe('12');
    expect(values['turn.barge_in_enabled']).toBe('false');
    expect(values['llm.params.stop']).toBe('Người gọi:\nKhách:');
    expect(values['stt.params.sounds_like']).toBe(
      JSON.stringify({ amoxicillin: ['a mốc'] }, null, 2),
    );
  });

  it('cannot carry a list entry that contains a line break — one entry is one line', () => {
    // A `llm.params.stop` of `"\n\n"` is legal in a stored row and has no
    // spelling in a one-entry-per-line control: it prefills as blank lines and
    // comes back as nothing. Pinned so the limitation is a known one; the fix,
    // if an operator ever needs that stop sequence, is a decision about the
    // control, not about this function.
    const { values } = formFromDocument({ llm: { params: { stop: ['\n\n'] } } });
    expect(values['llm.params.stop']).toBe('\n\n');
    expect(documentFromForm([['set:llm.params.stop', 'on'], ['llm.params.stop', '\n\n']])).toEqual({
      llm: { params: { stop: [] } },
    });
  });

  it('ticks nothing for the empty document — every leaf is the boot value', () => {
    expect(formFromDocument({})).toEqual({ values: {}, set: [] });
  });
});

describe('documentFromForm', () => {
  it('takes only the ticked leaves, nested into their groups', () => {
    expect(
      form({
        'set:turn.max_reprompts': 'on',
        'turn.max_reprompts': '2',
        // Present in the submission but not ticked: absent from the document,
        // which is what "the boot value applies" is written as (§3.4).
        'turn.max_turns_per_call': '20',
        'set:stt.provider': 'on',
        'stt.provider': 'deepgram',
        'set:stt.params.keyterms': 'on',
        'stt.params.keyterms': ' nhi khoa \n\n tai mũi họng \n',
        'set:turn.barge_in_enabled': 'on',
        'turn.barge_in_enabled': 'false',
      }),
    ).toEqual({
      turn: { max_reprompts: 2, barge_in_enabled: false },
      stt: { provider: 'deepgram', params: { keyterms: ['nhi khoa', 'tai mũi họng'] } },
    });
  });

  it('keeps a value it cannot coerce as the raw string, so the schema reports it on its path', () => {
    const document = form({
      'set:turn.max_reprompts': 'on',
      'turn.max_reprompts': 'two',
      'set:stt.provider': 'on',
      'stt.provider': 'speechmatics',
      'set:stt.params.sounds_like': 'on',
      'stt.params.sounds_like': '{not json',
    });
    expect(document).toMatchObject({ turn: { max_reprompts: 'two' } });

    const parsed = parseDocument(document);
    if (parsed.ok) throw new Error('expected the document to be refused');
    expect(parsed.issues.map((issue) => issue.path)).toContain('turn.max_reprompts');
    expect(parsed.issues.map((issue) => issue.path)).toContain('stt.params.sounds_like');
  });

  it('keeps a ticked leaf of another vendor, which the schema then refuses by name', () => {
    // ADR 0011 decision 4: with JavaScript off every branch renders, and the
    // schema — `strictObject` at every level — is what refuses the wrong one.
    // A silent drop would lose the edit without telling the operator.
    const document = form({
      'set:tts.provider': 'on',
      'tts.provider': 'cartesia',
      'set:tts.params.stability': 'on',
      'tts.params.stability': '0.5',
    });
    expect(document).toEqual({ tts: { provider: 'cartesia', params: { stability: 0.5 } } });

    const parsed = parseDocument(document);
    if (parsed.ok) throw new Error('expected the document to be refused');
    expect(parsed.issues[0]?.path).toBe('tts.params');
    expect(parsed.issues[0]?.message).toContain('stability');
  });
});

describe('parseDocument', () => {
  it('accepts the empty document — no row and a {} row both mean boot config', () => {
    expect(parseDocument({})).toEqual({ ok: true, document: {} });
  });

  it('runs the pipeline’s own cross-field rules on their leaf path', () => {
    const parsed = parseDocument({
      tts: { provider: 'elevenlabs', params: { pronunciation_dict_id: 'dict-1' } },
    });
    if (parsed.ok) throw new Error('expected the document to be refused');
    expect(parsed.issues[0]?.path).toBe('tts.params.pronunciation_dict_version_id');
  });
});

describe('diffDocuments', () => {
  it('reports every leaf of the proposed document as added when the form started empty', () => {
    const to = { turn: { max_reprompts: 1 }, text: { greeting: 'Xin chào' } };
    expect(diffDocuments({}, to)).toEqual([
      { path: 'turn.max_reprompts', change: 'added', from: undefined, to: 1 },
      { path: 'text.greeting', change: 'added', from: undefined, to: 'Xin chào' },
    ]);
  });

  it('reports a dropped leaf as removed and an equal one not at all', () => {
    const from = { turn: { max_reprompts: 1, max_turns_per_call: 20 } };
    const to = { turn: { max_turns_per_call: 20 } };
    expect(diffDocuments(from, to)).toEqual([
      { path: 'turn.max_reprompts', change: 'removed', from: 1, to: undefined },
    ]);
  });

  it('compares by value, not by key order, and keeps list order as meaning', () => {
    const from = { stt: { provider: 'speechmatics', params: { sounds_like: { a: ['x'], b: ['y'] } } } };
    const to = { stt: { provider: 'speechmatics', params: { sounds_like: { b: ['y'], a: ['x'] } } } };
    expect(diffDocuments(from, to)).toEqual([]);
    expect(
      diffDocuments({ llm: { params: { stop: ['a', 'b'] } } }, { llm: { params: { stop: ['b', 'a'] } } }),
    ).toHaveLength(1);
  });

  it('shows a key the schema does not name rather than dropping it (trap 6)', () => {
    const diff = diffDocuments({}, { turn: { max_reprompts: 1 }, stt: { legacy_knob: 3 } });
    expect(diff.map((entry) => entry.path)).toEqual(['turn.max_reprompts', 'stt.legacy_knob']);
  });

  it('reports nothing for a group that holds no leaf — an object is not a leaf', () => {
    // A stored `{"turn":{}}` sets no leaf at all, so it says exactly what `{}`
    // says; "removed turn" would be a change the operator never made.
    expect(diffDocuments({ turn: {} }, {})).toEqual([]);
    expect(diffDocuments({}, { turn: {} })).toEqual([]);
  });
});

describe('adviceFor', () => {
  it('advises on a greeting that stops naming the recording, and still parses', () => {
    const greeting = 'Xin chào, đây là phòng khám. Em là trợ lý AI. Em có thể giúp gì ạ?';
    const parsed = parseDocument({ text: { greeting } });
    if (!parsed.ok) throw new Error('the greeting is legal — the disclosure is advice, not a refusal');
    const advice = adviceFor({}, parsed.document);
    expect(advice).toHaveLength(1);
    expect(advice[0]).toContain('ghi âm');
  });

  it('says nothing about the shipped greeting', () => {
    const parsed = parseDocument({ text: { greeting: SHIPPED_TEXT.greeting } });
    if (!parsed.ok) throw new Error('the shipped greeting must parse');
    expect(adviceFor({}, parsed.document)).toEqual([]);
  });

  it('advises when the model changed and the row does not set reasoning', () => {
    const parsed = parseDocument({ llm: { model: 'openai/gpt-oss-120b' } });
    if (!parsed.ok) throw new Error('a model id is free text');
    const advice = adviceFor({ llm: { model: 'qwen/qwen3.5-397b' } }, parsed.document);
    expect(advice).toHaveLength(1);
    expect(advice[0]).toContain('llm.params.reasoning');
  });

  it('says nothing when the model changed and reasoning came with it', () => {
    const parsed = parseDocument({
      llm: { model: 'openai/gpt-oss-120b', params: { reasoning: 'off' } },
    });
    if (!parsed.ok) throw new Error('a model id is free text');
    expect(adviceFor({ llm: { model: 'qwen/qwen3.5-397b' } }, parsed.document)).toEqual([]);
  });
});

describe('ranOn', () => {
  it('reads a renamed key under the spelling the old snapshot carries', () => {
    expect(ranOn({ STT_ENDPOINTING_MS: '300' }, field('stt.params.endpointing_ms'))).toBe('300');
    expect(ranOn({ DEEPGRAM_ENDPOINTING_MS: '250' }, field('stt.params.endpointing_ms'))).toBe('250');
  });

  it('resolves a per-vendor key by the snapshot’s own provider, per leg', () => {
    const snapshot = {
      STT_PROVIDER: 'soniox',
      SONIOX_MODEL: 'stt-rt-v5',
      DEEPGRAM_MODEL: 'nova-3',
      TTS_PROVIDER: 'elevenlabs',
      ELEVENLABS_SPEED: '1.1',
      CARTESIA_SPEED: '1.0',
    };
    expect(ranOn(snapshot, field('stt.model', 'deepgram'))).toBe('stt-rt-v5');
    expect(ranOn(snapshot, field('tts.params.speed', 'cartesia'))).toBe('1.1');
  });

  it('answers undefined for a key the snapshot lacks, for a snapshot with no provider, and for no snapshot', () => {
    expect(ranOn({ STT_PROVIDER: 'deepgram' }, field('stt.params.punctuate'))).toBeUndefined();
    expect(ranOn({}, field('stt.model', 'deepgram'))).toBeUndefined();
    expect(ranOn(null, field('turn.max_reprompts'))).toBeUndefined();
  });
});
