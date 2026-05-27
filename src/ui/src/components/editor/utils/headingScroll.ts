export function headingToSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Duplicate headings get distinct anchors: pass the count of prior occurrences and the result is `base`, `base-2`, `base-3`, ... */
export function indexedSlug(base: string, occurrence: number): string {
  if (occurrence <= 0) return base;
  return `${base}-${occurrence + 1}`;
}

/** `.ProseMirror` is preferred — headings render as direct children there; `.milkdown` and `root` are DOM-shape fallbacks. */
function resolveEditor(root?: Element | null): ParentNode | null {
  const scope: ParentNode = root ?? document;
  return (
    scope.querySelector('.crepe-editor .ProseMirror') ??
    scope.querySelector('.crepe-editor .milkdown') ??
    (root ?? null)
  );
}

/** `occurrence` is 0-based — `0` is the first match. */
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

/** Slug suffix `-N` walks back to the n-th raw match so duplicate headings remain reachable; pass `root` to scope multi-editor pages. */
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
