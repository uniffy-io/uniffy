/**
 * Shared helpers for resolving markdown heading anchors inside a Crepe /
 * Milkdown editor surface. Used by NotesEditor (hash-on-mount scroll) and by
 * CrepeEditor's in-document anchor click interceptor.
 */

export function headingToSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Find a heading element whose text matches the given slug.
 *
 * When `root` is supplied the search is scoped to that subtree so multiple
 * editor instances on the page (e.g. the markdown split preview) do not steal
 * each other's headings. When omitted we fall back to the first editor in the
 * document, which preserves the legacy global-scroll behaviour on initial
 * mount.
 */
export function findHeadingBySlug(slug: string, root?: Element | null): Element | null {
  const scope: ParentNode = root ?? document;
  const editor =
    scope.querySelector('.crepe-editor .ProseMirror') ??
    scope.querySelector('.crepe-editor .milkdown') ??
    (root ?? null);
  if (!editor) return null;

  const headings = editor.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    const text = heading.textContent?.trim() ?? '';
    if (headingToSlug(text) === slug) {
      return heading;
    }
  }
  return null;
}
