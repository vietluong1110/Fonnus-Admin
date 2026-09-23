'use client';

/*
 * A button that puts one string on the clipboard — for an identifier the
 * operator pastes elsewhere (a log search, a chat) and never reads, so it is
 * copied in one click rather than selected by hand.
 * The rule it enforces: the result is said, not assumed — "Copied" or, when the
 * browser refuses the clipboard (an insecure origin, a denied permission),
 * "Copy failed" with the value in the tooltip to select by hand. Both are
 * announced through a live region.
 */

import { useEffect, useState } from 'react';
import Button from './button';

type State = 'idle' | 'copied' | 'failed';

/** How long "Copied" / "Copy failed" stays before the label comes back. */
const RESET_MS = 2_000;

export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => { setState('idle'); }, RESET_MS);
    return () => { clearTimeout(timer); };
  }, [state]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <Button variant="secondary" title={value} onClick={() => { void copy(); }}>
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </span>
    </Button>
  );
}
