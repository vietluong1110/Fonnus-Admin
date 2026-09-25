/*
 * A status pill, after ../Fonnus-Web-UI/src/design-system/Badge.tsx @ 302e3e8
 * (its tone table copied unchanged).
 * The rule it enforces: a badge is a 12–16% tint of the tone colour carrying
 * the tone colour as text — never a saturated fill with white text, which
 * reads as an alarm wherever it lands. A badge that needs an explanation is
 * wrapped in `Tooltip` by its caller (ADR 0014: no `title` attribute).
 */

import type { ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'terracotta'
  | 'lemongrass';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: 'rgba(38,31,24,.06)', fg: 'var(--text-muted)' },
  success: { bg: 'rgba(62,123,71,.12)', fg: 'var(--success)' },
  warning: { bg: 'rgba(143,99,0,.12)', fg: 'var(--warning)' },
  error: { bg: 'rgba(178,58,46,.12)', fg: 'var(--error)' },
  info: { bg: 'rgba(47,109,126,.12)', fg: 'var(--info)' },
  terracotta: { bg: 'rgba(184,92,43,.12)', fg: 'var(--text-accent)' },
  // The one base-palette name in this file: the alias layer publishes the
  // second voice only as `--chart-2`, which would be a lie on a pill. Kept as
  // the source has it (ADR 0003 point 1's "aliases only" is about screens).
  lemongrass: { bg: 'rgba(110,127,83,.16)', fg: 'var(--lemongrass)' },
};

export default function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  const { bg, fg } = TONES[tone];
  return (
    <span
      style={{ background: bg, color: fg }}
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-ui text-[length:var(--size-ui)] leading-[1.4] font-medium whitespace-nowrap"
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
