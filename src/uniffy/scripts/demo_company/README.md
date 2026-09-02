# Demo company seeder

Fills one organization with a believable knowledge base: users and groups, LLM
provider keys and agents, notes, files, rooms, calendar events, projects and
chat. Everything goes through the domain operations, so URNs, search indexing,
tags, permissions and audit rows are real.

This is THE dev seeding path. `domains/platform/bootstrap.py` provisions only what production
needs (admin user, default org, docs notes, VAPID keys); everything a dev
stack wants on top comes from here. The script refuses to run outside
`ENVIRONMENT=development`.

## The dev stack runs it for you

The `seeder` compose service (dev profile) runs `--fresh-only` on every
`stack up`: it waits for the backend bootstrap, seeds the whole set once, and
records a sentinel in `deployment_settings` (`seed/demo_company`). Later
starts see the sentinel and exit in a second. `./manage.py stack reset-data`
wipes the sentinel with the rest of the data and starts the seeder again, so
a fresh database always comes back populated.

```bash
./manage.py logs -s seeder                     # watch a seeding run

# manual runs (inside the backend or seeder container)
docker exec uniffy-dev-backend python -m uniffy.scripts.demo_company
docker exec uniffy-dev-backend python -m uniffy.scripts.demo_company --dry-run
docker exec uniffy-dev-backend python -m uniffy.scripts.demo_company --only notes,files
```

| Flag | Meaning |
| --- | --- |
| `--content-dir` | Seed a different content directory (default: the bundled Uniffy company set) |
| `--org-slug` | Target organization; defaults to the oldest one |
| `--actor-email` | Owner of the seeded rows; defaults to the organization owner |
| `--anchor-date` | Any date inside the week events are laid out on; defaults to this week |
| `--only` | Comma-separated subset of `users,agents,notes,files,rooms,events,projects,chat` |
| `--dry-run` | Report without writing |
| `--fresh-only` | Stack boot mode: wait for bootstrap, run once per database, record the sentinel |

Re-running is safe. Existing rows are matched (user email, group slug,
provider label, agent name, note slug, file name in folder, room name, event
title plus start, project slug, channel name, message content) and skipped.

## People, teams, keys and agents

`people.json` declares the whole company: the roster, the team tree and the
access groups. Members join through `OrganizationOperations.add_member` - the
same path an invite takes - and everything after that goes through the people
and groups operations, so profiles, manager edges and team facts are written
the way the admin surfaces write them. Chat, events and projects in the
content set refer to these people by email.

| Key | Holds |
| --- | --- |
| `people` | one entry per member: login (`username`, `full_name`, `password`, default `admin`) plus the org-scoped profile (`job_title`, `department`, `office_location`, `start_date`, `manager`) |
| `teams` | the org chart: `parent` nests a team under another, `lead` names the person the chart hangs the team from, `members` is the roster |
| `access_groups` | permission bundles: grant-list names, optional `private`, members with a `MEMBER` / `ADMIN` role |

A person entry without a `username` only carries profile facts and expects the
login to exist already - that is how the demo persona (declared as
`demo_user` in `manifest.json`) gets a title and a manager without being
declared twice.

Teams are seeded in declaration order, so a parent comes before its children,
and a lead has to be a member of the team it leads. Team names and access
group names share one namespace per organization, so no team may be named
after a group.

Most engineers and reps carry no explicit `manager`: their team lead supplies
the inherited edge the org chart draws as a dashed line, which is the case
worth having in a demo.

`agents.json` declares one provider key and one agent per LLM provider. The
names, models and colors are content; the credentials come from the env
(`CLAUDE_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENAI_API_KEY`,
`OPENROUTER_API_KEY`, `XAI_API_KEY` in the repo-root `.env`). An unset var
skips that provider with a warning. Keys are stored without the live probe so
an offline stack still gets working rows; agents get every built-in platform
tool.

## The demo persona

`manifest.json` declares a `demo_user`: the account you browse the app as
(`maria@uniffy.io` / `demo`). It is created as an ordinary MEMBER and joins
every PUBLIC channel, so the demo opens on a workspace with traffic already
in it. Private channels stay private, which is the point of having one.

## Content directory contract

```
content/
├── manifest.json     company name, root folder, timezone, demo persona, tag palette
├── people.json       the roster with profiles, the team tree, the access groups
├── agents.json       provider keys (env-var driven) and one agent per provider
├── projects.json     projects with their tasks
├── notes/*.md        frontmatter: title, slug, folder, tags
├── files/<Folder>/*  uploaded into a workspace folder named after the directory
├── files.json        optional descriptions and tags, keyed by "Folder/filename"
├── rooms.json        bookable rooms
├── events.json       events laid out against the anchor Monday
├── chat.json         categories, channels, direct conversations, messages
└── chat_series.json  recurring conversations, rendered once per occurrence
```

Notes live in `Handbook/Policies`-style paths under the manifest's
`root_folder`. Events use `day_offset` (0 = Monday of the anchor week) plus a
`HH:MM` wall-clock `start` in the manifest timezone, and book a room by name.
Chat messages carry `minutes_ago`, so the conversation lands spread over the
past few days rather than all at once. Tasks carry `due_in_days` relative to
the run (negative = already done, no due date).

## Generated binaries

`generated.py` renders PDFs (a hand-rolled minimal writer with real text
objects, so extraction and search work) and PNG/JPEG images (Pillow) at seed
time - no binary blobs live in the repo. They are authored for the bundled
Uniffy set and merge into its `files` upload list only when no `--content-dir`
override is given. Output is deterministic, so re-runs match by filename and
skip.

## Recurring chat series

`chat_series.json` is where the volume comes from. Each entry names a channel,
a cadence (`start_days_ago`, `every_days`, `weekdays_only`, `at`) and a set of
`variants`. One variant is rendered per occurrence, cycling in order, with
`{placeholders}` filled from the entry's `variables` plus `{date}`,
`{short_date}`, `{weekday}` and `{time}`. Each variable advances on its own
stride, so two pools of the same length do not stay locked together. The
result is a dated operational log - CI runs, backup jobs, deploys, support
ticket counts - rather than filler text, which is what makes search worth
demonstrating.

Every seeded message carries a stable `demo_seed_key` in its metadata, so a
re-run matches by identity rather than by text. That matters here: a real log
repeats short lines like "Seen." and those must not collapse into one row.

Roughly 1000 chat rows at the current settings. The run takes a few minutes
because every message goes through the real send pipeline.

## Mentions

Content authors write plain markdown links and the seeder converts them to
`[[[label|urn]]]` mentions once every row has an id:

| In the content | Resolves to |
| --- | --- |
| `[Incident Response Runbook](incident-response-runbook.md)` | the note seeded from that file |
| `[Rila](room:Rila)` | the room with that name |
| `[SLOs](file:Engineering/service-slo-reference.csv)` | the uploaded file |
| `[Release review](event:Release review)` | the calendar event with that title |
| `[Maria](user:maria@uniffy.io)` | the member with that email |

Notes and event descriptions are rewritten in a final pass, so a note can
point at a room created in the same run. Chat messages are rewritten as they
are sent. An unresolvable target is left as an ordinary link and logged as a
warning.
