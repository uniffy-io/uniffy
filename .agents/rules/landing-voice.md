---
paths:
  - "src/landing/src/content/**/*.md"
  - "src/landing/src/content/**/*.mdx"
  - "src/landing/src/components/sections/**/*.astro"
  - "src/landing/src/pages/**/*.astro"
---

# Landing and Docs Voice

These rules apply to every word the public reads on `uniffy.io` and on the docs site. That includes landing section copy, docs markdown, sidebar labels, and any user facing string in an Astro page or section component. The goal is one consistent voice. Human, direct, opinionated, and free of corporate filler.

Apply these rules when authoring new copy, and fix existing copy on sight when you touch the file for any other reason.

## 1. Skip em dashes and double hyphens

Prefer to skip `--`, `—`, `–`, and any other dash longer than a single hyphen. Not in body copy, not in pillar bodies, not in tables, not in alt text.

When tempted to use a dash as a pause, end the sentence instead and start a new one. Two short sentences beat one long sentence with a dash glued in the middle.

**Bad:**

> Cloud and self-hosted run the same code, the same migrations, the same admin pages -- you get both an org-admin view and a platform-operator view.

**Good:**

> Cloud and self hosted run the same code, the same migrations, the same admin pages. You get an org admin view and a platform operator view.

The same applies to "for example" or "in other words" style asides. Make them their own sentence.

## 2. Prefer no hyphens at all

A single hyphen is allowed when it changes meaning. Compound modifiers that read fine without the hyphen should drop it.

**Drop the hyphen:**

| Hyphenated | Preferred |
|---|---|
| self-hosted | self hosted |
| self-hoster | someone running it themselves |
| per-org / per-organization | per organization |
| per-tenant | per tenant |
| cross-tenant | cross tenant |
| time-bound | time bound |
| audit-logged | audit logged |
| phone-home | phone home |
| opt-in | opt in |
| air-gapped | fully isolated from the internet |
| front-end | front end (or "browser") |
| on-switch | switch |
| first-run | first run |

The principle: hyphens are punctuation. Punctuation should serve the reader, not decorate the page. If the phrase reads cleanly without the hyphen, skip it.

Hyphens that genuinely disambiguate stay. Product names that contain a hyphen stay. Code, file paths, URLs, and identifiers stay exactly as they are.

## 3. Human voice, not corporate voice

Write the way you would explain something to a smart friend. Use `we`, `you`, and `us` freely. Take positions. Own tradeoffs.

**Vocabulary to skip:** leverage, enable, empower, unlock, seamlessly, robust, holistic, cutting edge, best in class, world class, next generation, solution, offering, ecosystem, journey, paradigm shift, game changer.

**Phrasings to skip:** "designed to", "built to", "purpose built", "industry leading", "feature rich", any sentence that could appear on a competitor's homepage without changing meaning.

**Encouraged moves:**

- Name the tradeoff out loud. "Yes, this is more complex than one admin page. We did that on purpose."
- Address the reader directly. "Read this before you compare Uniffy to anything else."
- Use first person when stating intent. "We will not bend on this."
- Concede a thing before defending it. "The admin surface is more complex. We think that is the right tradeoff."

## 4. Short sentences. Paragraph breaks instead of clauses

Default to short, declarative sentences. When a sentence grows past two clauses, split it.

A new paragraph is free. A reader who hits a wall of text bounces. Group ideas into 2 to 4 sentence paragraphs, with a blank line between them.

A four line single paragraph that could be two two line paragraphs is a good candidate for a split.

## 5. Concrete examples, not abstractions

When stating a principle, follow it with a concrete example written as a mini scenario. Two or three short scenarios in sequence beat one abstract description.

**Pattern:**

> Mail is a good example.
>
> Someone running Uniffy themselves points it at their own mail server once and forgets about it.
>
> A cloud tenant who wants their own deliverability domain configures it from their admin pages.
>
> A cloud tenant on the free tier does not touch any of this. They use the shared default.

Each scenario is its own paragraph. The pattern across paragraphs is parallel. The reader sees the rule, then sees how it plays out three different ways, without an abstract bridge.

## 6. No internal jargon in narrative copy

The reader of a narrative page is evaluating Uniffy, not reading the source. Strip terms that only make sense if you have the codebase open.

**Patterns we skip in narrative pages such as the landing, the principles page, overviews, and intros:**

- URL path conventions like `/admin/*`, `/platform/*`. Say "admin pages" and "platform pages".
- Environment variable names like `SMTP_HOST`, `APP_MASTER_KEY`. Say "the mail server", "the master key", "the deployment level master key".
- Internal class or symbol names like `OrgCipher`, `PermissionChecker`, `is_system_admin=true`. Say "the permission system", "encrypted with a key that belongs to that organization".
- Resolver chains, code style flow diagrams (`per-org row → env default → typed error`). Describe the behavior in prose. "A per organization setting wins when present, otherwise the deployment wide default applies."
- Acronyms without definition. KEK, DEK, DLQ, SLA, SLO are fine on a strictly technical page, never on the landing or in a principles page.

### This rule does not apply to reference pages

A page is a reference page when its entire job is to enumerate exact names that the operator will type, paste, or look up. The configure-Uniffy env var docs, the deployment architecture page, an API reference, a schema reference, an admin CLI reference. On those pages the exact variable name, URL path, header, flag, or class name is the whole point. Use them. Format them as code. Softening them into prose tends to hide the lookup target.

A page is narrative copy when its job is to explain what Uniffy is, why it is built this way, or what the reader should take away. On narrative pages, plain language wins every time.

If you are not sure which kind of page you are writing, ask: "would the reader run a grep with this string?" If yes, it is reference and the exact name belongs there. If no, it is narrative and the exact name does not.

## 7. Bold the noun, not the phrase

When introducing a new concept that the reader needs to recognize later, bold the noun itself. Not the surrounding words.

**Good:** "they request a **support session**"

**Bad:** "they request a **support session that the org owner sees live**"

**Bad:** "**they request a support session**"

One noun per sentence at most. The bolds are signposts, not highlighter strokes.

## 8. Bullets and tables earn their place

Default to prose. Reach for a list only when there is a real list of parallel items, and a table only when there is a real grid of facts.

A list of three items where each item is a full sentence is usually three paragraphs, not three bullets.

A bullet list should have parallel grammatical structure across items. If you find yourself writing wildly different sentence shapes under each bullet, convert to paragraphs.

A table needs at least two columns of real comparison. A "table" with one column of labels and one column of descriptions is a definition list, and a definition list is usually just paragraphs.

## 9. Opening line carries the page

The first sentence of every page is a contract with the reader. State why this page exists and who it is for. Do not warm up. Do not restate the title.

**Bad first line:**

> This page documents our principles.

**Good first line:**

> We built Uniffy around a few rules that we will not bend on.

## 10. Close with a question or a stance, not a summary

The closing paragraph should leave the reader with one of two things: a sharpened question they can take to a competitor, or a stance they can either agree or disagree with. A neutral recap of what they just read is wasted space.

**Good:**

> When you compare us to another tool, the right question is not "does feature X exist". The right question is "if I run this on my own hardware, do I get the same product?"

That question outlives the page. A recap does not.

## 11. House spellings

- `cloud` and `self hosted` are lowercase, two words, no hyphen.
- `Uniffy` is capitalized, always. `uniffy` is not the brand spelling.
- `cloud.uniffy.io` is the canonical cloud URL. Backtick it.
- `Community Edition` in scare quotes when describing what we are *not*. The quotes are part of the joke.
- `open source` is how we describe the project. The license is `FSL-1.1-Apache-2.0`, which converts to Apache 2.0 two years after each release; write `Apache 2.0 future license` when the conversion matters. Never mention a Business Source License, a BUSL, an Additional Use Grant, a seat cap, a seat counter, a license key, a license check, a license server, or activation. Not even to deny them. The claims we make are free, no user limit, and never calls home; the mechanics stay out. Self hosting is free and unlimited, and the paid product is the hosted cloud.
- `admin pages` and `platform pages` lowercase. They are common nouns, not product names.
- Bolded concept names like **support session**, **egress worker**, **admin pages** are lowercase and not capitalized.
- US English. `behavior` not `behaviour`, `audit log` not `audit logs` in headings (singular reads as the system, plural reads as the data).

## 12. Mirror landing and docs

Whenever the landing page introduces a concept that the docs cover in depth, the landing copy should be the docs copy compressed. Same words for the same things. If the landing says "support session" and the docs say "support window", one of them is wrong.

When you change the docs page for a concept, scan the landing for the same noun and align. When you ship a new landing pillar, ensure the docs page exists and uses the same vocabulary.

## 13. Docs screenshots are one size, at 2x

**Every screenshot in the docs uses the same frame: 1280 by 620 CSS pixels at a device pixel ratio of 2, which writes a 2560 by 1240 file.** No exceptions, no per page judgement calls.

One shape means the docs read as one product instead of a pile of captures. It also means the page does not lurch as the reader scrolls past an image, because every image occupies the same block.

The 2x part is not optional either. Images are click to zoom, and the reader can magnify one to 800%, so a 1x capture is upscaled the moment anyone looks closely. Check the pixel dimensions of what you produced before committing it, because a 1x file looks correct until someone zooms.

Do not stretch the viewport to fit a long page. A member roster or an audit log will happily report six thousand pixels of content and produce an unusable strip. Showing the top of a long list is the point, not showing all of it.

Files live in `src/landing/public/docs/{area}/{name}.png` and are referenced from markdown as `/docs/{area}/{name}.png`.

The alt text becomes the caption under the zoomed image, so write a full sentence naming what the reader is looking at. The dash rules in section 1 apply to it. Reread it whenever you recapture. Framing changes go stale, and a caption promising a table the reader cannot see is worse than no caption.

## 14. Document the behavior, not the interface

A docs page earns its place by telling the reader something the screen cannot. What a control actually does to their data, what it costs them, what it does not undo, which rule holds even when they are an admin. If the reader could learn it in two seconds by looking at the page, it does not belong in the docs.

**Sections we do not write:**

- "Where to find it", "Getting there", "Navigation". A person reading the Members page docs is looking at the Members page. Naming the sidebar group tells them nothing.
- "What it looks like" wrapped around a screenshot. Put the screenshot inline where it helps and let it speak. We are not narrating images.
- Inventories of the interface. "Three counters sit above the table", "two controls sit above the roster", a column by column table explaining that the Member column shows an avatar and a name. That is a transcription of the screen, and it rots the first time someone moves a button.

**Write instead:** what removal does to their content, that a role change applies with no confirmation, that there is no limited admin tier, that the filter is a server query rather than a slice of the loaded page, which action lands in the audit log.

The test for any paragraph: would an admin who already has the page open still learn something? If no, cut it. A short page of real facts beats a long page that walks the reader around a screen they can see.

## When in doubt

Read the principles page out loud. If a sentence cannot be spoken at a normal conversational pace without sounding like a press release, rewrite it.
