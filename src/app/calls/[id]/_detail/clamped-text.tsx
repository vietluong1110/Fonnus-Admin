'use client';

/*
 * A long snapshot value — a prompt, a canned line, an object — cut to two
 * lines, with "show all" offered only when the cut actually hides something.
 * Whether it does depends on the width the text lands in, so it is measured in
 * the browser (and re-measured when the width changes) rather than guessed from
 * a character count.
 */

import { useEffect, useRef, useState } from 'react';

export default function ClampedText({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null || open) return;
    const measure = (): void => { setCut(element.scrollHeight > element.clientHeight + 1); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [open]);

  return (
    <>
      <p
        ref={ref}
        className={`m-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-2'} ${className}`}
      >
        {text}
      </p>
      {cut || open ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => { setOpen(!open); }}
          className="mt-0.5 cursor-pointer text-[length:var(--size-eyebrow)] font-medium text-text-link hover:underline"
        >
          {open ? 'show less' : 'show all'}
        </button>
      ) : null}
    </>
  );
}
