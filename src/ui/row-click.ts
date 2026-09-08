/*
 * The one decision behind `LinkRow`: given a click that landed somewhere in a
 * row, should the row navigate? Kept out of the component as a pure function
 * because it is the part with the edge cases, and this repo's test runner sees
 * `.ts` files only — no React renderer (ADR 0001 keeps the stack small, and a
 * renderer would be a new dependency).
 */

/**
 * Elements that own their own click. A `<Link>` in the first cell is the row's
 * keyboard and middle-click path, so a click that lands on it must navigate
 * once, through the anchor, and not a second time through the row.
 */
export const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="button"]';

/** The parts of a mouse event the decision reads; a `MouseEvent` satisfies it. */
export interface RowClick {
  /** 0 is the primary button; middle and right clicks are left to the browser. */
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** The click landed on (or inside) an `INTERACTIVE_SELECTOR` element. */
  onInteractive: boolean;
  /** Text is selected — the operator was copying a cell, not opening the row. */
  hasTextSelection: boolean;
}

export function shouldFollowRow(click: RowClick): boolean {
  if (click.button !== 0) return false;
  // A modified click means "new tab" / "new window" / "download"; the first
  // cell's anchor gives the browser those natively, so the row stays out of it.
  if (click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return false;
  if (click.defaultPrevented) return false;
  if (click.onInteractive) return false;
  if (click.hasTextSelection) return false;
  return true;
}
