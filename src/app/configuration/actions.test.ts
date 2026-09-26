import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The server action of ADR 0011 decision 5 — the dispatcher, not the pure
 * functions it calls (those are pinned in `src/configuration/document.test.ts`).
 * What is under test here is the safety of the save path: the account gate, the
 * second parse of the client-held document, the refusal sentences that reach
 * the screen instead of a thrown page, and the order of `revalidatePath` and
 * `redirect`.
 *
 * Postgres, the request headers and Next's cache are all mocked: no socket is
 * opened and no row is written by this suite.
 */

const revalidatePath = vi.fn();
const redirect = vi.fn();
const insertRuntimeConfig = vi.fn();
const requireAccount = vi.fn();
const latestBootReport = vi.fn();
const newestRuntimeConfig = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/writes/runtime-config', () => ({ insertRuntimeConfig }));
vi.mock('@/queries/boot-report', () => ({ latestBootReport }));
vi.mock('@/queries/runtime-config', () => ({ newestRuntimeConfig }));
vi.mock('@/account', () => {
  // The real class, because the action tells "no account" from every other
  // failure by `instanceof` — a plain Error here would be rethrown.
  class NoAccountError extends Error {
    constructor() {
      super('no account on this request');
      this.name = 'NoAccountError';
    }
  }
  return { NoAccountError, requireAccount };
});

const { submitConfiguration } = await import('./actions');
const { parseBootReport } = await import('@/boot-report');

/** A box that runs deepgram and cartesia only, with two cartesia voices. */
const REPORT = parseBootReport({
  id: '9',
  tenant_id: 'pilot',
  booted_at: new Date('2026-09-23T01:00:00Z'),
  build_sha: 'abc1234',
  fonnus_env: 'prod',
  providers: 'real',
  vendors: { stt: ['deepgram'], tts: ['cartesia'] },
  voices: {
    cartesia: [
      { id: 'linh', label: 'Linh', is_default: true },
      { id: 'minh', label: 'Minh', is_default: false },
    ],
  },
});

type State = Awaited<ReturnType<typeof submitConfiguration>>;

const EDIT: State = { step: 'edit', tenant: 'pilot', group: 'turn', values: {}, failure: null };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function submit(entries: Record<string, string>): Promise<State> {
  return submitConfiguration(EDIT, form(entries));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAccount.mockResolvedValue('lesky');
  insertRuntimeConfig.mockResolvedValue({ ok: true, id: '42', createdAt: new Date() });
  latestBootReport.mockResolvedValue(null);
  newestRuntimeConfig.mockResolvedValue(null);
});

/** The tenant's newest row, as the action reads it for itself. */
function newestIs(config: Record<string, unknown>, id = '7'): void {
  newestRuntimeConfig.mockResolvedValue({ id, config });
}

describe('review', () => {
  it('builds the document, the diff and the advice, and writes nothing', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      'turn.max_reprompts': '3',
      'llm.model': 'openai/gpt-oss-120b',
    });

    expect(state.step).toBe('review');
    if (state.step !== 'review') return;
    expect(state.document).toEqual({
      turn: { max_reprompts: 3 },
      llm: { model: 'openai/gpt-oss-120b' },
    });
    expect(state.issues).toEqual([]);
    expect(state.diff).toEqual([
      { path: 'turn.max_reprompts', change: 'added', from: undefined, to: 3 },
      { path: 'llm.model', change: 'added', from: undefined, to: 'openai/gpt-oss-120b' },
    ]);
    // The runbook §10 rule the schema deliberately does not enforce: advice.
    expect(state.advice.join(' ')).toContain('llm.params.reasoning');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });

  it('keeps the form as submitted, so Edit gives it back leaf for leaf', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      'turn.max_reprompts': '3',
      // Plumbing, never part of the document or of the form's values.
      note: 'shorter reprompts',
    });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.values).toEqual({ 'turn.max_reprompts': '3' });
    expect(state.note).toBe('shorter reprompts');
  });

  it('reports an issue on its own leaf and offers no advice while one stands', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      // A number that does not parse stays the raw string, so the schema
      // reports on the leaf rather than the form sending something else.
      'turn.max_reprompts': 'three',
      'text.greeting': 'Xin chào.',
    });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues.map((issue) => issue.path)).toContain('turn.max_reprompts');
    // The greeting would otherwise yield disclosure advice; an unparsed
    // document has none, because there is nothing to advise on yet.
    expect(state.advice).toEqual([]);
  });

  it('proposes the empty document when nothing is ticked — "back to boot config"', async () => {
    newestIs({ turn: { max_reprompts: 3 } });
    const state = await submit({ tenant: 'pilot', intent: 'review' });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.document).toEqual({});
    expect(state.diff).toEqual([
      { path: 'turn.max_reprompts', change: 'removed', from: 3, to: undefined },
    ]);
  });
});

describe('review carries what the save would insert (ADR 0012 D7)', () => {
  const TRIMMED = {
    tenant: 'pilot',
    intent: 'review',
    'stt.provider': 'soniox',
    'stt.params.context_text': 'dental clinic ',
    'tts.provider': 'cartesia',
    'tts.voice': ' a0e99841 ',
  };

  it('reviews, diffs and hands back the parsed document — trimmed', async () => {
    const state = await submit(TRIMMED);
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues).toEqual([]);
    expect(state.document).toEqual({
      stt: { provider: 'soniox', params: { context_text: 'dental clinic' } },
      tts: { provider: 'cartesia', voice: 'a0e99841' },
    });
    expect(state.diff.find((entry) => entry.path === 'tts.voice')?.to).toBe('a0e99841');
    expect(state.diff.find((entry) => entry.path === 'stt.params.context_text')?.to).toBe(
      'dental clinic',
    );
  });

  it('inserts exactly the document the review handed back', async () => {
    const reviewed = await submit(TRIMMED);
    if (reviewed.step !== 'review') throw new Error('expected the review step');
    // What the hidden `document` field carries is `JSON.stringify(state.document)`.
    await submit({ tenant: 'pilot', intent: 'save', base: '', document: JSON.stringify(reviewed.document) });
    expect(insertRuntimeConfig).toHaveBeenCalledOnce();
    expect(insertRuntimeConfig.mock.calls[0]?.[0]).toMatchObject({ config: reviewed.document });
  });

  it('keeps the document as the form built it when it does not parse, beside its issues', async () => {
    const state = await submit({ ...TRIMMED, 'turn.max_reprompts': 'three' });
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues.map((issue) => issue.path)).toContain('turn.max_reprompts');
    expect(state.document).toMatchObject({ turn: { max_reprompts: 'three' } });
  });

  it('diffs against the newest row it reads itself — not the document loaded, nor the client', async () => {
    // The form was loaded from an older row (max_reprompts 1) and submitted as
    // is; the newest row (max_reprompts 3) is the base, so the restore shows.
    // A `from` field is ignored: the diff base is never client-held.
    newestIs({ turn: { max_reprompts: 3 } }, '12');
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      from: '{"turn":{"max_reprompts":1}}',
      'turn.max_reprompts': '1',
    });
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(newestRuntimeConfig).toHaveBeenCalledWith('pilot');
    expect(state.diff).toEqual([
      { path: 'turn.max_reprompts', change: 'changed', from: 3, to: 1 },
    ]);
    expect(state.base).toBe('12');
  });

  it('carries no base when the tenant has no row yet', async () => {
    const state = await submit({ tenant: 'pilot', intent: 'review' });
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.base).toBeNull();
  });
});

describe('edit', () => {
  it('returns the form as submitted, on the tab it was left on, with no failure', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'edit',
      group: 'stt',
      'turn.max_reprompts': '3',
    });

    expect(state).toEqual({
      step: 'edit',
      tenant: 'pilot',
      group: 'stt',
      values: { 'turn.max_reprompts': '3' },
      failure: null,
    });
  });

  it('reads a tab it does not know as the first one', async () => {
    const state = await submit({ tenant: 'pilot', intent: 'edit', group: 'billing' });
    expect(state.group).toBe('turn');
  });
});

describe('save', () => {
  const OK_DOCUMENT = '{"turn":{"max_reprompts":3}}';

  it('writes nothing without an account, and says so', async () => {
    const { NoAccountError } = await import('@/account');
    requireAccount.mockRejectedValue(new NoAccountError());

    const state = await submit({ tenant: 'pilot', intent: 'save', base: '', document: OK_DOCUMENT });

    expect(state.step).toBe('review');
    if (state.step !== 'review') return;
    expect(state.failure).toBe('no account came through the reverse proxy; nothing was written');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('parses the hidden document again and refuses one that has gone bad', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      // What a hand-edited or stale hidden field looks like: the shape the
      // review step could never have produced.
      document: '{"turn":{"max_reprompts":"three"}}',
    });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.failure).toContain('nothing was written');
    expect(state.issues.map((issue) => issue.path)).toContain('turn.max_reprompts');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['no document field at all', undefined],
    ['an array', '[1]'],
    ['a JSON null', 'null'],
    ['text that is not JSON', '{bad'],
    ['the empty string', ''],
  ])('writes nothing when the hidden document is %s', async (_case, document) => {
    // A hand-made POST, not a submission this screen sent. Reading any of these
    // as `{}` would append a "back to boot config" row nobody reviewed.
    const state = await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      ...(document === undefined ? {} : { document }),
    });

    expect(state.step).toBe('edit');
    expect(state.failure).toContain('the form did not arrive as this screen sends it');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('takes a literal {} — "back to boot config" is a legal document', async () => {
    await submit({ tenant: 'pilot', intent: 'save', base: '', document: '{}' });

    expect(insertRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({ config: {} }));
  });

  it('inserts the parsed document and lands on the new row, on the tab it left', async () => {
    await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      group: 'llm',
      document: OK_DOCUMENT,
      note: 'shorter',
    });

    expect(insertRuntimeConfig).toHaveBeenCalledWith({
      tenantId: 'pilot',
      config: { turn: { max_reprompts: 3 } },
      note: 'shorter',
      base: null,
      by: 'lesky',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/configuration');
    expect(redirect).toHaveBeenCalledWith('/configuration?tenant=pilot&group=llm&saved=42');
    // The cache is dropped before the navigation, or the new row would not be
    // on the page the redirect lands on.
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stores an empty note as null: "no note" is one fact', async () => {
    await submit({ tenant: 'pilot', intent: 'save', base: '', document: OK_DOCUMENT, note: '' });

    expect(insertRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ note: null }),
    );
  });

  it('checks the account before reading anything for the save', async () => {
    const { NoAccountError } = await import('@/account');
    requireAccount.mockRejectedValue(new NoAccountError());
    await submit({ tenant: 'pilot', intent: 'save', base: '', document: OK_DOCUMENT });
    expect(requireAccount.mock.invocationCallOrder[0]).toBeLessThan(
      latestBootReport.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('writes nothing when base is missing — not a submission this screen sent', async () => {
    const state = await submit({ tenant: 'pilot', intent: 'save', document: OK_DOCUMENT });
    expect(state.step).toBe('edit');
    expect(state.failure).toContain('the form did not arrive as this screen sends it');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });

  it('hands the reviewed base to the insert', async () => {
    await submit({ tenant: 'pilot', intent: 'save', base: '41', document: OK_DOCUMENT });
    expect(insertRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({ base: '41' }));
  });

  it('shows a refusal against the row that is newest now, with its id as the next base', async () => {
    insertRuntimeConfig.mockResolvedValue({ ok: false, reason: 'another row was saved since this review' });
    newestRuntimeConfig
      .mockResolvedValueOnce({ id: '41', config: {} })
      .mockResolvedValueOnce({ id: '43', config: { turn: { max_reprompts: 5 } } });
    const state = await submit({ tenant: 'pilot', intent: 'save', base: '41', document: OK_DOCUMENT });
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.base).toBe('43');
    expect(state.diff).toEqual([
      { path: 'turn.max_reprompts', change: 'changed', from: 5, to: 3 },
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('refuses a note longer than the limit and writes nothing', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      document: OK_DOCUMENT,
      note: 'x'.repeat(501),
    });
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.failure).toContain('longer than 500 characters');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });

  it('shows the write module\'s refusal as it words it, and does not navigate', async () => {
    insertRuntimeConfig.mockResolvedValue({
      ok: false,
      reason: 'tenant pilot does not exist in tenant_config',
    });

    const state = await submit({ tenant: 'pilot', intent: 'save', base: '', document: OK_DOCUMENT });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.failure).toBe('tenant pilot does not exist in tenant_config');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('a request this screen could not have sent', () => {
  it('answers an unknown intent with the form and a sentence, never a throw', async () => {
    const state = await submit({ tenant: 'pilot', intent: 'delete' });

    expect(state.step).toBe('edit');
    expect(state.failure).toContain('nothing was written');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });

  it('answers a missing tenant the same way', async () => {
    const state = await submit({ intent: 'save', base: '', document: '{}' });

    expect(state.step).toBe('edit');
    expect(state.failure).not.toBeNull();
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });
});

describe('the boot report holds the document to what this box offers (ADR 0012 D3, D4)', () => {
  const OFF_BOX = {
    tenant: 'pilot',
    intent: 'review',
    'stt.provider': 'soniox',
    'tts.provider': 'cartesia',
    'tts.voice': 'ngoc',
  };

  it('review reads the report afresh and adds a blocking issue per leaf it refuses', async () => {
    latestBootReport.mockResolvedValue(REPORT);
    const state = await submit(OFF_BOX);

    expect(latestBootReport).toHaveBeenCalledOnce();
    expect(latestBootReport).toHaveBeenCalledWith('pilot');
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues.map((issue) => issue.path)).toEqual(['stt.provider', 'tts.voice']);
    expect(state.issues[0]?.message).toContain('(reason: provider)');
    expect(state.issues[1]?.message).toContain('(reason: invalid)');
  });

  it('review adds nothing without a report', async () => {
    const state = await submit(OFF_BOX);
    expect(latestBootReport).toHaveBeenCalledOnce();
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues).toEqual([]);
  });

  it('save reads the report again and writes nothing when it refuses the document', async () => {
    latestBootReport.mockResolvedValue(REPORT);
    const state = await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      document: '{"tts":{"provider":"cartesia","voice":"ngoc"}}',
    });

    expect(latestBootReport).toHaveBeenCalledWith('pilot');
    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.failure).toContain('nothing was written');
    expect(state.issues.map((issue) => issue.path)).toEqual(['tts.voice']);
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('save writes a document the report offers', async () => {
    latestBootReport.mockResolvedValue(REPORT);
    await submit({
      tenant: 'pilot',
      intent: 'save',
      base: '',
      document: '{"tts":{"provider":"cartesia","voice":"minh"}}',
    });
    expect(latestBootReport).toHaveBeenCalledOnce();
    expect(insertRuntimeConfig).toHaveBeenCalledOnce();
  });
});
