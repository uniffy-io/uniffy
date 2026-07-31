# Demo company seeder

Fills one organization with a believable knowledge base: notes, files, rooms, calendar
events and chat. No agents, no provider keys. Everything goes through the domain
operations, so URNs, search indexing, tags, permissions and audit rows are real.

```bash
# whole thing, into the oldest organization, as its owner
docker exec uniffy-dev-backend python -m uniffy.scripts.demo_company

# see what it would do first
./manage.py deps run -s backend -- python -m uniffy.scripts.demo_company --dry-run

# pick a target and a subset
python -m uniffy.scripts.demo_company --org-slug acme --actor-email admin@acme.io --only notes,files
```

| Flag | Meaning |
| --- | --- |
| `--content-dir` | Seed a different content directory (default: the bundled Vitalis Health set) |
| `--org-slug` | Target organization; defaults to the oldest one |
| `--actor-email` | Owner of the seeded rows; defaults to the organization owner |
| `--anchor-date` | Any date inside the week events are laid out on; defaults to this week |
| `--only` | Comma-separated subset of `notes,files,rooms,events,chat` |
| `--dry-run` | Report without writing |

Re-running is safe. Existing rows are matched (note slug, file name in folder, room name,
event title plus start, channel name, message content) and skipped.

## The demo persona

`manifest.json` declares a `demo_user`: the account you browse the app as. It is created
as an ordinary MEMBER through `OrganizationOperations.add_member`, which is the same path
an invite takes - membership, user search index, attachments folder, default channel
joins, audit row, cache invalidation. It is seeded on every run regardless of `--only`,
because the rest of the content refers to it.

The persona also joins every PUBLIC channel, so the demo opens on a workspace with
traffic already in it. Private channels stay private, which is the point of having one.

Content can point at people the same way it points at rooms: `[Name](user:email)`.

## Content directory contract

```
content/
├── manifest.json     company name, root folder, timezone, tag palette
├── notes/*.md        frontmatter: title, slug, folder, tags
├── files/<Folder>/*  uploaded into a workspace folder named after the directory
├── files.json        optional descriptions and tags, keyed by "Folder/filename"
├── rooms.json        bookable rooms
├── events.json       events laid out against the anchor Monday
├── chat.json         categories, channels, direct conversations, messages
└── chat_series.json  recurring conversations, rendered once per occurrence
```

Notes live in `Handbook/Policies`-style paths under the manifest's `root_folder`. Events
use `day_offset` (0 = Monday of the anchor week) plus a `HH:MM` wall-clock `start` in the
manifest timezone, and book a room by name. Chat messages carry `minutes_ago`, so the
conversation lands spread over the past few days rather than all at once.

## Recurring chat series

`chat_series.json` is where the volume comes from. Each entry names a channel, a cadence
(`start_days_ago`, `every_days`, `weekdays_only`, `at`) and a set of `variants`. One
variant is rendered per occurrence, cycling in order, with `{placeholders}` filled from
the entry's `variables` plus `{date}`, `{short_date}`, `{weekday}` and `{time}`. Each
variable advances on its own stride, so two pools of the same length do not stay locked
together. The result is a dated operational log - QC runs, courier temperatures, deploys,
ticket counts - rather than filler text, which is what makes search worth demonstrating.

Every seeded message carries a stable `demo_seed_key` in its metadata, so a re-run matches
by identity rather than by text. That matters here: a real log repeats short lines like
"Seen." and those must not collapse into one row.

Roughly 1000 chat rows at the current settings. The run takes a few minutes because every
message goes through the real send pipeline.

## Mentions

Content authors write plain markdown links and the seeder converts them to
`[[[label|urn]]]` mentions once every row has an id:

| In the content | Resolves to |
| --- | --- |
| `[Patient Intake SOP](patient-intake-sop.md)` | the note seeded from that file |
| `[Rila](room:Rila)` | the room with that name |
| `[ranges](file:Clinical/lab-panel-reference-ranges.csv)` | the uploaded file |
| `[Lab QA review](event:Lab QA review)` | the calendar event with that title |

Notes and event descriptions are rewritten in a final pass, so a note can point at a room
created in the same run. Chat messages are rewritten as they are sent. An unresolvable
target is left as an ordinary link and logged as a warning.
