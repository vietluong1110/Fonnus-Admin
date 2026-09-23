import { describe, expect, it, vi } from 'vitest';

/*
 * What the call list actually asks Postgres for. The pool is faked — the
 * statement and its parameters are the thing under test, not Postgres — so the
 * suite still opens no socket.
 */
const query = vi.fn();
vi.mock('@/db', () => ({ getPool: () => ({ query }) }));

const { callsInScope, getCall, getCallAnnotations, getCallEvents } = await import('./calls');
const { parseScope } = await import('@/calls-scope');

const NOW = new Date('2026-09-07T10:00:00Z');

function lastCall(): { sql: string; values: unknown[] } {
  const call = query.mock.calls.at(-1);
  if (call === undefined) throw new Error('no statement was issued');
  return { sql: call[0] as string, values: call[1] as unknown[] };
}

describe('callsInScope', () => {
  it('bounds a preset window below and by nothing else', async () => {
    query.mockResolvedValue({ rows: [] });
    const scope = parseScope({ since: '7d' }, NOW);
    await callsInScope(scope);

    const { sql, values } = lastCall();
    expect(sql).toContain('call_log.started_at >= $1');
    expect(sql).not.toContain('$2');
    expect(sql).toContain('order by call_log.started_at desc, call_log.id');
    // The whole scope is read and paged in memory (ADR 0006), so the cards and
    // the list stand on the same rows.
    expect(sql).not.toMatch(/limit/i);
    expect(values).toEqual([scope.kind === 'window' ? scope.window.since : null]);
  });

  it('carries the half-open upper bound of a custom range as a second parameter', async () => {
    query.mockResolvedValue({ rows: [] });
    const scope = parseScope({ since: '2026-09-01', until: '2026-09-10' }, NOW);
    await callsInScope(scope);

    const { sql, values } = lastCall();
    expect(sql).toContain('call_log.started_at >= $1');
    expect(sql).toContain('call_log.started_at < $2');
    expect(values).toHaveLength(2);
  });

  it('reads the failed turns as one correlated aggregate, defaulted to an empty array', async () => {
    query.mockResolvedValue({ rows: [] });
    await callsInScope(parseScope({}, NOW));

    const { sql } = lastCall();
    expect(sql).toContain('json_agg(t.idx order by t.idx)');
    expect(sql).toContain('t.failed_leg is not null');
    expect(sql).toContain("'[]'::json");
    // `call_event` is never read on a list screen: a range scan across calls is
    // sequential (`docs/redesign.md` §3).
    expect(sql).not.toContain('call_event');
  });

  it('searches on the digits alone when the keyword is no id', async () => {
    query.mockResolvedValue({ rows: [] });
    await callsInScope(parseScope({ q: '+84 90 123 4417' }, NOW));

    const { sql, values } = lastCall();
    expect(sql).toContain("call_log.caller_phone_e164 like '%' || $1");
    expect(sql).not.toContain('id::text');
    expect(values).toEqual(['84901234417']);
  });

  it('ORs both predicates when the keyword can be either', async () => {
    query.mockResolvedValue({ rows: [] });
    await callsInScope(parseScope({ q: '3300' }, NOW));

    const { sql, values } = lastCall();
    expect(sql).toContain("call_log.caller_phone_e164 like '%' || $1");
    expect(sql).toContain("call_log.id::text like $2 || '%'");
    expect(sql).toContain(' or ');
    expect(values).toEqual(['3300', '3300']);
  });

  it('issues no statement at all for a keyword that can match nothing', async () => {
    query.mockClear();
    query.mockResolvedValue({ rows: [] });
    const rows = await callsInScope(parseScope({ q: 'ab' }, NOW));

    expect(rows).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('getCall', () => {
  it('reads exactly the call_log and consent_record columns the detail renders', async () => {
    query.mockResolvedValue({ rows: [] });
    await getCall('330052e1-0000-4000-8000-000000000000');

    const { sql, values } = lastCall();
    const selected = /select([\s\S]*?)\bfrom call_log/.exec(sql)?.[1] ?? '';
    const columns = selected.split(',').map((column) => column.trim());
    expect(columns).toEqual([
      'call_log.id',
      'call_log.started_at',
      'call_log.ended_at',
      'call_log.end_reason',
      'call_log.turn_count',
      'call_log.total_cost_vnd',
      'call_log.caller_phone_e164',
      'call_log.artifact_state',
      'call_log.artifact_key_prefix',
      'call_log.did',
      // Scopes the one `boot_report` read that labels the call's voice (ADR 0012 D6).
      'call_log.tenant_id',
      'call_log.stt_model',
      'call_log.tts_model',
      'call_log.recording_started_at',
      'call_log.stt_audio_ms',
      'call_log.tts_chars',
      'call_log.tts_bytes',
      'call_log.config_snapshot',
      'call_log.greeting_first_audio_ms',
      'call_log.greeting_marks',
      'consent_record.consent_mode',
      'consent_record.disclosure_completed_at as consent_disclosure_completed_at',
      'consent_record.granted_at',
      'consent_record.outcome',
      'consent_record.disclosure_text',
    ]);
    expect(sql).toContain('left join consent_record on consent_record.call_id = call_log.id');
    expect(sql).toContain('where call_log.id = $1');
    expect(sql).not.toMatch(/insert|update|delete/i);
    expect(values).toEqual(['330052e1-0000-4000-8000-000000000000']);
  });
});

describe('getCallEvents', () => {
  it('reads the nine columns of the trail the contract names, and no other', async () => {
    query.mockResolvedValue({ rows: [] });
    await getCallEvents('330052e1-0000-4000-8000-000000000000');

    const { sql, values } = lastCall();
    for (const column of [
      'seq',
      'ts',
      'kind',
      'type',
      'gen',
      'turn_idx',
      'phase',
      'sensitive',
      'data',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('from call_event');
    expect(sql).toContain('where call_id = $1');
    // Place by `seq`, never by `ts`: two records written in order can tie or
    // step back a few milliseconds (trap 9).
    expect(sql).toContain('order by seq');
    // The completeness verdict is count(*) against max(seq) over this array, so
    // a bounded read would make it lie (trap 8, ADR 0010).
    expect(sql).not.toMatch(/limit/i);
    expect(values).toEqual(['330052e1-0000-4000-8000-000000000000']);
  });
});

describe('getCallAnnotations', () => {
  it('reads the eleven columns of call_annotation the contract names, and no other', async () => {
    query.mockResolvedValue({ rows: [] });
    await getCallAnnotations('330052e1-0000-4000-8000-000000000000');

    const { sql, values } = lastCall();
    for (const column of [
      'id',
      'call_id',
      'from_ms',
      'to_ms',
      'label',
      'caller_said',
      'note',
      'supersedes',
      'text_expired_at',
      'created_by',
      'created_at',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('from call_annotation');
    expect(sql).toContain('where call_id = $1');
    // The order a correction is written in: a superseding row always comes
    // after the row it names (contract §3, `callEvidenceOf`).
    expect(sql).toContain('order by id');
    // "Current" is derived over this whole array, and so is the history the
    // card shows on demand: a bounded read would make both lie.
    expect(sql).not.toMatch(/limit/i);
    // Read-only, as every statement of this file is (CLAUDE.md §Ground rules).
    expect(sql).not.toMatch(/insert|update|delete/i);
    expect(values).toEqual(['330052e1-0000-4000-8000-000000000000']);
  });
});
