---
name: release-log
description: Draft or publish Uniffy release notes from commit diffs and shipped product behavior. Use when asked to write a release log, prepare a changelog for a version, or replace placeholder GitHub release notes. Covers mixed-purpose commits and changes spread across commits. Skip for PR descriptions or creating release tags.
---

# Release log

Write release notes for `uniffy-io/uniffy` from changes that shipped. Commit subjects and PR descriptions are clues, not evidence of scope or behavior. One commit can contain several unrelated changes, and one feature can span several commits.

## Invocation and output

- `$release-log v0.0.3`: draft notes for that tag.
- `$release-log from v0.0.2 to HEAD`: draft notes for an upcoming release.
- `$release-log v0.0.3 publish`: write notes and publish them to that existing GitHub release.

## Establish release range

Use refs supplied by user. If target is omitted, resolve latest published stable GitHub release and state that choice. If request is explicitly for upcoming work, resolve `HEAD`. Ask only when request does not establish which of these is intended.

Fetch missing history and tags without overwriting local tags. Resolve target and base to immutable commit SHAs and record both. Read code at those SHAs rather than assuming working tree matches release.

Unless user supplies base, choose highest earlier stable version whose published release tag is an ancestor of target. Compare numeric version components, not tag names lexically or creation dates. Exclude drafts and release candidates from base selection. Both candidate and stable notes normally cover changes since previous stable release, so promoting a candidate does not hide its features. Paginate GitHub release and commit lists when needed.

Confirm base is an ancestor of target. For an actual first release, inspect target history and describe initial shipped capabilities. If a base cannot be found because history or GitHub access is incomplete, report that gap instead of treating it as first release. Never silently widen an explicit range.

## Build evidence from code

Inventory every commit and changed path in range. Useful commands, with resolved SHAs in `base` and `target`:

```bash
git log --reverse --format='%H %s' "$base..$target"
git diff --find-renames --stat "$base" "$target"
git diff --find-renames --name-status "$base" "$target"
git show --format=fuller --find-renames "$commit" -- "$path"
git show "$target:$path"
```

Read patches and relevant surrounding code for each affected area. Inspect tests, migrations, configuration and public docs to establish what changed and who experiences it. Read linked PRs or issues for intent when useful, then verify claims against code. Do not turn test names into claims that tests passed.

Inspect merge resolutions as well as ordinary commits. Use first-parent merge diffs when needed, but count merged work once. Review large changes in bounded path groups; do not summarize only first page of commits or truncated patches. Check final base-to-target diff and target code to exclude reverted work, superseded behavior and unfinished wiring.

Maintain evidence table with these columns:

| Change | Product area and audience | Before and after | Supporting commits and paths | Include or omit, with reason |
| --- | --- | --- | --- | --- |

Account for every commit through one or more changes, or an explicit omission such as internal cleanup with no user impact. Split a broad commit across real outcomes. Combine related commits into one outcome. Every published claim must map to evidence. Keep uncertain claims in analysis with their open questions instead of presenting them as shipped facts.

For example, a commit titled `cleanup` might fix note search and add file previews. Explain those two outcomes under Notes and Files after checking their code. A later commit that adjusts preview loading belongs with same Files outcome. Neither commit title dictates release structure.

## Write for users and operators

Group notes by affected product area, such as Notes, Files, Chat or Projects. Combine backend and frontend work when they deliver one feature. Use separate Mobile, Administration or Deployment sections when audience or platform differs. Choose headings from actual impact, not a fixed directory map. Omit empty sections.

Lead with meaningful capabilities and fixes. Explain concrete behavior and benefit. For fixes, say what failed and what works now. Include migration steps, changed defaults, compatibility breaks and required operator action prominently when code or shipped docs establish them. Check both cloud and self-hosted implications where relevant.

Keep internal refactors, dependency churn and CI work out unless they have meaningful user, security or operational impact. Mention only supported impacts. Do not invent performance numbers, claim complete feature coverage from partial changes, or advertise capabilities that are disabled or unavailable in target release without explaining their limits.

Use short sentences. No emojis, em dashes, filler, raw commit dumps or empty `No changes` sections. Link public PRs or commits when they help readers, and include full comparison link for a bounded release range. Keep internal plans, evidence paths and undisclosed security findings out of public copy.

Release pipeline attaches `images.txt`, its Sigstore bundle and SBOMs independently of notes. Refer readers to those assets and [release verification docs](https://uniffy.io/docs/deployment/verify/) when useful. Read actual asset names and image refs before including them. Never invent digests or signatures. Stable images use exact version and `latest`; release candidates use exact version only. Prefer signed digest pins for deployment instructions.

## Review and publish

Reconcile draft with evidence table. Check mixed-purpose commits were split, related work was combined, and reverted or incomplete changes were excluded. Report any gaps in coverage. Show draft path, resolved range and brief summary to user. A draft request ends with local files; do not modify GitHub release.

Publish only when user requests publication or has already authorized it in current task. Re-read release body before editing. If someone changed it since drafting, incorporate their edits or clarify conflicting content before replacement. Confirm tag still resolves to recorded target SHA. If release does not exist yet, retain draft and report that publication awaits release workflow.

Update only notes through a body file:

```bash
gh release edit "$tag" --repo uniffy-io/uniffy --notes-file "$draft"
```

Leave tags, titles, release status and assets intact. Read body back to verify update and return release URL. Do not create a tag, trigger a release build or publish unrelated work as part of this skill.
