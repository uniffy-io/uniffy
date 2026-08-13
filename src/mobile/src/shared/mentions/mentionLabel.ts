const LABEL_UNSAFE = /[[\]|\\]+/g;

/** Strip the characters that would let a label escape its slot.
 *  The stored label is display fallback only (chips render the resolved live
 *  title), so the strip is invisible to users while making it impossible for
 *  an attacker-controlled title to mint mentions its author never wrote.
 *  Every `[[[label|urn]]]` writer routes labels through here. */
export function sanitizeMentionLabel(label: string): string {
  const cleaned = (label ?? "").replace(LABEL_UNSAFE, " ").replace(/\s+/g, " ").trim();
  return cleaned || "mention";
}
