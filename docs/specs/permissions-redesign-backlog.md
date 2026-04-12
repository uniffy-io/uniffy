# Permission Redesign -- Implementation Backlog

> Companion to `permissions-redesign.md` (authoritative design).
> Tracks progress across sessions so any LLM or human can pick up where the previous worker left off.
>
> **Status key:**
> - `[ ]` not started
> - `[~]` in progress (include brief note: branch, partial file list)
> - `[x]` done
> - `[!]` blocked (include reason)

## How to resume this work

1. Read `docs/specs/permissions-redesign.md` end to end. That is the authoritative design. Do not improvise; if something seems wrong, update the design doc first and leave a note in this backlog.
2. Find the first `[ ]` or `[~]` item in the list below. Start there.
3. After every meaningful change, update this file to reflect the new state. Commit the backlog update together with the work.
4. After a phase is complete, run the listed verification commands before marking the phase done.
5. If you need to deviate from the plan, write a note in the relevant section explaining why.

Critical rules:

- No backwards compatibility. We delete `VisibilityScope`, `PermissionLevel`, `ContentPermission`, `ContentGroupLink`, the `visibility` columns on every content table, the `permissions.v1.PermissionsService` RPC, and the frontend `features/sharing/` module. Do not preserve them.
- The DB will be recreated from migrations on the next startup. Migrations have been rewritten in place to use the new model from scratch -- there is no separate 043 migration.
- `./run.sh proto` must be run whenever proto files change.
- `./run.sh lint-backend` and `./run.sh test` must be clean at the end of each phase before moving on.
- Follow the existing conventions: module-level enum variables in migrations, absolute imports, etc. See `CLAUDE.md`.
- Shared enums live in `src/uniffy/core/types.py`. `src/uniffy/core/models/shared.py` is a thin re-export. Do not import from `core.models.shared` in files that sit inside `core.auth`, `core.content`, `core.events`, or `core.search` -- that triggers a circular import. Use `core.types` instead. Lazy-import model classes inside function bodies when needed.

---

## Progress summary

| Phase | Description | Status |
|---|---|---|
| 0 | Foundation: enums, models, permission engine, audit log, migrations, protos, gen code | `[x]` |
| 1 | Domains: notes, files, calendar, projects, agents, rooms, comments, chat, permissions, organizations, search, seed | `[x]` |
| 2 | Frontend: new permissions feature, delete sharing feature, update all pages | `[ ]` |
| 3 | End-to-end verification | `[ ]` |

Phase 1 sub-status:

| Domain | Status |
|---|---|
| 1.0 Permissions (MembersService) | `[x]` |
| 1.1 Notes | `[x]` (reference implementation) |
| 1.2 Files / Folders | `[x]` |
| 1.3 Calendar | `[x]` |
| 1.4 Projects | `[x]` |
| 1.5 Agents (4 sub-domains) | `[x]` |
| 1.6 Rooms | `[x]` |
| 1.7 Comments (delegates) | `[x]` |
| 1.8 Attachments (delegates) | `[x]` |
| 1.9 Chat (drop unused `visibility`) | `[x]` |
| 1.10 Organizations | `[x]` |
| 1.10a Owner deletion preserves content | `[ ]` |
| 1.12 Search | `[x]` |
| 1.13 Factory / workers / seed | `[x]` |
| 1.16 Verification | `[x]` (lint-backend clean; factory imports clean) |

Current worker: (empty -- set to your identifier when you start working)
Last updated: 2026-04-12

Branch: `refactor/permissions-redesign` (started from `main` at 47798a1).
Baseline commit on the branch: `8954eee refactor(permissions): phase 0 + notes/files/calendar/projects domains`.

**The next LLM should use `src/uniffy/domains/notes/` as the reference for every remaining domain**: `operations.py` shows the canonical class layout with `_resolve_access_policy`, `_extract_content_fields`, `_notify_new_mentions`, and the `_load_*` / content loader registration pattern; `converters.py` shows the enum-map + `_build_*` helpers pattern; `handlers.py` shows the `_parse_uuid` / `_map_domain_error` / `_parse_canvas_content` thin-handler pattern. Every other domain should mirror that structure, not invent its own.

**Phase 0 achievements:**
- Deleted `VisibilityScope` and `PermissionLevel` enums. Consolidated all shared enums into `core/types.py`. `core/models/shared.py` is now a thin re-export.
- Added `ContentRole`, `AccessMode`, `ContentMemberAction` enums.
- Created `ContentMember` and `ContentMemberEvent` models. Deleted `ContentPermission` and `ContentGroupLink` models.
- Rewrote `PermissionChecker` with `effective_role()` + `_get_member_role()`; org/domain admin bypasses preserved; BLOCKED-wins semantics on group lookups.
- Rewrote `ContentAccessQuery.build_accessible_filter()` for the new model.
- Rewrote `BaseContentOperations` with `_resolve_role` + `_require_view/edit/delete/manage/transfer`; removed the old group-link helpers; new search indexing path (shared+blocked user/group lists, access_mode, baseline_role).
- Rewrote `core/content/cascade.py` -- cascade_member_grant writes VIEWER ContentMember rows on referenced content. Removed cascade_visibility_change entirely.
- Added `core/content/members.py` with `ContentMembersOperations` (CRUD + set_access_mode + transfer_ownership + list_member_events). Uses a `register_content_loader(content_type, loader)` registry for polymorphic content fetching.
- Added `core/auth/permissions/roles.py` with `ROLE_ORDINAL` + `role_can_*` helpers.
- Added `core/auth/permissions/audit.py` with six `record_*` helpers that append audit rows.
- Updated `core/auth/permissions/helpers.py` to use the new `require_*` signatures.
- Updated `core/auth/domain_admin.py` to lazy-import `DomainAdmin` to avoid circulars.
- Rewrote ALL initial migrations in place (001-041) to use `access_mode`/`baseline_role` instead of `visibility`, and to create `permissions_content_members` / `permissions_content_member_events` / updated `permissions_org_defaults` from the start. No backfill migration -- the DB is recreated fresh. NO migration 043 exists.
- Updated `core/content/model_mixins.py` with `access_mode_field()` and `baseline_role_field()` helpers (replacing `visibility_field()`).
- Updated all 15 content model files (`notes`, `files/file,folder,multipart_upload,saved_filter`, `calendar/event,template,calendar`, `projects/project,task`, `rooms/room`, `agents/agent,provider_key,prompt,cron_task`, `chat/channel`) to use the new columns. Projects dropped `member_ids`. Tasks and chat channels dropped `visibility` entirely. `calendar/calendar.py` gained new columns (did not previously have visibility).
- Updated the `OrganizationPermissionDefaults` model and `domains/organizations/defaults.py` (the `ORG_PERMISSION_DEFAULTS` dict) with the new shape: `default_access_mode` + `default_baseline_role`.
- Updated all proto files: `common.proto` defines `ContentRole`, `AccessMode`, `ContentMemberAction` (and deletes `VisibilityScope`/`PermissionLevel`). Every domain proto (notes, files, cal, projects, agents/*, rooms, organizations) was updated -- `visibility` fields replaced with `access_mode` + `baseline_role`, `permission_level`/`user_permission_level` fields replaced with `role`/`user_role`. `projects.proto` dropped `member_ids`.
- Completely replaced `permissions/v1/permissions.proto` with the new `MembersService` (7 RPCs: ListMembers/AddMember/UpdateMemberRole/RemoveMember/SetAccessMode/TransferOwnership/ListMemberEvents) plus ContentMember/ContentAccessPolicy/ContentMemberEvent messages.
- Regenerated proto code (python, typescript, go) via `./run.sh proto`.
- Rewrote `core/converters/common_proto.py` with `content_role_*`, `access_mode_*`, `content_member_action_*` converter functions and removed all `visibility_*` / `permission_level_*` converters. Updated `core/converters/__init__.py` exports.
- Updated search indexer (`core/search/indexer.py`, `core/search/meilisearch.py`) to take `access_mode` + `baseline_role` + `shared_*`/`blocked_*` member lists instead of `visibility`. The Meilisearch document schema has `access_mode`, `baseline_role`, `blocked_user_ids`, `blocked_group_ids` fields and the permission filter query uses them.

**Phase 0 verification** (all clean):
- `rtk uv run ruff check src/uniffy` → `All checks passed!`
- `rtk uv run python -c "from uniffy.core.auth.permissions import PermissionChecker; from uniffy.core.content.base_operations import BaseContentOperations; from uniffy.core.content.members import ContentMembersOperations; print('ok')"` → `ok`
- `rtk grep -n "VisibilityScope\|PermissionLevel\|ContentPermission\|ContentGroupLink\|members_can_" src/uniffy/core` → zero matches
- `rtk grep -n "VisibilityScope\|PermissionLevel\|permission_level" src/proto` → zero matches
- `rtk grep -n "visibility" src/uniffy/db/migrations` → zero matches

**What's still broken** (after 2026-04-12 session):
- `src/uniffy/domains/users/` user deletion path has not been updated to clean up `ContentMember` rows (task 1.10a).
- Legacy proto messages in `notes.proto` (`ContentPermission`, `GrantPermissionRequest`, `RevokePermissionRequest`, `NoteSharingResponse.permissions`) and the corresponding `share_note_with_group` / `grant_permission` / `revoke_permission` RPCs are still defined and mapped to `UNIMPLEMENTED` stubs. They can be deleted once the frontend stops calling them.
- The frontend is entirely unchanged and still talks the old API.

**Done in the 2026-04-11 session:**
- Permissions domain rewritten to host `MembersService` (see section 1.0 below). `factory.py` now mounts `MembersServiceASGIApplication` under `/permissions.v1.MembersService`.
- Notes domain fully migrated and refactored into the reference implementation.
- Files / folders / saved-filter converters migrated.
- New helper: `core/auth/permissions/defaults.py::resolve_content_defaults(session, org_id, content_type)` -- resolves the per-org access policy defaults with fallback to `ORG_PERMISSION_DEFAULTS`. Every domain's `create()` path must call this instead of hard-coding a default.
- New helper: `db/session.py::open_session` (``asynccontextmanager``) -- use with ``async with`` in RPC handlers so the type checker can prove the ``return`` inside is reachable. Exported from `uniffy.db`.

**Done in the 2026-04-12 session:**
- Calendar domain (1.3) migrated. `CalendarEventOperations` and `EventTemplateOperations` use `access_mode`/`baseline_role`, `_resolve_access_policy` helper, `ContentMembersOperations.add_member` for initial group members, and register a `CALENDAR_EVENT` loader. Handlers rewritten with `_parse_uuid` / `_map_domain_error` and `open_session`. Converters dropped the visibility map and use `access_mode_to_proto` / `content_role_to_proto`.
- Projects domain (1.4) migrated. `ProjectOperations` dropped `member_ids`, dropped `_propagate_visibility_to_tasks`, and now resolves access defaults via `resolve_content_defaults`. `TaskOperations._resolve_role` delegates to the parent project, and `_index_for_search` was overridden to index tasks with the project's access policy and member rows. `SprintOperations._verify_project_manage` replaces `_verify_project_admin` (uses `_require_manage`). Handlers rewritten with `_parse_uuid` / `_map_domain_error` and `open_session`. Converters dropped `permission_level_to_proto` / `visibility_to_proto` and use `access_mode_to_proto` / `content_role_to_proto` + `user_role` fields. `PROJECT` and `TASK` loaders registered.
- Rooms domain (1.6) migrated. `RoomOperations.create_room` / `update_room` take `access_mode` + `baseline_role`; `_resolve_access_policy` helper; list filter uses the canonical `build_accessible_filter`. `BookingOperations.list_bookings` uses the new access filter columns. `_load_room` loader registered.
- Agents sub-domains (1.5) migrated:
  - `agents/agents/operations.py`: `AgentOperations.create_agent` / `update_agent` take `access_mode` + `baseline_role`; audit logging kept for security-relevant field changes; `_load_agent` registered.
  - `agents/providers/operations.py`: `ProviderOperations.list_keys` uses `OPEN_TO_ORG` + `ContentMember` for visibility instead of the old `ContentPermission` table; key creation goes through `_resolve_access_policy`; `_load_provider_key` registered.
  - `agents/prompts/operations.py`: `PromptOperations` uses `access_mode` + `baseline_role`; `list_prompts` applies the canonical access filter + bundled fallback; `_load_prompt` registered.
  - `agents/cron/operations.py`: `CronTaskOperations` writes cron tasks directly (no base CRUD); list query filters tasks via the parent agent's access; `_load_cron_task` registered; `ContentType.AGENT_CRON_TASK` added to `common.proto` and `common_proto.py`.
  - All four `handlers.py` rewritten with the thin `_parse_uuid` / `_map_domain_error` / `open_session` pattern. All four `converters.py` files dropped `visibility_to_proto` and use `access_mode_to_proto` / `content_role_to_proto`.
  - `agents/tools/builtin/{projects,calendar,cron}.py` updated: the `visibility` tool argument was replaced with `access_mode` (schema + parsing); cron tool defaults to `AccessMode.OWNER_ONLY`.
- Comments domain (1.7) audited. `_verify_content_access` / `_verify_content_edit` now delegate to `PermissionChecker.effective_role` via `_load_parent_policy`, which loads the parent content's `owner_id` / `access_mode` / `baseline_role` (tasks delegate to their parent project).
- Attachments domain (1.8) audited. Same delegation pattern. The Attachments folder is now `OWNER_ONLY`; file copies inherit `OPEN_TO_ORG` from parent content, otherwise fall back to `OWNER_ONLY`. The file-access subquery uses `access_mode_column` / `baseline_role_column`.
- Chat channels (1.9) migrated. `ChatChannelOperations._require_view` replaces `_require_access`; the base class helper name is the new one. `_index_for_search` now indexes as `OPEN_TO_ORG` (public) or `EXPLICIT_MEMBERS` + the channel member list (private). `_derive_visibility` helper deleted; the `visibility` column had already been removed from the model.
- Organizations domain (1.10) migrated. `OrganizationOperations.update_permission_defaults` takes `default_access_mode` + `default_baseline_role` instead of `default_visibility` + `members_can_*`. Handlers rewritten to parse the new fields. Proto trimmed: `UpdatePermissionDefaultsRequest` and `ContentTypeDefaults` no longer expose `members_can_*`.
- Search domain (1.12) migrated. `SearchOperations.index_item` and `SearchResult` now use `access_mode` / `baseline_role`. `get_references` filters notes through `ContentAccessQuery.build_accessible_filter` (no more hardcoded `visibility == ORGANIZATION` checks). `_get_user_group_ids` moved into the operations class.
- Seed + workers (1.13). `db/seed.py`, `db/seed_dev.py`, `scripts/stress/stressseed.py` and `workers/tasks/content_extraction.py` all updated to use `access_mode` / `baseline_role` and the new `SearchIndexer.index` signature.
- Verification (1.16). `./run.sh lint-backend` is clean. `from uniffy.factory import create_app` imports cleanly, exercising the full permissions-redesigned domain graph.

---

## Phase 0 -- Foundation  [DONE]

See the "Phase 0 achievements" list at the top of this document for the full inventory of what shipped. Verification:

- `rtk uv run ruff check src/uniffy` -- clean
- Foundation imports load without circular errors
- Phase 0 delivered: enums, new models, migrations, protos, regenerated gen code, search integration, cascade rewrite, and the generic `ContentMembersOperations` class.

The detailed 0.x checklist below is kept for historical reference. All items are complete.

### 0.1 Delete legacy primitives -- done

- [x] Delete `src/uniffy/core/models/permissions/content_permission.py`
- [x] Delete `src/uniffy/core/models/permissions/content_group_link.py`
- [x] Remove `ContentPermission` and `ContentGroupLink` from `src/uniffy/core/models/permissions/__init__.py`
- [x] Remove `ContentPermission` and `ContentGroupLink` from `src/uniffy/core/models/__init__.py`

### 0.2 New enums -- done

- [x] New enums defined in `src/uniffy/core/types.py` (canonical) and re-exported from `src/uniffy/core/models/shared.py`.
- [x] `VisibilityScope` and `PermissionLevel` deleted.

### 0.3 New models -- done

- [x] `content_member.py`, `content_member_event.py` created and exported.

### 0.4 `OrganizationPermissionDefaults` -- done

- [x] New columns `default_access_mode` + `default_baseline_role`. Old columns removed. `ORG_PERMISSION_DEFAULTS` dict updated.

### 0.5 Role capability helpers -- done

- [x] `src/uniffy/core/auth/permissions/roles.py` created with `ROLE_ORDINAL`, `MIN_FOR_*`, and `role_can_*` predicates.

### 0.6 Audit log helper -- done

- [x] `src/uniffy/core/auth/permissions/audit.py` with six `record_*` helpers (one per `ContentMemberAction`). Each adds an immutable audit row to the session without committing; the caller commits atomically with the underlying mutation.

### 0.7 Rewrite `PermissionChecker` -- done

- [ ] In `src/uniffy/core/auth/permissions/checker.py`:
  - [ ] Delete old methods: `can_access_content`, `can_edit_content`, `can_delete_content`, `can_share_content`, `can_move_content`, `get_user_permission_level`, `_has_explicit_permission`, `_has_permission_level`, `_get_user_permission`, `get_content_groups`, `get_user_groups`
  - [ ] Keep helpers: `_is_org_admin`, `_is_domain_admin_for_content`, `_is_user_in_organization`, `_get_user_org_role`, `_org_defaults_allow` (rename to fit the new signature)
  - [ ] Add `effective_role()` -- exact signature from design doc
  - [ ] Add `_get_member_role()` -- exact semantics from design doc (BLOCKED wins, highest of direct + group)
  - [ ] Remove the `_can_access_group_content` method (replaced by the member lookup path)
  - [ ] Remove `_org_defaults_allow` if it's no longer needed under the new model (baseline is per-content now)
- [ ] Verify: `grep -r "PermissionLevel\|VisibilityScope\|can_view=\|can_edit=\|can_delete=\|can_share=\|can_move=" src/uniffy/core/auth` returns zero results

### 0.8 Rewrite `ContentAccessQuery` -- done

- [ ] In `src/uniffy/core/auth/permissions/queries.py`:
  - [ ] Delete `build_accessible_filter` (old), `build_personal_filter`, `build_group_filter`, `build_organization_filter`, `build_shared_with_me_filter`, `get_user_group_ids`, `apply_visibility_filter`
  - [ ] Rewrite `build_accessible_filter` with the new signature (takes `access_mode_column` and `baseline_role_column`)
  - [ ] Add `build_shared_with_me_filter` v2 (owned=False + any non-blocked grant + open_to_org with baseline)
  - [ ] Delete `get_accessible_content_ids` (unused once domains are updated) or update its signature too
- [ ] Verify no remaining references to `VisibilityScope` or `ContentPermission` in `queries.py`

### 0.9 Rewrite `BaseContentOperations` -- done

- [ ] In `src/uniffy/core/content/base_operations.py`:
  - [ ] Remove `_require_access`, `_require_edit`, `_require_admin`, `_require_delete` (old implementations)
  - [ ] Add `_resolve_role` method (uses `effective_role`)
  - [ ] Add `_require_role(predicate, action)` helper
  - [ ] Add `_require_view`, `_require_edit`, `_require_delete`, `_require_manage`, `_require_transfer`
  - [ ] Update `list_accessible()` to use the new filter builder signature (passing `access_mode_column` and `baseline_role_column`)
  - [ ] Update the column accessors to expose `_get_access_mode_column` and `_get_baseline_role_column`
  - [ ] Remove `_create_group_links`, `_get_content_group_ids`, `_remove_group_links` (ContentGroupLink is gone)
  - [ ] Update `_index_for_search` to pass access_mode and baseline_role to the indexer instead of visibility; use `ContentMember` rows for `shared_user_ids`/`shared_group_ids`
  - [ ] Remove `group_ids` parameter from `create()` and any callers' reliance on it
  - [ ] Update `_get_shared_user_ids` to use `ContentMember` instead of `ContentPermission`
- [ ] Verify: `grep -r "VisibilityScope\|ContentPermission\|ContentGroupLink\|PermissionLevel" src/uniffy/core/content` returns zero results

### 0.10 Rewrite cascade -- done

- [ ] In `src/uniffy/core/content/cascade.py`:
  - [ ] Rewrite `cascade_permission_grant` to write `ContentMember(role=VIEWER)` rows instead of `ContentPermission`
  - [ ] Remove visibility-cascade logic for GROUP and ORGANIZATION (those modes are gone)
  - [ ] Add an "access mode changed" cascade path if needed: when a content item becomes OPEN_TO_ORG, no cascade (org members get implicit baseline); when a content item becomes EXPLICIT_MEMBERS with no listed members, no cascade; when members are added, existing cascade behavior applies per-member
  - [ ] Update `PermissionLevel.VIEW` references to `ContentRole.VIEWER`

### 0.11 `ContentMembersOperations` -- done

- [ ] Create `src/uniffy/core/content/members.py`:
  - [ ] `CONTENT_LOADERS` dict and `register_content_loader` function
  - [ ] `ContentMembersOperations` class
  - [ ] Methods: `list_members`, `add_member`, `update_member_role`, `remove_member`, `set_access_mode`, `transfer_ownership`, `list_member_events`
  - [ ] Each mutating method:
    1. Resolves actor's effective role via `permission_checker.effective_role`
    2. Enforces the right capability (`role_can_manage` / `role_can_transfer`)
    3. Applies the mutation
    4. Writes a `ContentMemberEvent` row via `audit.record_member_event`
    5. Updates search indexer sharing metadata via `SearchIndexer.update_sharing`
    6. Emits `PERMISSION_GRANTED` / `PERMISSION_REVOKED` notification where appropriate
  - [ ] Validation rules from the design doc "Edge cases" section
- [ ] Tests in `tests/core/test_member_ops.py` -- all cases from the design doc test plan

### 0.12 Migration -- done (NOTE: implementation deviated from the original plan)

Per user direction, there is no `043_permissions_redesign.py` migration. The user said "delete the first migrations and put our migrations there we will recreate the db, no need to bloat the migrations we don't need to even know what the old model was". Migrations 001, 003, 004, 006, 007, 008, 010, 011, 020, 021, 027, 028, 029, 037, 041 were rewritten in place to create the new schema from scratch. There is no backfill code.

The original 0.12 checklist below is left as historical reference:

- [ ] Create `src/uniffy/db/migrations/versions/043_permissions_redesign.py`:
  - [ ] Revision: `043`, down_revision: `042`
  - [ ] Create new enums at the Postgres level: `contentrole`, `accessmode`, `contentmemberaction`
  - [ ] Create `permissions_content_members` table with indexes and unique constraint
  - [ ] Create `permissions_content_member_events` table with indexes
  - [ ] Alter `permissions_org_defaults`: add new columns, drop old columns, backfill defaults for existing orgs (mapping from the design doc table)
  - [ ] Drop `permissions_content_permissions` table
  - [ ] Drop `permissions_content_group_links` table
  - [ ] Drop `permissionlevel` Postgres enum
  - [ ] **For each access-controlled content table**: add `access_mode` + `baseline_role` columns, backfill from existing `visibility` column, drop the old `visibility` column:
    - [ ] `notes_notes`
    - [ ] `files_files`
    - [ ] `files_folders`
    - [ ] `calendar_events`
    - [ ] `calendar_calendars` (add new columns, no visibility to migrate)
    - [ ] `projects_projects` (also drop `member_ids`)
    - [ ] `rooms_rooms`
    - [ ] `agents_agents`
    - [ ] `agents_provider_keys`
    - [ ] `agents_prompts`
    - [ ] `agents_cron_tasks`
  - [ ] For child tables, drop the `visibility` column (no new columns added, they delegate):
    - [ ] `projects_tasks`
    - [ ] `chat_channels` (drop unused `visibility`; `channel_type` already drives access)
  - [ ] Drop `visibilityscope` Postgres enum (after all tables are updated)
  - [ ] Backfill `content_members` from `content_permissions`:
    - Map `permission_level` (VIEW→VIEWER, EDIT→EDITOR, ADMIN→ADMIN, OWNER→OWNER)
    - Preserve `granted_by_user_id`→`added_by_user_id`, `granted_at`→`added_at`, `expires_at`
  - [ ] Backfill `content_members` from `content_group_links` with `role=VIEWER` and `subject_type=GROUP` (unless a higher `ContentPermission` row exists for the group)
  - [ ] Write a `ContentMemberEvent` row for every backfilled member with `action=MEMBER_ADDED`, `actor_user_id=system` (there is no system user; fall back to `added_by_user_id`), `occurred_at=added_at`. This creates the initial audit trail.
- [ ] Write the migration's `downgrade()` as a best-effort rollback (not critical since we're not in production, but good hygiene)
- [ ] Test the migration forward and back against a fresh DB

### 0.13 Tests -- deferred

Unit tests for the foundation were NOT written in Phase 0. They are still valuable but were deferred because implementing them against a live database requires test infrastructure setup and because the integration cost is lower if we write them together with the Phase 1 domain rewrites (which will exercise the same code paths).

Test files to add later (not blockers for Phase 1):

- [ ] `src/uniffy/tests/core/test_role_capabilities.py` -- every `role_can_*` combination, including None and BLOCKED
- [ ] `src/uniffy/tests/core/test_effective_role.py` -- every branch of `effective_role`
- [ ] `src/uniffy/tests/core/test_member_lookup.py` -- `_get_member_role` direct + group, BLOCKED wins, highest role wins, expiration
- [ ] `src/uniffy/tests/core/test_access_query.py` -- `build_accessible_filter`: owned, explicit member, OPEN_TO_ORG, BLOCKED exclusion, group BLOCKED exclusion, cross-org isolation
- [ ] `src/uniffy/tests/core/test_member_ops.py` -- every method of `ContentMembersOperations`, every rejection case
- [ ] `src/uniffy/tests/core/test_member_events.py` -- audit log emission on every operation, pagination, filters

### 0.14 Verification -- done

- [x] `rtk uv run ruff check src/uniffy` -- All checks passed
- [x] Core imports round-trip without circular errors
- [x] `rtk grep -n "VisibilityScope\|PermissionLevel\|ContentPermission\|ContentGroupLink" src/uniffy/core` -- zero matches
- [x] `rtk grep -n "VisibilityScope\|PermissionLevel" src/proto` -- zero matches

Phase 0 is done. Domain imports (`src/uniffy/domains/*`) are expected to be broken because they still reference the deleted types -- that's Phase 1.

---

## Phase 1 -- Domains

Goal: update every domain to use the new model. After phase 1, the entire backend compiles, imports without errors, runs, lints, and passes tests. No frontend work yet.

**>>> REFERENCE IMPLEMENTATION: `src/uniffy/domains/notes/` <<<**

The notes domain was rewritten in the 2026-04-11 session and is the canonical example every other domain should mirror. When you rewrite a domain:

1. Read `src/uniffy/domains/notes/operations.py` top to bottom to understand the class layout (abstract hooks, public CRUD, domain-specific ops, private helpers, loader registration).
2. Copy the structure: imports grouped by origin, helpers grouped at the bottom of the class.
3. Reuse these helpers verbatim in your new domain: `_resolve_access_policy` (defaults resolution + validation), `_extract_content_fields` if your domain has a body/canvas split, `_notify_new_mentions`, `_emit_shared_notification`, `_apply_access_filter`, `_group_member_subquery`.
4. For handlers: `src/uniffy/domains/notes/handlers.py` has module-level `_parse_uuid`, `_parse_canvas_content`, and `_map_domain_error` helpers. Copy those patterns; do not duplicate the try/except chain per method.
5. For converters: `src/uniffy/domains/notes/converters.py` shows the `_build_*` private helper pattern. The top-level functions stay short; field-by-field building goes in private helpers.
6. Access-mode changes ALWAYS go through `ContentMembersOperations.set_access_mode` (never mutate `access_mode` on the row directly).
7. Every domain's `create()` MUST call `resolve_content_defaults(session, org_id, content_type)` from `core.auth.permissions` to pick up org defaults.
8. Every domain MUST register a `_load_<content>` loader and call `register_content_loader(ContentType.X, _load_<content>)` at the bottom of `operations.py`.
9. **Use `open_session` from `uniffy.db`, not `get_async_session`, inside handlers.** The old `async for session in get_async_session():` pattern confuses type checkers (``ty`` flags "Function can implicitly return ``None``"). Write:

   ```python
   from uniffy.db import open_session

   async def create_note(self, request, ctx) -> NoteResponse:
       ...
       try:
           async with open_session() as session:
               ops = NoteOperations(session)
               note = await ops.create(...)
               return NoteResponse(note=note_to_proto(note))
       except ConnectError:
           raise
       except Exception as exc:
           raise _map_domain_error("create_note", exc) from exc
   ```

   `get_async_session` remains available for FastAPI ``Depends`` callers and for workers that iterate explicitly; new handler code must use `open_session`.
10. **Do NOT write meta documentation in the source files.** No big module-level docstrings that describe the file layout or "reference structure", no `# ----- Section Name -----` dividers between method groups, no class docstrings that list every inherited method. This information belongs in the backlog and in `docs/agents/backend.md`, not in the code. Module docstrings stay to one line (`"""Note operations."""`). Class docstrings stay to one sentence. Method docstrings are fine and expected. Layout conventions are enforced by reading the notes domain as a worked example, not by restating them in every file. The 2026-04-11 session initially wrote the long reference docstrings and they were stripped right after; do not re-add them in other domains.
11. **Do NOT extend `BaseContentOperations.create` / `update` / `delete`.** Those methods were removed from the base class (LSP violation -- every domain needs a domain-specific signature). Subclasses implement their own `create`, `update`, and `delete` directly. The base class provides `get_by_id`, `list_accessible`, `_fetch_by_id`, `_resolve_role`, `_require_*`, `_index_for_search`, the search-indexing abstract hooks, and the column accessors -- nothing else for CRUD.

**Status of prep work:**
- All 15 content model files (notes, files/*, calendar/*, projects/*, rooms, agents/*, chat/channel) already use the new `access_mode` + `baseline_role` columns. That work happened during Phase 0 to break circular imports. You do NOT need to edit the core model files.
- All proto files already use the new enums. Proto code is already regenerated.
- `common_proto.py` already has the new converter functions (`access_mode_to_proto`, `content_role_to_proto`, etc.) and no longer has `visibility_to_proto` or `permission_level_to_proto`.
- `core/auth/permissions/defaults.py::resolve_content_defaults` is the canonical defaults resolver. Import from `uniffy.core.auth.permissions`.

**What's left for each domain:**

```
- [ ] Drop any `from uniffy.core.models.shared import VisibilityScope` or `PermissionLevel` imports (replace with core.types if any other enums are needed)
- [ ] Drop any `from uniffy_proto.*_pb2 import VisibilityScope, PermissionLevel` imports
- [ ] Drop any ContentPermission / ContentGroupLink imports and usages
- [ ] Replace any `visibility_to_proto`, `visibility_from_proto`, `permission_level_to_proto`, `permission_level_from_proto` imports -- these functions no longer exist
- [ ] Replace `content.visibility` reads with `content.access_mode` (and `content.baseline_role` where relevant)
- [ ] In create flows: read org defaults (`default_access_mode`, `default_baseline_role`) and set them on the new row
- [ ] Replace `BaseContentOperations._require_access/_require_edit/_require_admin/_require_delete` with `_require_view/_require_edit/_require_delete/_require_manage/_require_transfer` from the new base class
- [ ] Remove any calls to `can_access_content`, `can_edit_content`, `can_delete_content`, `can_share_content`, `can_move_content`, `get_user_permission_level` -- these are deleted from PermissionChecker. Use `effective_role()` + `role_can_*()` helpers
- [ ] Remove any visibility propagation logic (tasks no longer carry visibility)
- [ ] Update converters to expose `access_mode` and `baseline_role` on Info messages and to accept them on Create/Update messages
- [ ] Update handlers to forward `access_mode` / `baseline_role` from request messages into operations
- [ ] For child content types (TASK, COMMENT, ATTACHMENT, etc.): override `_resolve_role` on the Operations class to load the parent and delegate
```

### 1.0 Permissions domain -- [DONE 2026-04-11]

Completed. The domain now hosts `MembersService`:

- [x] `domains/permissions/operations.py` -- DELETED. Operations live in `core/content/members.py::ContentMembersOperations`.
- [x] `domains/permissions/handlers.py` -- implements the `MembersService` Protocol: `list_members`, `add_member`, `update_member_role`, `remove_member`, `set_access_mode`, `transfer_ownership`, `list_member_events`. All delegate to `ContentMembersOperations`.
- [x] `domains/permissions/converters.py` -- `content_member_to_proto`, `content_access_policy_to_proto`, `content_member_event_to_proto`.
- [x] `domains/permissions/service.py` -- `MembersServiceImpl(MembersHandlers)`.
- [x] `factory.py` -- mounts `MembersServiceASGIApplication` at `/permissions.v1.MembersService` (the generated class in `permissions_connect.py` is still named `permissions_pb2` but the service class is `MembersServiceASGIApplication`).
- [ ] **Per-domain loader registration** -- each content domain still needs `register_content_loader(ContentType.X, _load_X)` at the bottom of its `operations.py`. Notes, Files, and Folder loaders are registered. Calendar / Project / Task / Agent / ProviderKey / Prompt / CronTask / Room still to do.

### 1.1 Notes -- [DONE 2026-04-11, reference implementation]

Completed and set as the canonical reference. See the "REFERENCE IMPLEMENTATION" banner above this section for the list of patterns other domains should copy.

- [x] `domains/notes/operations.py` -- full rewrite with the new structural docstring and private helpers (`_resolve_access_policy`, `_extract_content_fields`, `_notify_new_mentions`, `_emit_shared_notification`, `_apply_access_filter`, `_group_member_subquery`, sharing-info sub-helpers).
- [x] `domains/notes/handlers.py` -- thin handlers using `_parse_uuid` / `_parse_canvas_content` / `_map_domain_error`. Legacy RPCs kept as `UNIMPLEMENTED` stubs pointing at `MembersService`.
- [x] `domains/notes/converters.py` -- cleaned up, private `_build_*` helpers extracted.
- [x] `domains/notes/queries.py` -- no visibility refs (only a slug / tag helper).
- [x] Loader `_load_note` registered.
- [ ] **Follow-up: legacy RPCs (`share_note_with_group`, `unshare_note_from_group`, `get_note_sharing`, `grant_permission`, `revoke_permission`, `copy_note`) should be removed from `notes.proto` so the stubs can go away.**

### 1.2 Files / Folders -- [DONE 2026-04-11 except minor follow-ups]

- [x] `domains/files/operations.py` -- `FileOperations` + `FolderOperations` updated. `initiate_upload` / `complete_upload` stamp `access_mode` / `baseline_role` from the `MultipartUpload` row. `update()` dropped the `visibility` parameter. `list_files` uses the notes-style access filter. `FolderOperations.create()` calls `resolve_content_defaults`.
- [x] `domains/files/converters.py` -- visibility maps deleted; uses `access_mode_to_proto` / `content_role_to_proto`.
- [x] `domains/files/handlers.py` -- `update_file`, `update_folder`, and `move_items` forward access policy changes through `ContentMembersOperations.set_access_mode`. **Still to do: apply the notes-style `_parse_uuid` / `_map_domain_error` / `_parse_canvas_content` helper cleanup to bring this file up to reference quality.**
- [x] `domains/files/filters/converters.py` -- saved-filter criteria uses `access_mode` instead of `visibility`.
- [x] `_load_file` and `_load_folder` loaders registered.
- [x] File versions delegate to parent file (no model changes needed).

### 1.3 Calendar -- [DONE 2026-04-12]

- [x] `src/uniffy/core/models/calendar/event.py` -- has `access_mode` + `baseline_role` (Phase 0).
- [x] `src/uniffy/core/models/calendar/calendar.py` -- has `access_mode` + `baseline_role` (Phase 0).
- [x] `src/uniffy/core/models/calendar/template.py` -- has `access_mode` + `baseline_role` (Phase 0).
- [x] `src/uniffy/domains/calendar/operations.py` -- `CalendarEventOperations` and `EventTemplateOperations` rewritten; `_resolve_access_policy` helper; attendee bypass in `list_events` / `get_events_in_range`; `_load_calendar_event` loader registered.
- [x] `src/uniffy/domains/calendar/handlers.py` -- rewritten with `_parse_uuid` / `_map_domain_error` / `open_session`. Access-mode / baseline-role parsed from request into create paths.
- [x] `src/uniffy/domains/calendar/converters.py` -- dropped visibility map; uses `access_mode_to_proto` / `content_role_to_proto`.
- [x] Reminders delegate to parent event (unchanged).

### 1.4 Projects -- [DONE 2026-04-12]

- [x] `src/uniffy/core/models/projects/project.py` -- has `access_mode` + `baseline_role`; `member_ids` dropped (Phase 0).
- [x] `src/uniffy/core/models/projects/task.py` -- no access columns (delegates to parent).
- [x] `src/uniffy/core/models/projects/sprint.py` / `field_definition.py` / `view_config.py` / `activity.py` -- no access columns (delegate via the project).
- [x] `src/uniffy/domains/projects/operations.py`:
  - [x] `ProjectOperations.create` -- resolves defaults via `_resolve_access_policy` and `resolve_content_defaults`.
  - [x] `ProjectOperations.update` -- dropped `_propagate_visibility_to_tasks`; access-mode changes go through `MembersService.set_access_mode`.
  - [x] `ProjectOperations.delete` -- uses `build_content_urn` for search-index removal.
  - [x] `TaskOperations._resolve_role` -- delegates to parent project.
  - [x] `TaskOperations._index_for_search` -- overridden to index tasks with the project's `access_mode` / `baseline_role` / member rows.
  - [x] `SprintOperations._verify_project_manage` replaces `_verify_project_admin` (uses `_require_manage`).
  - [x] No ContentPermission / ContentGroupLink references remain.
- [x] `src/uniffy/domains/projects/handlers.py` -- rewritten with `_parse_uuid` / `_map_domain_error` / `open_session`. Field / view / sprint handlers use `_require_manage` on the parent project.
- [x] `src/uniffy/domains/projects/converters.py` -- `project_to_proto` / `task_to_proto` emit `access_mode` / `baseline_role` / `user_role`. `PROJECT` and `TASK` loaders registered at module level.

### 1.5 Agents - DONe

- [ ] `src/uniffy/core/models/agents/agent.py` -- remove visibility
- [ ] `src/uniffy/core/models/agents/provider_key.py` -- same
- [ ] `src/uniffy/core/models/agents/prompt.py` -- same
- [ ] `src/uniffy/core/models/agents/cron_task.py` -- same
- [ ] `src/uniffy/domains/agents/agents/operations.py` -- update
- [ ] `src/uniffy/domains/agents/providers/operations.py` -- update
- [ ] `src/uniffy/domains/agents/prompts/operations.py` -- update
- [ ] `src/uniffy/domains/agents/cron/operations.py` -- update
- [ ] Same for handlers and converters in each sub-domain
- [ ] `src/uniffy/domains/agents/tools/builtin/*.py` -- audit for `visibility` references (agent tools that pass visibility through)

### 1.6 Rooms - DONe

- [ ] `src/uniffy/core/models/rooms/room.py` -- remove visibility
- [ ] `src/uniffy/domains/rooms/operations.py` -- update
- [ ] `src/uniffy/domains/rooms/handlers.py` -- update
- [ ] `src/uniffy/domains/rooms/converters.py` -- update

### 1.7 Comments - DONe

- [ ] `src/uniffy/domains/comments/operations.py` -- audit for visibility/ContentPermission references; comments delegate to parent content access

### 1.8 Attachments - DONe

- [ ] `src/uniffy/domains/attachments/operations.py` -- audit; delegates to parent content

### 1.9 Chat - DONe

- [ ] `src/uniffy/core/models/chat/channel.py` -- remove the `visibility` field entirely (unused; `channel_type` covers it)
- [ ] `src/uniffy/domains/chat/channels/operations.py` -- audit for visibility references, remove them. ChatAccessChecker logic stays intact.
- [ ] `src/uniffy/domains/chat/messages/operations.py` -- audit

### 1.10 Organizations - DONe

- [ ] `src/uniffy/domains/organizations/operations.py` -- update any permission_defaults creation paths to use new fields
- [ ] `src/uniffy/domains/organizations/handlers.py` -- update
- [ ] `src/uniffy/domains/organizations/converters.py` -- update

### 1.10a Owner deletion / archive preserves content (locked decision)

When a user account is deleted or archived, **content owned by that user must NOT be cascade-deleted**. The content row stays in place with its existing `owner_id`, even though the row in `login_users` is gone. Reasoning:

- Enterprise expectation: an employee leaves, their notes and projects remain accessible to the team.
- Audit continuity: `ContentMemberEvent` rows referencing the deleted owner stay valid for forensic purposes.
- Aligns with the existing audit-log policy that `actor_user_id` rows are never deleted on user removal.

Implementation rules:

- [ ] No FK `ON DELETE CASCADE` from `login_users.id` to `owner_id` on any content table. (Confirm this in every content table migration -- they should all be `NO ACTION` / unconstrained for the polymorphic-ish owner relationship.)
- [ ] User deletion / archive code path in `domains/users` (or wherever the deletion happens) must NOT touch content tables.
- [ ] User deletion / archive code path **must** clean up `ContentMember` rows where `subject_type=USER` and `subject_id=<deleted user>` (existing rule from design doc edge case 13).
- [ ] `ContentMemberEvent` rows are never touched on user deletion (audit continuity).
- [ ] The frontend displays orphaned-owner content with a graceful "Former member" placeholder for the owner avatar/name (no broken UI when `owner_id` no longer resolves to a live user). Add a fallback in `useSubjectResolver` / wherever the owner is rendered.
- [ ] Re-assignment of orphaned content to a new owner is **out of scope** for this rewrite. Org admins can use Transfer Ownership (which requires the actor to be an org admin or the current owner -- org admin path covers this case) if they want to formally re-home the content. A bulk "claim former member's content" tool is a follow-up.
- [ ] Verify: deleting a user does not break listing, opening, or searching content they previously owned. Add an integration test in `tests/core/test_owner_deletion.py`.

### 1.11 Permissions domain -- [DONE 2026-04-11, see section 1.0]

This section is a duplicate of 1.0 -- kept for historical reference. All work shipped under section 1.0.

### 1.12 Search

- [ ] `src/uniffy/domains/search/operations.py` -- update search backend to use access_mode + baseline_role + ContentMember rows
- [ ] `src/uniffy/domains/search/converters.py` -- same
- [ ] `src/uniffy/domains/search/handlers.py` -- same
- [ ] `src/uniffy/domains/search/queries.py` -- same
- [ ] `src/uniffy/core/search/indexer.py` -- update `index()` and `update_sharing()` to take access_mode + baseline_role instead of visibility
- [ ] Update Meilisearch filter expressions (anywhere the indexer builds filters from visibility)

### 1.13 Factory / Auth

- [x] `src/uniffy/factory.py` -- mounts `MembersServiceASGIApplication` at `/permissions.v1.MembersService`. (Done 2026-04-11.)
- [ ] `src/uniffy/domains/auth/operations.py` -- audit for any references (likely none)

### 1.14 Background workers

- [ ] `src/uniffy/workers/tasks/content_extraction.py` -- audit for visibility references in re-index paths
- [ ] `src/uniffy/workers/**` -- general audit

### 1.15 Stress / seed scripts

- [ ] `src/uniffy/db/seed.py` -- update seed data to use new access_mode/baseline_role fields
- [ ] `src/uniffy/db/seed_dev.py` -- same
- [ ] `src/uniffy/scripts/stress/stressseed.py` -- same

### 1.16 Verification for phase 1

- [ ] `./run.sh lint-backend` completely clean
- [ ] `./run.sh test` all backend tests pass
- [ ] `grep -rn "VisibilityScope\|PermissionLevel\|ContentPermission\|ContentGroupLink" src/uniffy` returns zero matches (except the migration file that references them to drop them)
- [ ] Manual: start the backend (`./run.sh backend`), hit a couple of endpoints, verify no errors in the log

---

## Phase 2 -- Proto

Goal: update all proto files and regenerate. Backend still builds.

### 2.1 Common

- [ ] `src/proto/common/v1/common.proto`:
  - [ ] Add `enum ContentRole`
  - [ ] Add `enum AccessMode`
  - [ ] Add `enum ContentMemberAction`
  - [ ] **Delete** `enum VisibilityScope`
  - [ ] **Delete** `enum PermissionLevel`
  - [ ] Update `ContentType` if new types are needed (not in this pass)

### 2.2 Permissions service

- [ ] **Delete** `src/proto/permissions/v1/permissions.proto` (old PermissionsService)
- [ ] **Create** `src/proto/permissions/v1/members.proto` with `MembersService` per design doc

### 2.3 Per-domain protos

For each of the proto files below, remove all `VisibilityScope` / `PermissionLevel` references and add `AccessMode` + `baseline_role` to the relevant messages:

- [ ] `src/proto/notes/v1/notes.proto`
- [ ] `src/proto/files/v1/files.proto`
- [ ] `src/proto/calendar/v1/calendar.proto`
- [ ] `src/proto/projects/v1/projects.proto` (also remove `member_ids` from Project and CreateProjectRequest)
- [ ] `src/proto/agents/v1/agents.proto`, `providers.proto`, `prompts.proto`, `cron.proto` (or equivalent; audit the agents/ directory)
- [ ] `src/proto/rooms/v1/rooms.proto`
- [ ] `src/proto/organizations/v1/organizations.proto` (OrganizationPermissionDefaults message)
- [ ] `src/proto/search/v1/search.proto` (SearchResult visibility → access_mode/baseline_role)

### 2.4 Regenerate

- [ ] `./run.sh proto` (regenerates Python, TypeScript, Go)
- [ ] `./run.sh lint-backend` clean (the backend should still compile since phase 1 already rewired the domain code; any remaining breakage means a phase-1 file was missed)
- [ ] `./run.sh test` clean

---

## Phase 3 -- Frontend

Goal: the frontend builds, lints, and every content type's settings page has a working Access/Members panel.

### 3.1 Delete sharing feature

- [ ] Delete `src/ui/src/features/sharing/` entirely
- [ ] Remove sharing imports / references from wherever they are used. Common call sites:
  - [ ] `src/ui/src/components/...` (any shared components that open SharingDialog)
  - [ ] Per-domain settings pages
  - [ ] Redux store (`src/ui/src/app/store.ts`)

### 3.2 Shared primitives

- [ ] Create `src/ui/src/shared/utils/contentRoles.ts`:
  - [ ] `ROLE_ORDINAL` constant
  - [ ] `roleCanView`, `roleCanComment`, `roleCanEdit`, `roleCanDelete`, `roleCanManage`, `roleCanTransfer`
  - [ ] `roleBadgeLabel(role)`, `roleBadgeClassName(role)` (shared badge styling)

### 3.3 Permissions feature

- [ ] Create `src/ui/src/features/permissions/` with:
  - [ ] `api/membersApi.ts` -- ConnectRPC client for `permissions.v1.MembersService`
  - [ ] `store/membersSlice.ts` + `membersThunks.ts`
  - [ ] `hooks/useContentMembers.ts` (list + mutations)
  - [ ] `hooks/useContentAuditLog.ts`
  - [ ] `components/AccessPolicyPanel.tsx` -- the main composition
  - [ ] `components/AccessModeSelector.tsx`
  - [ ] `components/MemberRow.tsx`
  - [ ] `components/AddMemberPopover.tsx`
  - [ ] `components/ContentRoleBadge.tsx`
  - [ ] `components/BlockedMembersSection.tsx`
  - [ ] `components/AuditLogPanel.tsx`
  - [ ] `index.ts` (barrel exports)
- [ ] Register the members reducer in `src/ui/src/app/store.ts`

### 3.4 Delete legacy frontend types

- [ ] Remove `VisibilityScope` / `PermissionLevel` references from every frontend file. Regenerated proto types drive this; audit by searching:
  - [ ] `grep -rn "VisibilityScope\|PermissionLevel" src/ui/src`

### 3.5 Per-domain surfaces

For each domain, wire the `AccessPolicyPanel` into the right place:

- [ ] **Notes**: content header or settings -- `features/notes/components/.../AccessSection.tsx`
- [ ] **Files**: file detail drawer / folder settings
- [ ] **Calendar**: event detail modal -- "Access" section
- [ ] **Projects**: project settings -- new `MembersSection.tsx` that embeds `AccessPolicyPanel`. Remove the visibility selector from `GeneralSection.tsx`.
- [ ] **Agents**: agent settings page
- [ ] **Rooms**: room settings (admin page)
- [ ] **Organizations**: admin permissions page (`/admin/permissions`) updated to edit `default_access_mode` and `default_baseline_role`

### 3.5a Sidebar bucketing rules (Personal / Shared with me / Organization)

Notes, Files, and Projects sidebars currently split the accessible-content list into three sections client-side using the old `visibility` field. The new model produces the same three sections with this rule:

| Bucket | Rule |
|---|---|
| Personal | `owner_id === me` AND `access_mode !== OPEN_TO_ORG` |
| Shared with me | `owner_id !== me` AND `access_mode !== OPEN_TO_ORG` (I am here only because someone added me explicitly, directly or via a group) |
| Organization | `access_mode === OPEN_TO_ORG` (regardless of whether I am the owner) |

**Decision (locked):** an item I own that is `OPEN_TO_ORG` lives in the **Organization** section, not Personal. Rationale: this matches the current Uniffy behavior (owned-`ORGANIZATION` notes already appear in the Organization section), it accurately conveys that the content is org-shared, and it avoids splitting "stuff I created" across two visually identical buckets in a way that misleads about access. Owners still see a clear visual indicator that they own the item.

`BLOCKED` content drops out of every bucket automatically because `build_accessible_filter` excludes it before the response is built.

Files to update for this:

- [ ] `src/ui/src/features/notes/utils/notesTreeUtils.ts` -- replace `organizeNotesByVisibility()` switch on `visibility` with the rule above
- [ ] `src/ui/src/features/files/components/sidebar/FilesSidebar.tsx` -- replace the `viewScope` selector logic
- [ ] `src/ui/src/features/projects/components/sidebar/ProjectsSidebar.tsx` -- replace the `useMemo` filter at lines 41-47

Out of scope for this rewrite (follow-up): an `OPEN_TO_ORG` item where the user has an elevated explicit role (e.g. baseline Viewer + explicit Editor) cannot currently be distinguished from a baseline-only entry without an extra `current_user_role` field on list responses. The current code does not distinguish them either, so we keep parity.

### 3.6 Audit log UI

- [ ] For each content type, wire a read-only "Access history" tab or section that uses `useContentAuditLog`. Initially shipped on projects (biggest win) and notes; other domains get it as a follow-up if needed.
- [ ] `AuditLogPanel` renders each event with actor avatar + action description + time. Formatters for each `ContentMemberAction`.

### 3.7 Verification for phase 3

- [ ] `./run.sh lint-frontend` clean
- [ ] `./run.sh test-frontend` clean
- [ ] Manual: open each content type's settings page, verify the panel renders correctly
- [ ] `grep -rn "VisibilityScope\|PermissionLevel\|features/sharing" src/ui/src` returns zero matches

---

## Phase 4 -- End-to-end verification

- [ ] Fresh DB -- run all migrations from scratch, verify no failures
- [ ] Seed data loads correctly
- [ ] Start backend + frontend + worker
- [ ] Manual walkthrough:
  - [ ] Create a new organization (as system admin), verify default org permission defaults exist
  - [ ] Create a new project -- should default to `OPEN_TO_ORG / EDITOR`
  - [ ] Switch it to `EXPLICIT_MEMBERS`, verify only the owner remains
  - [ ] Add a second user as Commenter
  - [ ] Add a group as Editor
  - [ ] BLOCK a third user, verify they cannot see the project in their list
  - [ ] Verify BLOCKED user also cannot fetch the project by id
  - [ ] Transfer ownership to a fourth user, verify the previous owner becomes ADMIN
  - [ ] Check the audit log -- all six actions should be recorded with correct actors and timestamps
  - [ ] Repeat on a note, a calendar event, a file, an agent, a room -- same flow works
  - [ ] Verify org admin bypass: org admin can see BLOCKED content
  - [ ] Verify domain admin bypass: projects domain admin can see BLOCKED projects
  - [ ] Verify search returns content respecting access (including BLOCKED exclusion)
  - [ ] Verify `@` mentions work across all content types
- [ ] File a note of any discovered issues, fix them before marking phase 4 done

---

## Follow-up work (out of scope for this rewrite)

These should NOT be done as part of the rewrite. Capture them as separate items.

- [ ] Recursive hierarchical inheritance (folder → files, note trees)
- [ ] Scheduled cleanup of expired grants (cron task)
- [ ] GDPR anonymization of audit log actor fields
- [ ] Public external sharing
- [ ] Permission templates / schemes
- [ ] Cross-content-type "everything I can access" queries
- [ ] Custom roles
- [ ] Team workspaces as a first-class concept

---

## Notes from previous sessions

(Each resumer should append a dated entry here summarizing what they changed and any surprises encountered. Keep entries brief -- git log has the detail.)

### 2026-04-11 -- initial design and backlog

- Design document and this backlog created in a single session.
- No code written yet.
- Next step: start Phase 0.1 (delete legacy primitives).

### 2026-04-11 -- Phase 1.0 / 1.1 / 1.2 implemented; notes set as reference

- Permissions domain (1.0):
  - Deleted the old `PermissionsOperations` (ContentPermission CRUD).
  - Wrote `domains/permissions/handlers.py` implementing the `MembersService` protocol: `list_members`, `add_member`, `update_member_role`, `remove_member`, `set_access_mode`, `transfer_ownership`, `list_member_events`. All seven delegate to `ContentMembersOperations` from `core/content/members.py`.
  - Wrote `domains/permissions/converters.py` with `content_member_to_proto`, `content_access_policy_to_proto`, `content_member_event_to_proto`.
  - `domains/permissions/service.py` is now a trivial `MembersServiceImpl(MembersHandlers)` wrapper.
  - `factory.py` imports `MembersServiceASGIApplication` (not `PermissionsServiceASGIApplication` -- the generated class is under the new name in `permissions_connect.py`) and mounts it at `/permissions.v1.MembersService`.

- Notes domain (1.1) -- full rewrite, now the reference implementation:
  - `operations.py`: new structural docstring explaining the reference layout. Helpers extracted: `_resolve_access_policy`, `_unique_slug`, `_extract_content_fields` (returns a `_NoteContentFields` dataclass), `_notify_new_mentions` (diffs old/new refs, self-mention filter), `_emit_shared_notification`, `_propagate_title_to_mentions`, `_collect_descendant_ids`, `_apply_access_filter`, `_group_member_subquery`. `get_notes_sharing_info` split into `_load_owners`, `_owner_info_dict`, `_load_members_by_note`, `_load_subject_lookups`, `_build_shared_with`. `create()` now adds initial `group_ids` through `ContentMembersOperations.add_member` so audit events are written (previously it inlined raw `ContentMember` rows). `move()` is a thin wrapper around `set_access_mode` + optional `add_member`. Loader registered at module level.
  - `converters.py`: removed the dead `access_mode_from_proto_value` / `content_role_from_proto_value` re-exports. Extracted `_serialize_body`, `_build_metadata_dict`, `_build_icon_proto`, `_share_target_to_proto`, `_role_value_to_proto`.
  - `handlers.py`: added module-level helpers `_parse_uuid`, `_parse_canvas_content`, `_map_domain_error`. Every handler method now follows the same shape. The old `except ValueError, TypeError:` (which was valid but ambiguous) replaced with `except (ValueError, TypeError):`. Legacy RPCs (`share_note_with_group`, `unshare_note_from_group`, `get_note_sharing`, `grant_permission`, `revoke_permission`, `copy_note`) stay as `UNIMPLEMENTED` stubs with messages pointing at `MembersService`; they should be removed from `notes.proto` in a follow-up.

- Files / folders domain (1.2):
  - `operations.py`: `FileOperations` and `FolderOperations` updated. `initiate_upload` + `complete_upload` use the new `access_mode` / `baseline_role` columns on `MultipartUpload` and stamp them onto the new `File` row. `update()` no longer takes a `visibility` parameter (access-mode changes go through `MembersService`). `list_files` rewritten with the same access-filter pattern as notes. `FolderOperations` now has a proper `_resolve_access_policy`-equivalent path for `create()` via `resolve_content_defaults`.
  - `converters.py`: removed visibility maps; uses `access_mode_to_proto` / `content_role_to_proto` directly.
  - `handlers.py`: `update_file` and `update_folder` now forward `access_mode` / `baseline_role` in the request to `ContentMembersOperations.set_access_mode` before applying the metadata update. `move_items` delegates per-item to `set_access_mode` when the target mode differs. `_parse_uuid` / `_map_domain_error` not added yet -- **follow-up: apply the notes-style helpers to `files/handlers.py` in the next session.**
  - `filters/converters.py`: saved-filter criteria now stores `access_mode` instead of `visibility`.
  - Both `FILE` and `FOLDER` content loaders registered at module level.

- New helper: `core/auth/permissions/defaults.py::resolve_content_defaults(session, organization_id, content_type) -> (AccessMode, ContentRole | None)`. Exported from `core.auth.permissions`. Looks up `permissions_org_defaults`, falls back to the `ORG_PERMISSION_DEFAULTS` static dict, and finally to `(OWNER_ONLY, None)`. Every domain's `create()` path should use this.

- `factory.py` already boots with the permissions and notes domains wired, but calendar / projects / agents / rooms / search / organizations still fail at import because they use the old types. The rest of Phase 1 continues from section 1.3 onwards.

- Verification: `rtk uv run ruff check src/uniffy/domains/notes src/uniffy/domains/permissions src/uniffy/domains/files src/uniffy/factory.py` is clean. End-to-end lint (`./run.sh lint-backend`) still fails because of the remaining broken domains; that is expected and will clear once Phase 1 finishes.

- Late-session cleanup: the big "reference layout" module docstrings in `notes/operations.py`, `notes/handlers.py`, and `notes/converters.py` were stripped along with every `# ----- Section -----` divider, per user direction. The layout conventions live in this backlog (rule #10 under "REFERENCE IMPLEMENTATION"), not in every source file. `BaseContentOperations.create` / `update` / `delete` were also deleted -- they caused `ty invalid-method-override` warnings on every subclass because no domain can share a CRUD signature with the generic base. Base class now only provides `get_by_id`, `list_accessible`, the `_require_*` helpers, `_index_for_search`, the search abstract hooks, and column accessors. Added rule #11 to "REFERENCE IMPLEMENTATION" capturing this.

### 2026-04-11 -- sidebar bucketing + owner deletion decisions

- Confirmed that the existing Personal / Shared with me / Organization sidebars in notes, files, and projects keep working under the new model with a small ten-line-per-domain rewrite. Bucketing rules locked in section 3.5a.
- Locked decision: an item the current user owns that is `OPEN_TO_ORG` belongs in the **Organization** section, not Personal. Matches today's behavior; avoids splitting "stuff I created" across two sections.
- Locked decision: deleting or archiving a user does **not** cascade-delete their owned content. Owner row stays, audit log stays, ContentMember rows for the deleted user are cleaned up by the ops layer. Implementation rules captured in section 1.10a. Re-homing orphaned content to a new owner is a follow-up; org admins can use Transfer Ownership today.
- User-facing `docs/documentation/SHARING.md` rewritten to describe the new model end-to-end (access modes, six roles incl. Blocked, members panel, transfer ownership, temporary access, audit log, domain admins, org defaults table).
- No code changes in this session.

### 2026-04-11 -- Phase 0 complete

- Phase 0 fully implemented in a single session. Core permission engine, models, migrations, protos, gen code, and search integration are all on the new model. Lint is clean across the entire backend. Core imports and round-trips work.
- Several surprises along the way:
  - `core/types.py` and `core/models/shared.py` were duplicating enum definitions (ContentType, SubjectType, etc.). Consolidated both into `core/types.py` and made `core/models/shared.py` a thin re-export. Files inside `core.auth`, `core.content`, `core.events`, `core.search` must import from `core.types` to avoid loading the full models package mid-init (which triggers a circular through `BaseContentOperations`).
  - Lazy imports are required in several places: `PermissionChecker._get_member_role` / `_get_user_org_role` / `_is_org_admin` lazy-import `GroupMember`, `ContentMember`, `OrganizationMember`, `OrganizationRole` from the models package. `core/auth/domain_admin.py` lazy-imports `DomainAdmin`. `core/content/cascade.py` lazy-imports `ContentMember` inside the cascade helpers. `core/content/__init__.py` is now intentionally empty to avoid triggering `base_operations` import on any reference to the package.
  - Migrations 001-041 were rewritten in place (the user explicitly said "delete the first migrations and put our migrations there we will recreate the db, no need to bloat the migrations we don't need to even know what the old model was"). No 043 migration exists.
  - The notes proto had LOCAL `VisibilityScope` and `PermissionLevel` enums (not common.v1). Those were deleted and replaced with `common.v1` imports.
  - The `Project.member_ids` JSONB field was deleted from both the model and the proto.
  - Chat channels keep their own `ChatChannelMember` system but lost their unused `visibility` column entirely. The chat tables migration (037) no longer creates the column.
- Next step: Phase 1 - rewrite every domain that imports `VisibilityScope` or uses the deleted `visibility_*` / `permission_level_*` converters. Start with `domains/permissions` (biggest change: delete old `PermissionsOperations`, write `MembersService` handlers using `ContentMembersOperations`). Then notes, files, calendar, projects, agents, rooms, organizations, search, workers, seed, and finally `factory.py` to mount the new `MembersService` and remove the old `PermissionsService` mount.
