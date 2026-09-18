/*
 * The five exceptions worth filtering by, plus the `All` pill — the filter row
 * of the artboard (`docs/design/Calls-html`).
 * The rules it renders (ADR 0006): a chip is a link, never a client toggle;
 * chips intersect, so each count is "adding this chip leaves N" over the
 * current combination, while `All` is the scope's own count; a chip that leaves
 * nothing still shows, with its zero, because "no call here is like that" is an
 * answer.
 */

import { CHIPS, type Chip, chipHref } from '@/calls-scope';
import ChipPill from '@/ui/chip';

/**
 * The screen's words for the five tokens of the URL. Console vocabulary,
 * settled with the operator and never renamed (`docs/redesign.md` §2); what
 * each one tests is the pipeline's, in `chipHolds`.
 */
const CHIP_LABEL: Record<Chip, string> = {
  failed_turn: 'Failed turn',
  not_finalized: 'Not finalized',
  unconsented: 'Unconsented',
  hit_cap: 'Hit a cap',
  has_recording: 'Has recording',
};

export default function ChipStrip({
  base,
  params,
  active,
  counts,
  allHref,
}: {
  base: string;
  params: Record<string, string | string[] | undefined>;
  active: Chip[];
  counts: { all: number; byChip: Record<Chip, number> };
  allHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChipPill href={allHref} label="All" count={counts.all} active={active.length === 0} />
      {CHIPS.map((chip) => (
        <ChipPill
          key={chip}
          href={chipHref(base, params, chip)}
          label={CHIP_LABEL[chip]}
          count={counts.byChip[chip]}
          active={active.includes(chip)}
        />
      ))}
    </div>
  );
}
