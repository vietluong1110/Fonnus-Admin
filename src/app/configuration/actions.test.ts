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

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/writes/runtime-config', () => ({ insertRuntimeConfig }));
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

type State = Awaited<ReturnType<typeof submitConfiguration>>;

const EDIT: State = { step: 'edit', tenant: 'pilot', values: {}, set: [], failure: null };

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
});

describe('review', () => {
  it('builds the document, the diff and the advice, and writes nothing', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      from: '{}',
      'set:turn.max_reprompts': 'on',
      'turn.max_reprompts': '3',
      'set:llm.model': 'on',
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
      from: '{}',
      'set:turn.max_reprompts': 'on',
      'turn.max_reprompts': '3',
      // Plumbing, never part of the document or of the form's values.
      note: 'shorter reprompts',
    });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.set).toEqual(['turn.max_reprompts']);
    expect(state.values).toEqual({ 'turn.max_reprompts': '3' });
    expect(state.note).toBe('shorter reprompts');
  });

  it('reports an issue on its own leaf and offers no advice while one stands', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'review',
      from: '{}',
      'set:turn.max_reprompts': 'on',
      // A number that does not parse stays the raw string, so the schema
      // reports on the leaf rather than the form sending something else.
      'turn.max_reprompts': 'three',
      'set:text.greeting': 'on',
      'text.greeting': 'Xin chào.',
    });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.issues.map((issue) => issue.path)).toContain('turn.max_reprompts');
    // The greeting would otherwise yield disclosure advice; an unparsed
    // document has none, because there is nothing to advise on yet.
    expect(state.advice).toEqual([]);
  });

  it('proposes the empty document when nothing is ticked — "back to boot config"', async () => {
    const state = await submit({ tenant: 'pilot', intent: 'review', from: '{"turn":{"max_reprompts":3}}' });

    if (state.step !== 'review') throw new Error('expected the review step');
    expect(state.document).toEqual({});
    expect(state.diff).toEqual([
      { path: 'turn.max_reprompts', change: 'removed', from: 3, to: undefined },
    ]);
  });
});

describe('edit', () => {
  it('returns the form as submitted, with no failure', async () => {
    const state = await submit({
      tenant: 'pilot',
      intent: 'edit',
      'set:turn.max_reprompts': 'on',
      'turn.max_reprompts': '3',
    });

    expect(state).toEqual({
      step: 'edit',
      tenant: 'pilot',
      values: { 'turn.max_reprompts': '3' },
      set: ['turn.max_reprompts'],
      failure: null,
    });
  });
});

describe('save', () => {
  const OK_DOCUMENT = '{"turn":{"max_reprompts":3}}';

  it('writes nothing without an account, and says so', async () => {
    const { NoAccountError } = await import('@/account');
    requireAccount.mockRejectedValue(new NoAccountError());

    const state = await submit({ tenant: 'pilot', intent: 'save', document: OK_DOCUMENT });

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
      ...(document === undefined ? {} : { document }),
    });

    expect(state.step).toBe('edit');
    expect(state.failure).toContain('the form did not arrive as this screen sends it');
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('takes a literal {} — "back to boot config" is a legal document', async () => {
    await submit({ tenant: 'pilot', intent: 'save', document: '{}' });

    expect(insertRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({ config: {} }));
  });

  it('inserts the parsed document and lands on the new row', async () => {
    await submit({ tenant: 'pilot', intent: 'save', document: OK_DOCUMENT, note: 'shorter' });

    expect(insertRuntimeConfig).toHaveBeenCalledWith({
      tenantId: 'pilot',
      config: { turn: { max_reprompts: 3 } },
      note: 'shorter',
      by: 'lesky',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/configuration');
    expect(redirect).toHaveBeenCalledWith('/configuration?tenant=pilot#row-42');
    // The cache is dropped before the navigation, or the new row would not be
    // on the page the redirect lands on.
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stores an empty note as null: "no note" is one fact', async () => {
    await submit({ tenant: 'pilot', intent: 'save', document: OK_DOCUMENT, note: '' });

    expect(insertRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ note: null }),
    );
  });

  it('shows the write module\'s refusal as it words it, and does not navigate', async () => {
    insertRuntimeConfig.mockResolvedValue({
      ok: false,
      reason: 'tenant pilot does not exist in tenant_config',
    });

    const state = await submit({ tenant: 'pilot', intent: 'save', document: OK_DOCUMENT });

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
    const state = await submit({ intent: 'save', document: '{}' });

    expect(state.step).toBe('edit');
    expect(state.failure).not.toBeNull();
    expect(insertRuntimeConfig).not.toHaveBeenCalled();
  });
});
