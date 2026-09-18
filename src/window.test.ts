import { describe, expect, it } from 'vitest';
import { CALL_TIME_ZONE } from './calls';
import {
  DEFAULT_SINCE,
  MAX_WINDOW_DAYS,
  WINDOW_PRESETS,
  parseSince,
  parseWindow,
  windowHref,
} from './window';

const NOW = new Date('2026-09-07T10:00:00Z');

/** `YYYY-MM-DD HH:mm` as the clinic's zone reads an instant. */
function inZone(at: Date): string {
  const parts = new Map<string, string>(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CALL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const at2 = (type: string): string => parts.get(type) ?? '';
  return `${at2('year')}-${at2('month')}-${at2('day')} ${at2('hour')}:${at2('minute')}`;
}

describe('parseWindow — the URL contract of ADR 0006', () => {
  it('reads a preset as the open-ended window `report-calls --since` means', () => {
    const window = parseWindow({ since: '7d' }, NOW);
    expect(window.preset).toBe('7d');
    expect(window.until).toBeNull();
    expect(window.spec).toBe('7d');
    expect(window.since.toISOString()).toBe(parseSince('7d', NOW).since.toISOString());
    expect(window.error).toBeUndefined();
  });

  it('defaults to the pipeline’s own default when nothing is asked for', () => {
    const window = parseWindow({}, NOW);
    expect(window.preset).toBe(DEFAULT_SINCE);
    expect(window.spec).toBe(DEFAULT_SINCE);
    expect(window.until).toBeNull();
    expect(window.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('offers exactly the three presets the operator settled on', () => {
    expect([...WINDOW_PRESETS]).toEqual(['24h', '7d', '30d']);
    for (const preset of WINDOW_PRESETS) {
      expect(parseWindow({ since: preset }, NOW).preset).toBe(preset);
    }
  });

  it('reads a date range as whole days in the clinic’s zone, both included', () => {
    const window = parseWindow({ since: '2026-09-01', until: '2026-09-10' }, NOW);
    // 00:00 of 1 Sep, and 00:00 of the FOLLOWING day so the SQL stays half-open.
    expect(window.since.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(window.until?.toISOString()).toBe('2026-09-10T17:00:00.000Z');
    expect(window.preset).toBe('custom');
    expect(window.spec).toBe('2026-09-01');
    expect(window.error).toBeUndefined();
  });

  it('pins the zone the date-only bounds are resolved in against Intl', () => {
    // The offset is written as a constant in `src/window.ts`; if Vietnam ever
    // moved its clock, this is the test that fails rather than every window
    // shifting by an hour in silence.
    const window = parseWindow({ since: '2026-09-01', until: '2026-09-10' }, NOW);
    expect(inZone(window.since)).toBe('2026-09-01 00:00');
    expect(inZone(window.until as Date)).toBe('2026-09-11 00:00');
  });

  it('takes a bound that carries a time literally', () => {
    const window = parseWindow(
      { since: '2026-09-01T08:30:00Z', until: '2026-09-02T08:30:00Z' },
      NOW,
    );
    expect(window.since.toISOString()).toBe('2026-09-01T08:30:00.000Z');
    expect(window.until?.toISOString()).toBe('2026-09-02T08:30:00.000Z');
    expect(window.preset).toBe('custom');
  });

  it('refuses an until beside a relative since, and shows the default', () => {
    const window = parseWindow({ since: '7d', until: '2026-09-10' }, NOW);
    expect(window.error).toContain('absolute since');
    expect(window.preset).toBe(DEFAULT_SINCE);
    expect(window.until).toBeNull();
    expect(window.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('refuses an until that does not come after since', () => {
    const window = parseWindow({ since: '2026-09-10', until: '2026-09-01' }, NOW);
    expect(window.error).toContain('after since');
    expect(window.preset).toBe(DEFAULT_SINCE);
    expect(window.until).toBeNull();
  });

  it('refuses a span longer than the statement bound allows', () => {
    expect(MAX_WINDOW_DAYS).toBe(366);
    const relative = parseWindow({ since: '400d' }, NOW);
    expect(relative.error).toContain('366 days');
    expect(relative.preset).toBe(DEFAULT_SINCE);

    const custom = parseWindow({ since: '2025-01-01', until: '2026-09-10' }, NOW);
    expect(custom.error).toContain('366 days');
    expect(custom.until).toBeNull();
  });

  it('refuses what it cannot read, on either bound', () => {
    const since = parseWindow({ since: 'last tuesday' }, NOW);
    expect(since.error).toContain('since expects');
    expect(since.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');

    const until = parseWindow({ since: '2026-09-01', until: 'next friday' }, NOW);
    expect(until.error).toContain('until expects');
    expect(until.preset).toBe(DEFAULT_SINCE);
  });

  it('reads the first value when a key arrives repeated', () => {
    expect(parseWindow({ since: ['24h', '30d'] }, NOW).preset).toBe('24h');
  });

  it('calls any other since spec custom, so the control shows the range fields', () => {
    expect(parseWindow({ since: '36h' }, NOW).preset).toBe('custom');
  });
});

describe('windowHref', () => {
  it('emits the preset and keeps the screen’s other keys', () => {
    expect(windowHref('/calls', '24h', { f: 'failed_turn', q: '' })).toBe(
      '/calls?since=24h&f=failed_turn',
    );
  });

  it('drops until, because a preset window is open-ended', () => {
    expect(windowHref('/', '30d', { until: '2026-09-10', group: 'config' })).toBe(
      '/?since=30d&group=config',
    );
  });
});
