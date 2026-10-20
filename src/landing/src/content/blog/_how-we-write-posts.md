---
title: "How we write posts here"
description: "A draft that never ships. It shows every block a post can use, so you can copy its frontmatter and start writing in under a minute."
publishedAt: 2026-10-20
author: team
tags: [Engineering, Writing]
draft: true
---

This file starts with an underscore, so the blog collection skips it and it never renders, not even on the dev server. It is the reference for anyone writing on the Uniffy blog. Copy the frontmatter, delete the body, drop the underscore from your file name, and you have a post.

Every post lives in `src/landing/src/content/blog/` as one Markdown file. The file name becomes the URL.

## Frontmatter

The fields are validated at build time, so a typo fails the build instead of shipping a broken page.

```yaml title="src/landing/src/content/blog/your-post.md"
---
title: "A short, specific title"
description: "One or two sentences. This is the excerpt on the index and the meta description."
publishedAt: 2026-10-20
updatedAt: 2026-11-02
author: team
tags: [Engineering]
accent: violet
cover: ./your-post-cover.png
coverAlt: "What the picture shows, in one full sentence."
draft: false
---
```

| Field | Required | What it does |
| --- | --- | --- |
| `title` | yes | Page title, card title, and the headline in search results. |
| `description` | yes | The excerpt. Keep it under 320 characters. |
| `publishedAt` | yes | Sorts the index and sets the entry number. |
| `updatedAt` | no | Shows an updated date on the post when it is later than `publishedAt`. |
| `author` | no | An id from the authors list. Defaults to the team. |
| `tags` | no | Up to four. The first tag picks the cover color. |
| `accent` | no | Overrides the cover color: `violet`, `pink`, `orange`, or `green`. |
| `cover` | no | A real image next to the post. Without one, the cover is generated from the slug. |
| `draft` | no | Hides the post from production builds, the feed, and the sitemap. |

## Headings

Use `##` for sections and `###` for sub sections. Both show up in the table of contents. Do not go deeper than that. If you need a fourth level, the post wants to be two posts.

### A sub section

Short paragraphs. Two to four sentences each, then a blank line. A reader who hits a wall of text bounces.

## Lists

Reach for a list when there is a real list of parallel items.

- Each item is a fragment or one sentence.
- Items share the same grammatical shape.
- Three items is a list. Two is a sentence.

Numbered lists are for steps that happen in order.

1. Write the post.
2. Run the dev server and read it on a phone.
3. Flip `draft` to `false`.

## Quotes

> We refuse to fork the product. Cloud and self hosted run the same code, the same migrations, the same admin pages.

A quote carries one idea. If it needs a second paragraph, it is a section.

## Code

Fenced blocks get syntax highlighting, a copy button, and an optional file name.

```ts title="src/lib/blog.ts"
export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
```

Inline code is for identifiers the reader would type or grep, like `PermissionChecker` or `./manage.py start`. Everything else is prose.

```bash
./manage.py start
./manage.py logs -s backend
```

## Images

Drop the image next to the Markdown file and reference it with a relative path. It gets resized and served in modern formats. The alt text is the caption, so write a full sentence.

![The Uniffy wordmark on a dark background, used here as a placeholder image.](/og.png)
*A caption sits in italics on the line right after the image.*

## Callouts

The docs have aside boxes. Posts do not. A post is an argument, and a box in the middle of an argument is a sign the paragraph before it did not land. When one fact has to stand out, give it a quote on its own.

> One quote per section at most. Two in a row means the section needs a rewrite.

## Tables

A table needs at least two columns of real comparison. Otherwise it is a list wearing a costume.

| Deployment | Who runs it | Who is the admin |
| --- | --- | --- |
| cloud | We do | The org owner |
| self hosted | You do | You, usually wearing both hats |

## Links and emphasis

Link the thing you are talking about, like the [principles page](/docs/principles/) or the [source on GitHub](https://github.com/uniffy-io/uniffy). Bold the **noun** the reader needs to recognize later, not the whole phrase.

---

## House rules

Write the way you would explain something to a smart friend. Use we, you, and us. Take positions. Own tradeoffs.

No em dashes, no double hyphens. End the sentence and start a new one. No marketing words. If a sentence could sit on a competitor's homepage without changing meaning, cut it.

Close with a question or a stance, not a summary. When you compare us to another tool, the right question is not whether feature X exists. The right question is whether you get the same product on your own hardware.
