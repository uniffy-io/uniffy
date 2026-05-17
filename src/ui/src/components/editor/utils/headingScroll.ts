/**
 * Shared helpers for resolving markdown heading anchors inside a Crepe /
 * Milkdown editor surface. Used by NotesEditor (hash-on-mount scroll),
 * CrepeEditor's in-document anchor click interceptor, the outline panel,
 * and the table-of-contents block plugin.
 */

export function headingToSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Build a unique slug per occurrence: collisions append `-2`, `-3`, ...
 * so duplicate headings get distinct anchors. Pass the count of prior
 * occurrences already seen in the document.
 */
export function indexedSlug(base: string, occurrence: number): string {
  if (occurrence <= 0) return base;
  return `${base}-${occurrence + 1}`;
}

/**
 * Resolve the editor root used as the search scope. We prefer `.ProseMirror`
 * because heading nodes get rendered as direct children there; the wrapper
 * `.milkdown` and the raw `root` are fallbacks for older DOM shapes / tests.
 */
function resolveEditor(root?: Element | null): ParentNode | null {
  const scope: ParentNode = root ?? document;
  return (
    scope.querySelector('.crepe-editor .ProseMirror') ??
    scope.querySelector('.crepe-editor .milkdown') ??
    (root ?? null)
  );
}

/**
 * Find the n-th heading element whose text slug matches `slug`. The
 * "occurrence" index is 0-based: `0` returns the first match, `1` the
 * second, etc. Returns `null` when no match exists at that index.
 */
export function findHeadingBySlugAt(
  slug: string,
  occurrence: number,
  root?: Element | null
): Element | null {
  const editor = resolveEditor(root);
  if (!editor) return null;

  let seen = 0;
  const headings = editor.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    const text = heading.textContent?.trim() ?? '';
    if (headingToSlug(text) !== slug) continue;
    if (seen === occurrence) return heading;
    seen++;
  }
  return null;
}

/**
 * Find the first heading element whose text matches the given slug. When the
 * slug carries an occurrence suffix (e.g. `intro-2`) the lookup walks back
 * through the document, picking the n-th raw match. This is what the link
 * interceptor and on-mount hash scroll use; the slug never carries the
 * suffix from a normal Markdown anchor link, so the common path returns the
 * first match exactly like before.
 *
 * When `root` is supplied the search is scoped to that subtree so multiple
 * editor instances on the page (e.g. the markdown split preview) do not steal
 * each other's headings. When omitted we fall back to the first editor in the
 * document, which preserves the legacy global-scroll behaviour on initial
 * mount.
 */
export function findHeadingBySlug(slug: string, root?: Element | null): Element | null {
  const direct = findHeadingBySlugAt(slug, 0, root);
  if (direct) return direct;

  const suffix = slug.match(/^(.*)-(\d+)$/);
  if (!suffix) return null;
  const base = suffix[1];
  const n = Number(suffix[2]) - 1;
  if (!Number.isFinite(n) || n < 1) return null;
  return findHeadingBySlugAt(base, n, root);
}
