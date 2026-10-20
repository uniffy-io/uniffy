import { getCollection, type CollectionEntry } from "astro:content";
import { authors, type Author, type AuthorId } from "@/data/blog/authors";

export type Post = CollectionEntry<"blog">;

export type AccentId = "violet" | "pink" | "orange" | "green";

export interface Accent {
  id: AccentId;
  hex: string;
  rgb: string;
  partner: string;
}

export const accents: Record<AccentId, Accent> = {
  violet: { id: "violet", hex: "#694aff", rgb: "105, 74, 255", partner: "253, 126, 234" },
  pink: { id: "pink", hex: "#fd7eea", rgb: "253, 126, 234", partner: "105, 74, 255" },
  orange: { id: "orange", hex: "#ff5500", rgb: "255, 85, 0", partner: "253, 126, 234" },
  green: { id: "green", hex: "#01b77f", rgb: "1, 183, 127", partner: "105, 74, 255" },
};

const tagAccents: Record<string, AccentId> = {
  engineering: "violet",
  product: "pink",
  design: "pink",
  release: "green",
  releases: "green",
  company: "orange",
  security: "orange",
};

export interface TagSummary {
  tag: string;
  slug: string;
  count: number;
}

// FNV-1a keeps every generated cover stable across builds for the same slug.
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function tagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function tagUrl(tag: string): string {
  return `/blog/tag/${tagSlug(tag)}/`;
}

export function postUrl(post: Post): string {
  return `/blog/${post.id}/`;
}

export function accentFor(post: Post): Accent {
  if (post.data.accent) return accents[post.data.accent];
  const first = post.data.tags[0];
  const byTag = first ? tagAccents[tagSlug(first)] : undefined;
  if (byTag) return accents[byTag];
  const ids = Object.keys(accents) as AccentId[];
  return accents[ids[hashString(post.id) % ids.length]];
}

export function authorOf(post: Post): Author {
  return authors[post.data.author as AuthorId];
}

// Drafts render on the dev server only, so a post can be previewed in place.
// MODE comes from the Astro command, unlike DEV which also flips on NODE_ENV.
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) => import.meta.env.MODE !== "production" || !data.draft);
  return posts.sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

// Posts are numbered like journal entries by publish date, oldest first.
export function entryNumbers(posts: Post[]): Map<string, string> {
  const chronological = [...posts].sort(
    (a, b) => a.data.publishedAt.getTime() - b.data.publishedAt.getTime(),
  );
  return new Map(chronological.map((post, index) => [post.id, String(index + 1).padStart(3, "0")]));
}

export function collectTags(posts: Post[]): TagSummary[] {
  const bySlug = new Map<string, TagSummary>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      const existing = bySlug.get(slug);
      if (existing) existing.count += 1;
      else bySlug.set(slug, { tag, slug, count: 1 });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
