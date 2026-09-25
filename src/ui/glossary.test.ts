import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSENT_OUTCOMES, END_REASONS, FAILED_LEGS, FAILED_STAGES } from '../calls';
import { FLAT_KEYS } from '../configuration/flat-keys';
import { GROUPINGS, parseGroup } from '../dashboard';
import { HOLDER_KINDS } from '../intervals';
import { endOfTurnRows, LEGS } from '../latency';
import {
  GLOSSARY,
  OVERVIEW_GROUPINGS,
  failureChip,
  holderTerm,
  termFor,
  turnSourceTerm,
  type GlossaryNamespace,
} from './glossary';

/**
 * The three canned lines, `CannedLine` at
 * `../Fonnus/app/src/domain/effects.ts:8`; checked against that line below
 * when the sibling checkout is present.
 */
const CANNED_LINES = ['reprompt', 'degraded', 'farewell'];

/**
 * The headline spans of PIPELINE_ARCHITECTURE.md §6 (the two `turn` columns
 * and the reasoning head pair of `src/latency.ts` `HEAD_PAIRS`), plus
 * `turn.failed_after_ms` (contract §3.1, trap 7), `call_log.greeting_first_audio_ms`
 * (contract §3.1) and the end-of-turn pairs of contract §3.2, read from
 * `src/latency.ts` so a new pair cannot go unnamed.
 */
const END_OF_TURN_SPANS = endOfTurnRows({}).map((row) => `${row.from} → ${row.to}`);
const SPANS = [
  'pipeline_ms',
  'caller_perceived_ms',
  'llm_first_reasoning → llm_first_token',
  'failed_after_ms',
  'greeting_first_audio_ms',
  ...END_OF_TURN_SPANS,
];

/** `turn.source`'s two fixed values (contract §3.1; every other value is a vendor frame name). */
const TURN_SOURCES = ['carry_over', 'reopen'];

/** The eight groupings the Overview offers (ADR 0013 §Overview groupings), in order. */
const OFFERED_GROUPINGS = [
  'key:OPENROUTER_MODEL',
  'stt_model',
  'tts_model',
  'voice',
  'key:OPENROUTER_REASONING',
  'key:STT_PROVIDER',
  'key:TTS_PROVIDER',
  'key:runtime.version',
];

const VOCABULARY: Record<GlossaryNamespace, readonly string[]> = {
  span: SPANS,
  leg: LEGS.map((leg) => leg.name),
  endReason: END_REASONS,
  consentOutcome: CONSENT_OUTCOMES,
  failedLeg: FAILED_LEGS,
  failedStage: FAILED_STAGES,
  turnSource: TURN_SOURCES,
  holder: HOLDER_KINDS,
  canned: CANNED_LINES,
  grouping: OFFERED_GROUPINGS,
  configLeaf: Object.keys(FLAT_KEYS),
};

describe('the glossary is total, both ways (ADR 0013 decision 6)', () => {
  it.each(Object.keys(VOCABULARY) as GlossaryNamespace[])(
    '%s has exactly one entry per vocabulary value',
    (ns) => {
      expect(Object.keys(GLOSSARY[ns]).sort()).toEqual([...VOCABULARY[ns]].sort());
    },
  );

  it('covers the 55 configuration leaves', () => {
    expect(Object.keys(GLOSSARY.configLeaf)).toHaveLength(55);
  });

  it('gives every entry a name and its own code, and every leaf and leg a description', () => {
    for (const [ns, entries] of Object.entries(GLOSSARY)) {
      for (const [key, term] of Object.entries(entries)) {
        expect(term.name.length, `${ns}.${key}`).toBeGreaterThan(0);
        // The two overrides: the voice grouping, and the end-of-turn spans,
        // whose name is their mark pair and whose code is the contract's group.
        if (ns === 'span' && END_OF_TURN_SPANS.includes(key)) {
          expect(term.name).toBe(key);
          expect(term.code).toBe('end-of-turn marks');
        } else if (!(ns === 'grouping' && key === 'voice')) expect(term.code).toBe(key);
      }
    }
    for (const term of [...Object.values(GLOSSARY.configLeaf), ...Object.values(GLOSSARY.leg)]) {
      expect(term.description?.length, term.code).toBeGreaterThan(0);
    }
  });

  it('offers the eight groupings in order, each one the URL parses back', () => {
    expect(OVERVIEW_GROUPINGS.map((g) => g.value)).toEqual(OFFERED_GROUPINGS);
    for (const { value } of OVERVIEW_GROUPINGS) {
      expect(parseGroup(value)).toBe(value);
      if (!value.startsWith('key:')) expect(GROUPINGS as readonly string[]).toContain(value);
    }
    expect(termFor('grouping', 'voice')?.code).toBe('key:CARTESIA_VOICE_ID ∥ key:ELEVENLABS_VOICE_ID');
  });

  const effectsPath = fileURLToPath(new URL('../../../Fonnus/app/src/domain/effects.ts', import.meta.url));
  it.skipIf(!existsSync(effectsPath))(
    "names the pipeline's canned lines (skipped when ../Fonnus is not checked out beside this repo)",
    () => {
      const line = /export type CannedLine = ([^;]+);/.exec(readFileSync(effectsPath, 'utf8'))?.[1];
      const lines = [...(line ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(lines.sort()).toEqual([...CANNED_LINES].sort());
    },
  );
});

describe('descriptions are plain text', () => {
  it('carries no markdown backtick, which a tooltip would print literally', () => {
    for (const [ns, entries] of Object.entries(GLOSSARY)) {
      for (const [key, term] of Object.entries(entries)) {
        expect(term.description ?? '', `${ns}.${key}`).not.toContain('`');
      }
    }
  });
});

describe('termFor', () => {
  it('answers null for an unknown value, a null and a prototype key', () => {
    expect(termFor('endReason', 'caller_hangup')?.name).toBe('Caller hung up');
    expect(termFor('endReason', 'brand_new_reason')).toBeNull();
    expect(termFor('endReason', null)).toBeNull();
    expect(termFor('endReason', 'constructor')).toBeNull();
  });
});

describe('turnSourceTerm', () => {
  it('names the two fixed values and wraps any vendor frame name', () => {
    expect(turnSourceTerm('reopen')).toEqual({ name: 'Reopened before the reply was heard', code: 'reopen' });
    expect(turnSourceTerm('speech_final')).toEqual({
      name: 'Vendor end-of-speech signal',
      code: 'speech_final',
    });
    expect(turnSourceTerm(null)).toBeNull();
  });
});

describe('holderTerm', () => {
  it('numbers replies and waits, keeping the pipeline string as the code', () => {
    expect(holderTerm({ kind: 'reply', label: 'bot: reply 3', turnIdx: 3 })).toEqual({
      name: 'Fonnus · reply 3',
      code: 'bot: reply 3',
    });
    expect(holderTerm({ kind: 'waiting', label: 'bot: waiting on reply 2', turnIdx: null }).name).toBe(
      'Fonnus · preparing reply 2',
    );
    expect(holderTerm({ kind: 'reply', label: 'bot: reply', turnIdx: null }).name).toBe('Fonnus · reply');
  });

  it('names the canned line, or says canned line when the event did not', () => {
    expect(holderTerm({ kind: 'canned', label: 'bot: farewell', turnIdx: null }).name).toBe('Fonnus · farewell');
    expect(holderTerm({ kind: 'canned', label: 'bot: canned line', turnIdx: null }).name).toBe(
      'Fonnus · canned line',
    );
    expect(holderTerm({ kind: 'greeting', label: 'bot: greeting', turnIdx: null }).name).toBe('Fonnus · greeting');
    expect(holderTerm({ kind: 'deaf', label: 'deaf', turnIdx: null })).toEqual({
      name: 'Not listening (STT reconnecting)',
      code: 'deaf',
    });
  });
});

describe('failureChip', () => {
  it('is one chip, leg then stage, provider error for a null stage', () => {
    expect(failureChip(null, null)).toBeNull();
    expect(failureChip('llm', 'ttfb')).toEqual({ name: 'LLM · no first token/byte in time', code: 'llm · ttfb' });
    expect(failureChip('tts', null)).toEqual({ name: 'TTS · provider error', code: 'tts' });
    expect(failureChip('stt', 'lost')?.name).toBe('stt · lost');
  });
});
