/*
 * One number with its label, after the `Stat` primitive of the design-system
 * bundle (../Fonnus-Web-UI/design-reference/_ds/…/_ds_bundle.js @ 302e3e8),
 * re-expressed in TSX and given the `caveat` slot this console needs.
 * The rule it enforces: every figure is set in the numeric face with tabular
 * figures, so a column of them lines up digit under digit.
 */

import Caveat, { Hint } from './caveat';

const VALUE_SIZE = { sm: '16px', md: '28px', lg: '40px' } as const;

const DELTA_TONE = {
  neutral: 'text-text-muted',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
} as const;

export default function Stat({
  label,
  value,
  unit,
  delta,
  deltaTone = 'neutral',
  size = 'md',
  hint,
  caveat,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  deltaTone?: keyof typeof DELTA_TONE;
  size?: keyof typeof VALUE_SIZE;
  /** What the figure is measured over, read once — the label's tooltip. */
  hint?: string;
  /** What the reader must see beside the figure every time. */
  caveat?: string;
  /** A caveat word on the figure's own line ("floor", "not finalized"), muted. */
  note?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-ui text-[length:var(--size-ui)] leading-[1.4] text-text-muted">
        {hint === undefined ? label : <Hint hint={hint}>{label}</Hint>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          style={{ fontSize: VALUE_SIZE[size] }}
          className="font-num leading-[1.2] font-semibold tracking-[-.01em] tabular-nums"
        >
          {value}
        </span>
        {unit === undefined ? null : (
          <span className="font-num text-[length:var(--size-body-sm)] text-text-muted">{unit}</span>
        )}
        {note === undefined || note === null ? null : <Caveat as="span">{note}</Caveat>}
      </div>
      {delta === undefined ? null : (
        <div className={`font-num text-[length:var(--size-ui)] tabular-nums ${DELTA_TONE[deltaTone]}`}>
          {delta}
        </div>
      )}
      {caveat === undefined ? null : <Caveat>{caveat}</Caveat>}
    </div>
  );
}
