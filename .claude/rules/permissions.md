---
paths:
  - "**/*"
---

# Permission System

Authoritative reference for content access control. Other rule files defer here - do not re-explain the model elsewhere.

## Core principle

**Personal content is private until shared. There is no org/domain admin god-mode for content.** Org OWNER, org ADMIN, and per-domain admins are ordinary members for every access decision: they reach only what they own, what is explicitly shared with them, or what is `OPEN_TO_ORG`.

**Active org membership is a precondition for every content access decision, ownership included.** A removed or deactivated member resolves to no access on everything in that org - their own content too - and reactivation restores it. There is no grace period and no read-only carve-out. `effective_role` enforces this at the top of its resolution order, and list paths short-circuit to a no-rows filter for non-members, so `ContentMember` rows and `owner_id` references left behind by removal need no cleanup: they confer nothing without an active membership.

Two deliberate exceptions, and only two:

- **SupportSession** - a platform/system admin who is NOT a tenant member reaches content only through an audited, time-bound `SupportSession`. This is the single non-member path; it is logged and the org owner can revoke it.
- **Chat moderation** - org admins and chat domain admins still view/moderate all channels via `ChatAccessChecker`. Chat is collaborative space, not personal content.

Org-level powers (managing members, settings, permission defaults, quotas, billing, usage stats) are NOT content access - they keep their own org-role gates and never flow through the content path below. The same applies to org-wide infrastructure resources with no personal tier (agents, skills, automations, provider keys): builders manage them via domain-level gates (see "Domain admin"), while READ access still flows through the content path. LLM provider keys go one step further - they carry no `access_mode` at all, so every enabled org key is usable by every org member.

## Deactivation

`User.is_active`, `OrganizationMember.is_active`, and `GroupMember.is_active` are access conditions, not bookkeeping. A deactivated membership fails **every** gate: `require_org_admin` / `require_org_owner` / `require_org_member`, the org-admin checks in `PermissionChecker`, `ChatAccessChecker`, and `is_agents_builder`, the membership gate in `effective_role` (which covers ownership and explicit grants, not just `OPEN_TO_ORG`), the no-rows short-circuit in `ContentAccessQuery.build_accessible_filter`, and group-derived `ContentMember` grants. `DomainAdmin` follows membership - `is_domain_admin` joins `organization_members`, so a grant held by a deactivated member confers nothing.

`OrganizationOperations.add_member` reactivates an existing inactive row (applying the incoming role and dropping the perm caches) - re-adding a deactivated member is the restore path.

`OrganizationOperations.get_membership` deliberately still returns deactivated rows because management flows (re-add, remove, role edits) need to see them; the `is_active` condition lives in the `require_org_*` gates, which is where the security decision happens.

Any flow that flips an activation flag MUST drop the perm caches in the same operation - `_drop_user_perm_cache` / `invalidate_user` plus `invalidate_membership_cache` per org. Without that, the 600s `perm:org_admin:*` and `perm:domain_admin:*` entries keep a deactivated user fully powered for ten minutes.

## The model (every content row)

| Column | Values | Meaning |
|---|---|---|
| `access_mode` | `OWNER_ONLY` | Only the owner. No admin bypass. |
| | `EXPLICIT_MEMBERS` | Only users/groups with a `ContentMember` row. |
| | `OPEN_TO_ORG` | Every org member inherits `baseline_role`; explicit members elevate above or block below. |
| `baseline_role` | `VIEWER`/`COMMENTER`/`EDITOR`/`ADMIN`, or `NULL` | Only meaningful with `OPEN_TO_ORG`. Never `OWNER`/`BLOCKED`. `NULL` = inherit org default. |

A `NULL` `access_mode` means "inherit org defaults" (resolved live at read time). `ContentRole` ordering:

```
VIEWER < COMMENTER < EDITOR < ADMIN < OWNER     # plus BLOCKED (explicit deny, beats everything)
```

Explicit grants are `ContentMember` rows (`permissions_content_members`) keyed on `(organization_id, content_type, content_id, subject_type, subject_id)` where `subject_type` is `USER` or `GROUP`, with a `role` and optional `expires_at` (expired rows are ignored).

## effective_role - the choke point

`PermissionChecker.effective_role(user_id, organization_id, content_type, content_id, *, owner_id, access_mode, baseline_role) -> ContentRole | None` resolves access. `None` = no access. Order:

1. **System admin not in the org** -> active `SupportSession` role (`EDITOR` if `READ_WRITE`, else `VIEWER`) or `None`. A system admin who IS an org member falls through to the member path - access flows from membership, not from `is_system_admin`.
2. **Not an active member of the org** -> `None`. Runs before the owner check, so removal/deactivation cuts off everything at once - ownership, explicit grants, baselines.
3. `owner_id == user_id` -> `OWNER`.
4. Any matching `BLOCKED` `ContentMember` (direct or via group) -> `None` immediately (overrides ownership-of-content too).
5. Highest non-blocked role across the user's direct + group `ContentMember` rows.
6. `OPEN_TO_ORG` -> `baseline_role` (membership was already established in step 2).
7. Otherwise `None`.

**There is no org-admin or domain-admin branch.** Adding one re-introduces the god-mode that was deliberately removed.

Org defaults are materialised live via `resolve_effective_policy` (`defaults.py`): row override -> `permissions_org_defaults` -> `ORG_PERMISSION_DEFAULTS` -> `(OWNER_ONLY, None)`.

## Capability gates (`core/auth/permissions/roles.py`)

Gate operations with these predicates, never with raw role comparisons:

| Predicate | Floor |
|---|---|
| `role_can_view` | VIEWER |
| `role_can_comment` | COMMENTER |
| `role_can_edit` | EDITOR |
| `role_can_delete` | ADMIN |
| `role_can_manage` (members, access mode, baseline) | ADMIN |
| `role_can_transfer` (ownership) | OWNER |

`BLOCKED` and `None` fail every check.

## Where access is enforced

- **`BaseContentOperations`** (`core/content/base_operations.py`): extend it for a content type. You get `get_by_id` (gated by `_require_view`), `list_accessible`, and `_require_view/edit/delete/manage/transfer`, all routing through `_resolve_role` -> `effective_role`. `list_accessible` applies the access filter for **everyone**, admins included.
- **Domain list methods** (`list_notes`, `list_files`, `list_projects`, ...): call `ContentAccessQuery.build_accessible_filter(...)` for **everyone**. A `personal_only` flag narrows to owner-only; there is no admin-sees-all branch in these list/sidebar paths. An admin browse surface that genuinely needs the full set opts in explicitly and says so.
- **`ContentAccessQuery.build_accessible_filter`** (`queries.py`): the SQL `WHERE` mirroring `effective_role` for sets - ownership OR explicit member (direct/group) OR `OPEN_TO_ORG` baseline, minus any `BLOCKED`. It is async: it resolves the actor's active membership once (memoized per query object) and returns a no-rows filter for non-members instead of adding a per-row `EXISTS`. Caller scopes the query to `organization_id`.
- **Child content** (tasks, comments, attachments): no own `access_mode`; override `_resolve_role` to load the PARENT and resolve against its policy.
- **`helpers.py`** (`require_view/edit/delete/manage/transfer`): standalone gates for callers outside `BaseContentOperations` (e.g. cascade). Load the row's `(owner_id, access_mode, baseline_role)` first, then call.

## Mutating access - `ContentMembersOperations` only

All member and access-mode changes go through `ContentMembersOperations` (`core/content/members.py`), surfaced as `permissions.v1.MembersService`:

| RPC | Effect |
|---|---|
| `ListMembers` / `ListMemberEvents` | read members / audit log |
| `AddMember` / `UpdateMemberRole` / `RemoveMember` | member CRUD (requires MANAGE) |
| `SetAccessMode` | change `access_mode` / `baseline_role` |
| `TransferOwnership` | move `owner_id`; previous owner becomes `ADMIN` (requires OWNER) |

Every mutation writes a `ContentMemberEvent` audit row in the same transaction (`record_*` helpers in `audit.py`) and publishes a realtime perm fanout (`realtime:perm:{ct}:{id}` - see `notes-realtime.md`). Mutating `access_mode` or `ContentMember` rows directly from a domain bypasses the audit log and the cache invalidation - do not.

## Caching (`core/auth/cache.py`)

Hot permission reads are Valkey-cached: `perm:role:{org}:{user}:{ct}:{id}` (300s, even `None`/no-access is cached), `perm:org_admin:*`, `perm:domain_admin:*` (600s). Entries carry tags `user:{id}`, `content:{ct}:{id}`, `defaults:{org}:{ct}`. Mutations invalidate by tag: `invalidate_content` on access-mode/BLOCKED/group grants, `invalidate_user` on membership/group changes, `invalidate_org_defaults` on default changes. Tag-visibility sets cache separately in `visible_sets.py`.

## Search and tags

- **Meilisearch** (`core/search/meilisearch.py::_build_permission_filter`): filters on `owner_id` / `shared_user_ids` / `shared_group_ids` / `OPEN_TO_ORG` minus `blocked_*`. It has **no admin bypass and must keep none.** Sharing fields are denormalised into the index by `BaseContentOperations._index_for_search` and refreshed by `update_document_sharing` on every member mutation.
- **`visible_sets.py`** (tag visibility + content-type id sets, drives the tag search post-filter and tag-filter UI): admins are filtered like members, with one exception - a `chat_moderator` (org admin or chat domain admin) sees all `CHAT` assignments, mirroring chat moderation.

## Domain admin (`DomainAdmin`)

`DomainAdmin` grants elevated **domain-level operations** (per `(organization_id, user_id, domain)`), checked via `is_domain_admin` (`core/auth/domain_admin.py`). It does **not** grant access to other members' content - `effective_role` ignores it. Live consumers:

- **Chat moderation** - org admins + chat domain admins via `ChatAccessChecker`.
- **Agents builders** - org admins + AGENTS domain admins (`is_agents_builder`, `domains/agents/access.py`) manage the org-wide agent surface: agent/skill/automation CRUD, the skill-draft inbox, and org-scope agent memories all gate on `require_agents_builder` instead of content roles. Agents/automations remain ordinary content rows for READS (`effective_role`, `build_accessible_filter`, Meili - all unchanged); only management is domain-level. Cron tasks additionally move their execution identity to whoever rewrites the prompt (see `agents.md`) - a domain-level manage power must never become a way to run code as another user.

Granting or revoking a `DomainAdmin` row MUST drop the perm cache (`invalidate_domain_admin`); the gate reads a 600s Valkey entry, so skipping it leaves a revoked admin fully powered for ten minutes. The grant is also conditional on an active `OrganizationMember` row (see "Deactivation").

### Manage override (`register_manage_override`)

`ContentMembersOperations._require_manage` consults a per-content-type override when the actor's content role fails: `register_manage_override(content_type, check)` in `core/content/members.py`. A passing check yields `ContentRole.ADMIN` for that mutation only - member CRUD, `SetAccessMode` - never for transfer, and never inside `effective_role`, so reads/lists/search stay unaffected. Registered: `AGENT` -> `is_agents_builder`. This is the sanctioned shape for domain-level management powers; adding an override for personal-content types would re-introduce god-mode - don't.

## Chat (separate access model)

Chat uses channel membership, not `access_mode`. `ChatAccessChecker` (`domains/chat/access.py`): `check_access` (view), `require_send`, `require_elevated` (moderate). PUBLIC channels are open to the org; otherwise membership is required. Org admins and chat domain admins bypass (moderation - the kept exception). Domains with custom membership semantics override `_require_*` on `BaseContentOperations` to delegate to their own checker.

## Frontend mirror (advisory only)

`src/ui/src/shared/utils/contentRoles.ts` mirrors the backend: `roleCanView/...` predicates, `accessModeLabel/accessModeDescription`, and `bucketForContent` (sorts content into `personal` / `shared` / `organization` sidebar buckets). The frontend is for labelling and affordances only - **the backend is the gate.** An admin page may render a control on content the backend will deny; that is safe, not a bypass.

## Hard rules

- Never add an org/domain admin content bypass anywhere - not in `effective_role`, list methods, the Meili filter, or `visible_sets`. This is the single most important invariant here.
- Apply `build_accessible_filter` for everyone in any list/sidebar/tree path.
- Permission checks live inside domain operations (the access policy is well-typed there).
- Change `access_mode` / members only through `ContentMembersOperations` (audit + fanout + cache invalidation ride along).
- `BLOCKED` always wins, even over ownership-of-content and even for admins.
- Adding a content type to the system: extend `BaseContentOperations`, register a loader with `ContentMembersOperations`, add it to `_CONTENT_TYPE_TO_DOMAIN` in `checker.py` if it has a domain admin, seed `ORG_PERMISSION_DEFAULTS`, and index the sharing fields.

Guard tests: `tests/core/test_effective_role.py`, `tests/core/test_access_query.py`, `tests/core/test_visible_sets.py`, `tests/core/test_member_ops.py`, `tests/core/test_deactivated_membership.py`, `tests/test_notes_access_filter.py`.
