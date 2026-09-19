/**
 * The speakable filter (ADR 0016): what leaves for the speech engine carries
 * nothing a voice cannot pronounce.
 *
 * Removal-only, on purpose. What the model said, what the caller heard, what
 * history replays and what the vendor billed must stay ONE string, so this
 * function may delete a character and may not rewrite one: no number turned
 * into words, no abbreviation expanded, no letter touched. The prompt does the
 * shaping (`session/script.ts`); this is the dumb guard behind it.
 *
 * Every removed character becomes one space rather than nothing — deleting
 * outright would turn "2*3" into "23", which changes a number.
 */

/**
 * The removal classes of ADR 0016 §2 that can appear anywhere, in one pass:
 *  - emoji and pictographs, including regional indicators, skin tone modifiers
 *    (U+1F3FB–U+1F3FF), the variation selectors (U+FE0E/U+FE0F), the
 *    zero-width joiner (U+200D) and the keycap combiner (U+20E3) — so a keycap
 *    emoji loses its two marks and keeps its digit, which reads as "một": the
 *    least-wrong outcome available without rewriting;
 *  - markdown emphasis and code marks — `*`, `_`, `~`, backtick;
 *  - C0/C1 controls, and every Unicode format character (\p{Cf}): the
 *    zero-width space, non-joiner and joiner, the BOM, the soft hyphen, the
 *    directional marks, the word joiner, and the tag characters a subdivision
 *    flag is built from. A category rather than an enumeration, because an
 *    invisible character the enumeration missed would leave a sentence
 *    non-empty — therefore sent and billed — while carrying nothing for the
 *    voice to say.
 *
 * Deliberately absent: every letter, combining mark and digit, and the
 * punctuation a voice paces on — `. , ! ? … ; : ( ) " ' / % đ`. Letters and
 * digits are held out of the pictograph class STRUCTURALLY, by the lookahead
 * below, rather than by trusting the class: \p{Extended_Pictographic} contains
 * U+2139 (the letter "info"), so the class on its own would delete a letter and
 * break the one invariant this module exists to keep. A pictographic
 * punctuation mark IS removed — U+203C and U+2049 carry emoji presentation and
 * no reliable pronunciation, and neither is on the pacing list above. The
 * variation selectors and the keycap combiner are the only combining marks this
 * filter removes, and ADR 0016 §2 names all three.
 */
const REMOVED =
  // The three invisible emoji marks stand alone rather than joining the class:
  // side by side inside one class they read as a combining sequence, which is
  // what `no-misleading-character-class` is there to catch.
  // eslint-disable-next-line no-control-regex
  /(?![\p{L}\p{N}])[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}]|\uFE0E|\uFE0F|\u20E3|[*_~`\u0000-\u001F\u007F-\u009F]|\p{Cf}/gu;

/**
 * Heading marks: a "#" run, at the start of the text or of any line in it.
 *
 * What may sit between the line start and the mark is horizontal whitespace of
 * any kind OR a format character. Both, because the format characters are
 * removed in a later pass than this one: an invisible U+200B in front of a "#"
 * would otherwise hide the mark from this rule, get deleted itself, and leave
 * the "#" on its way to the voice. `\n` is deliberately excluded — it is what
 * marks the line start these rules anchor to.
 */
const LEADING_WHITESPACE = String.raw`(?:[^\S\n]|\p{Cf})*`;
const LEADING_HEADING = new RegExp(String.raw`(?:^|\n)${LEADING_WHITESPACE}#+`, 'gu');

/**
 * An unordered list bullet: at the start of the text or of any line in it, and
 * only when horizontal whitespace of any kind follows it — a tab or a
 * non-breaking space separates a bullet from its item just as a plain space
 * does, and a mark that reaches the voice is what this rule exists to prevent.
 *
 * A line start is not the same as the text start here: the splitter merges a
 * candidate shorter than TTS_MIN_SENTENCE_CHARS into the next one, so a short
 * two-item list arrives as one string with its second bullet in the middle.
 * Elsewhere a hyphen or a middle dot belongs to the words around it and
 * removing it would be a rewrite. A numbered marker ("1. ") is a digit and a
 * period, so nothing here touches it.
 */
const LEADING_BULLET = new RegExp(
  String.raw`(?:^|\n)${LEADING_WHITESPACE}[-*+•·](?=[^\S\n])`,
  'gu',
);

/** A space left directly before punctuation the voice paces on. */
const SPACE_BEFORE_PUNCT = / (?=[.,!?…;:])/gu;

/**
 * Returns the text with every unpronounceable character removed, whitespace
 * runs collapsed to one space and the result trimmed. An empty result means
 * the text was nothing but removable characters — the caller skips it rather
 * than sending it (ADR 0016 §2).
 */
export function speakable(text: string): string {
  return text
    .replace(LEADING_HEADING, ' ')
    .replace(LEADING_BULLET, ' ')
    .replace(REMOVED, ' ')
    .replace(/\s+/gu, ' ')
    .replace(SPACE_BEFORE_PUNCT, '')
    .trim();
}
