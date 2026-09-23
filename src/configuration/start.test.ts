import { describe, expect, it } from 'vitest';
import { chooseTenant, diffBase, startDocument } from './start';

/*
 * The two URL choices of ADR 0011 decision 8. Each case here is a screen the
 * operator can land on — a stale link, a row from another tenant's history, a
 * tenant with no row yet — and the rule is the same for all three: fall back to
 * something readable, never to an empty page.
 */

const TENANTS = [{ id: 'pilot' }, { id: 'second' }];

describe('chooseTenant', () => {
  it('takes the tenant the URL names when it is a row of tenant_config', () => {
    expect(chooseTenant(TENANTS, 'second')).toBe('second');
  });

  it('falls back to the first row for a tenant that does not exist', () => {
    expect(chooseTenant(TENANTS, 'closed-clinic')).toBe('pilot');
  });

  it('falls back to the first row when the URL names none', () => {
    expect(chooseTenant(TENANTS, undefined)).toBe('pilot');
  });

  it('answers null with no tenant at all — the pipeline has created none', () => {
    expect(chooseTenant([], 'pilot')).toBeNull();
  });
});

describe('startDocument', () => {
  const ROWS = [
    { id: '7', config: { turn: { max_reprompts: 3 } } },
    { id: '4', config: { turn: { max_reprompts: 1 } } },
  ];

  it('opens on the newest row when the URL names none', () => {
    expect(startDocument(ROWS, undefined)).toEqual({ document: ROWS[0]?.config, row: null });
  });

  it('opens on the row ?from names, and says which row that was', () => {
    expect(startDocument(ROWS, '4')).toEqual({ document: ROWS[1]?.config, row: ROWS[1] });
  });

  it('names no row when ?from is the newest row — it is not loaded from an older one', () => {
    // The link "load into form" on the current row lands here; the caveat
    // "not from the newest row" would then be a false sentence.
    expect(startDocument(ROWS, '7')).toEqual({ document: ROWS[0]?.config, row: null });
  });

  it('falls back to the newest row for an id outside this history', () => {
    // Another tenant's row, or a row that never existed: the screen is about
    // one tenant, and a document from outside it is not loadable here.
    expect(startDocument(ROWS, '999')).toEqual({ document: ROWS[0]?.config, row: null });
  });

  it('opens on the empty document when the tenant has no row — boot config', () => {
    expect(startDocument([], undefined)).toEqual({ document: {}, row: null });
  });
});

describe('diffBase', () => {
  const NEWEST = { id: '9', config: { turn: { max_reprompts: 3 } } };
  const OLDER = { id: '7', config: { turn: { max_reprompts: 1 } } };

  it('is the newest row’s document, whichever row the form was loaded from', () => {
    expect(diffBase([NEWEST, OLDER])).toEqual({ turn: { max_reprompts: 3 } });
  });

  it('is boot config with no row', () => {
    expect(diffBase([])).toEqual({});
  });

  it('is boot config when the newest row fails the copied schema (trap 6)', () => {
    expect(diffBase([{ id: '9', config: { turn: { max_reprompts: 'three' } } }, OLDER])).toEqual({});
  });

  it('is the document as parsed, so a stored untrimmed value diffs as the pipeline reads it', () => {
    expect(diffBase([{ id: '9', config: { tts: { provider: 'cartesia', voice: ' v1 ' } } }])).toEqual({
      tts: { provider: 'cartesia', voice: 'v1' },
    });
  });
});
