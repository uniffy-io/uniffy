# Permission Model Redesign

> Status: approved design, ready for implementation
> Companion document: `docs/specs/permissions-redesign-backlog.md` (tracks progress so work can be resumed)
> Replaces: the current `VisibilityScope` + `PermissionLevel` + `ContentPermission` + `ContentGroupLink` system

This document is the authoritative reference for the rewritten access control system in Uniffy. The redesign replaces the existing visibility-and-grants model with a unified membership-based model. There is no user-facing production yet, so the rewrite happens in place -- the old system is deleted entirely rather than maintained in parallel.

Any change to the design must be reflected in this document before code changes.

---

## Why

The current model has eight concrete problems that block real enterprise use:

| # | Problem | Symptom |
|---|---|---|
| 1 | Access is purely additive -- no way to exclude a user from `ORGANIZATION`-visible content | "Remove Bob from this project" is impossible while the project is org-visible |
| 2 | Visibility and membership are conflated -- two mechanisms for the same concept | 40-person and 3-person projects use different access paths |
| 3 | Org defaults (`members_can_edit`, etc.) apply to every org-visible item of a type | "Project A read-only, project B editable" is not expressible |
| 4 | `project.member_ids` looks like an access list but does not affect access | Honest code readers are misled |
| 5 | No named content-level roles (Admin, Editor, Commenter, Viewer) | UI surfaces invent their own labels |
| 6 | Audit trail is grant-only (`granted_by`, `granted_at`). Removals and role changes lose attribution | "Who removed Alice?" cannot be answered |
| 7 | Two parallel systems exist: chat uses `ChatChannelMember`, everything else uses visibility + grants | Mental model fragmentation |
| 8 | Redundant capability flags (`can_view/can_edit/can_delete/can_share/can_move`) drift from permission level | They are set uniformly anyway but are never validated |

The redesign fixes all eight.

## Goals

1. **Membership-first.** Explicit members are the primary access mechanism.
2. **Subtraction works.** A specific user can be blocked from otherwise-open content.
3. **Per-content baseline.** Each item independently picks its baseline for org members.
4. **Named roles, derived capabilities.** One role enum, one role → capability mapping, no per-row flag drift.
5. **Audit trail.** Every membership change is attributable.
6. **One generic member table.** Works for every content type.
7. **Full rewrite, no compat.** Old enums and tables go away entirely.
8. **Chat stays separate.** `ChatChannelMember` has messaging-specific fields (`notification_level`, `is_muted`, `desktop_enabled`, ...) that do not belong on a generic content member. Chat remains on its own model by intention.

## Non-goals

1. Hierarchical inheritance (folder → files, etc.) -- children still carry their own access or delegate to parents, case by case.
2. Public / external sharing. `PUBLIC` visibility was never used. Not adding a replacement in this rewrite.
3. Time-bound grants beyond the existing `expires_at` field on grants (preserved as `ContentMember.expires_at`).
4. Permission templates / schemes.
5. ABAC (attribute-based access control). Pure role-based model.

---

## Core decisions (locked)

These were decided during design and are not up for revisiting inside the implementation pass. Reopen only if something discovered during implementation proves a decision unworkable.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Six roles**: OWNER / ADMIN / EDITOR / COMMENTER / VIEWER / BLOCKED | COMMENTER is cheap to add and matches product expectations (Google Docs, Notion). BLOCKED is the exclusion primitive. |
| 2 | **Access mode + baseline stored as columns on each content table**, not a separate policy table | Zero extra joins per access check. Content row already loaded → fields are free. Migration is one-time. |
| 3 | **Audit log (`ContentMemberEvent`) in the foundation phase** | History cannot be backfilled. Shipping it later loses data permanently. |
| 4 | **Foundation first, then plan the rest** | Phase 0 is the reusable core (models, checker, helpers, tests, audit log). Phase 1+ is per-domain adoption and will be planned after foundation lands. |
| 5 | **Names**: `ContentRole`, `AccessMode`, `ContentMember`, `ContentMemberEvent`, `ContentMemberAction` | Member-oriented naming, matches user mental model. |
| 6 | **BLOCKED is a visible UI state** (dedicated subsection in the Members panel) | Invisible deny is confusing; explicit is better. |
| 7 | **Org admin / system admin bypass BLOCKED** | Org-level roles always supersede content-level roles. Content-level BLOCKED is for regular members. |
| 8 | **Full rewrite, no compat shim** | No production users. We delete `VisibilityScope`, `PermissionLevel`, `ContentPermission`, `ContentGroupLink`, the per-column `visibility` fields on every content table, and the `permissions.v1.PermissionsService` / `SharingDialog` path. |

---

## The model

### New enums (lives in `core/models/shared.py`)

```python
class ContentRole(str, Enum):
    """Role a subject has on a piece of content.

    Ordered from highest to lowest privilege. BLOCKED is an explicit deny
    that overrides any baseline access (used to remove a user from
    otherwise open content).
    """
    OWNER = "OWNER"          # Full control: settings, members, delete, transfer
    ADMIN = "ADMIN"          # Manage settings, manage members, delete
    EDITOR = "EDITOR"        # Edit content
    COMMENTER = "COMMENTER"  # Read + comment
    VIEWER = "VIEWER"        # Read only
    BLOCKED = "BLOCKED"      # Explicit deny


class AccessMode(str, Enum):
    """How baseline access to a piece of content is determined.

    Explicit ContentMember rows always override the baseline.
    """
    OWNER_ONLY = "OWNER_ONLY"              # Only the owner. No member rows accepted.
    EXPLICIT_MEMBERS = "EXPLICIT_MEMBERS"  # Owner + explicit member list only.
    OPEN_TO_ORG = "OPEN_TO_ORG"            # All org members get the baseline role.


class ContentMemberAction(str, Enum):
    """What kind of mutation produced a ContentMemberEvent row."""
    MEMBER_ADDED = "MEMBER_ADDED"
    MEMBER_ROLE_CHANGED = "MEMBER_ROLE_CHANGED"
    MEMBER_REMOVED = "MEMBER_REMOVED"
    ACCESS_MODE_CHANGED = "ACCESS_MODE_CHANGED"
    BASELINE_ROLE_CHANGED = "BASELINE_ROLE_CHANGED"
    OWNERSHIP_TRANSFERRED = "OWNERSHIP_TRANSFERRED"
```

Deleted enums: `VisibilityScope`, `PermissionLevel`.

### New columns on every access-controlled content table

Each content table that is directly access-controlled gets two new columns:

```sql
access_mode           accessmode      NOT NULL   -- AccessMode enum
baseline_role         contentrole     NULL       -- ContentRole, non-null iff access_mode = OPEN_TO_ORG
```

`owner_id` is already present on every content table and stays where it is.

Deleted columns: `visibility` on every content table.

The tables that get the new columns (and lose `visibility`):

| Table | Notes |
|---|---|
| `notes_notes` | |
| `files_files` | |
| `files_folders` | |
| `calendar_events` | |
| `calendar_calendars` | Currently has no visibility column; gets default `OPEN_TO_ORG / VIEWER`. |
| `projects_projects` | Also drops `member_ids` JSONB field. |
| `rooms_rooms` | Currently defaults to ORGANIZATION; becomes `OPEN_TO_ORG / VIEWER`. |
| `agents_agents` | |
| `agents_provider_keys` | |
| `agents_prompts` | |
| `agents_cron_tasks` | |

Tables that **do not** get the new columns and instead delegate access to a parent:

| Table | Delegates to |
|---|---|
| `projects_tasks` | Parent `projects_projects` via `project_id`. Drops its `visibility` column. |
| `projects_sprints` | Parent project (sprints are private to the project). |
| `projects_field_definitions` | Parent project. |
| `projects_view_configs` | Parent project. |
| `projects_activities` | Parent task / project. |
| `comments_comments` | Parent content via `(content_type, content_id)`. |
| `attachments_*` | Parent content. |
| `calendar_event_attendees` | Parent event. |
| `calendar_reminders` | Parent event. |
| `files_file_versions` | Parent file. |
| `chat_channels`, `chat_channel_members`, `chat_messages` | **Chat keeps its own membership model** (`ChatChannelMember`). No change, no new columns, no `visibility` column (the existing one is dropped -- `channel_type` already encodes the distinction and the chat access checker already uses `channel_type`). |

### New tables

**`permissions_content_members`** -- explicit subject-role grants on content.

```python
class ContentMember(SQLModel, table=True):
    __tablename__ = "permissions_content_members"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "content_type", "content_id",
            "subject_type", "subject_id",
            name="uq_content_member",
        ),
        Index("ix_content_member_content", "content_type", "content_id"),
        Index("ix_content_member_subject", "subject_type", "subject_id"),
        Index("ix_content_member_org", "organization_id"),
    )

    id: UUID                            # uuidv7
    organization_id: UUID               # FK login_organizations
    content_type: ContentType
    content_id: UUID
    subject_type: SubjectType           # USER | GROUP
    subject_id: UUID                    # user id or group id
    role: ContentRole                   # any of six values incl. BLOCKED
    added_by_user_id: UUID              # FK login_users (audit)
    added_at: datetime
    updated_at: datetime
    expires_at: datetime | None         # optional expiration (hour granularity)
```

Constraints:

- Unique on the 5-tuple -- one row per subject per content.
- `role` may be `OWNER` (set via ownership transfer).
- `BLOCKED` is a valid role.
- No FK constraint on `content_id` because the table is polymorphic across content types. Consistency is enforced by the operations layer.
- No FK constraint on `subject_id` for the same reason (USER or GROUP).

**`permissions_content_member_events`** -- append-only audit log.

```python
class ContentMemberEvent(SQLModel, table=True):
    __tablename__ = "permissions_content_member_events"
    __table_args__ = (
        Index("ix_cme_content", "content_type", "content_id", "occurred_at"),
        Index("ix_cme_actor", "actor_user_id", "occurred_at"),
        Index("ix_cme_org", "organization_id", "occurred_at"),
    )

    id: UUID                                    # uuidv7 (sorts by time)
    organization_id: UUID                       # FK login_organizations
    content_type: ContentType
    content_id: UUID
    action: ContentMemberAction

    # Subject of the change -- set for MEMBER_ADDED, MEMBER_ROLE_CHANGED, MEMBER_REMOVED,
    # OWNERSHIP_TRANSFERRED (new owner), else NULL
    subject_type: SubjectType | None
    subject_id: UUID | None

    # Previous/new state -- semantics vary by action:
    #   MEMBER_ADDED:            previous_role=NULL,     new_role=<role>
    #   MEMBER_ROLE_CHANGED:     previous_role=<old>,    new_role=<new>
    #   MEMBER_REMOVED:          previous_role=<old>,    new_role=NULL
    #   ACCESS_MODE_CHANGED:     previous_access_mode=<old>, new_access_mode=<new>
    #   BASELINE_ROLE_CHANGED:   previous_baseline=<old>, new_baseline=<new>
    #   OWNERSHIP_TRANSFERRED:   previous_owner_id=<old>, new_owner_id=<new>
    previous_role: ContentRole | None
    new_role: ContentRole | None
    previous_access_mode: AccessMode | None
    new_access_mode: AccessMode | None
    previous_baseline_role: ContentRole | None
    new_baseline_role: ContentRole | None
    previous_owner_id: UUID | None
    new_owner_id: UUID | None

    actor_user_id: UUID                         # who did it (FK login_users)
    actor_org_role: OrganizationRole            # snapshot of actor's org role at time of action
    note: str                                   # optional free-text note, default ""
    occurred_at: datetime
```

Notes on the audit log design:

- **Append-only**. The operations layer never issues UPDATE or DELETE on this table. Once written, rows are immutable.
- **No FK constraints on polymorphic fields** (`subject_id`, `previous_owner_id`, `new_owner_id`). These can point at deleted users -- that's fine, the audit trail survives user deletion.
- **Separate columns per state field** rather than a JSONB blob. Enables efficient filtering ("show me everything Bob did" or "show me when project X changed access mode") without JSONB parsing.
- **Snapshot of actor's org role at time of event**. If Bob is currently an org owner but took action while he was a regular member, the audit log preserves that historical fact.
- **uuidv7 id** -- rows sort chronologically by primary key scan, no separate index on `occurred_at` needed.
- **`note` field** for free-text context. Populated by API calls that want to explain the change ("bulk import from legacy system"). Default empty string; max length 500.
- **Retention**: never deleted. Eventually we may want soft-archiving for GDPR (anonymize actor_user_id if the user is GDPR-deleted) -- noted as a future concern, not implemented now.

### Deleted tables

- `permissions_content_permissions` (replaced by `permissions_content_members`)
- `permissions_content_group_links` (replaced by `permissions_content_members` with `subject_type=GROUP`)

`permissions_org_defaults` is **kept** but its columns change:

```python
class OrganizationPermissionDefaults(SQLModel, table=True):
    __tablename__ = "permissions_org_defaults"
    __table_args__ = (
        UniqueConstraint("organization_id", "content_type",
                          name="uq_org_content_type"),
    )

    id: UUID
    organization_id: UUID
    content_type: ContentType
    default_access_mode: AccessMode
    default_baseline_role: ContentRole | None       # non-null iff default_access_mode = OPEN_TO_ORG
    updated_by_user_id: UUID
    updated_at: datetime
```

Dropped columns: `default_visibility`, `members_can_view`, `members_can_edit`, `members_can_delete`, `members_can_share`.

Default values per content type after migration:

| Content type | `default_access_mode` | `default_baseline_role` |
|---|---|---|
| `NOTE` | `OWNER_ONLY` | NULL |
| `FILE` | `OWNER_ONLY` | NULL |
| `CALENDAR_EVENT` | `OPEN_TO_ORG` | `VIEWER` |
| `PROJECT` | `OPEN_TO_ORG` | `EDITOR` |
| `AGENT` | `OPEN_TO_ORG` | `VIEWER` |
| `ROOM` | `OPEN_TO_ORG` | `VIEWER` |
| `PROVIDER_KEY` | `OWNER_ONLY` | NULL |
| `PROMPT` | `OPEN_TO_ORG` | `VIEWER` |
| `AGENT_CRON_TASK` | `OWNER_ONLY` | NULL |

Org admins change these from `/admin/permissions` (existing page, updated UI).

---

## Access function

One function, everything else collapses to it. Lives in `PermissionChecker`:

```python
async def effective_role(
    self,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,                             # from content row
    access_mode: AccessMode,                    # from content row
    baseline_role: ContentRole | None,          # from content row
) -> ContentRole | None:
    """Compute the user's effective role on a piece of content.

    Returns None if the user has no access. Callers map the role to
    capabilities via role_can_*() helpers.

    For delegating content types (TASK, COMMENT, ATTACHMENT, etc.),
    callers first resolve the parent content and call this function
    with the parent's fields.
    """
    # 1. Organization-wide admin bypass
    if await self._is_org_admin(user_id, organization_id):
        return ContentRole.OWNER

    # 2. Domain-admin bypass (per-domain admin status)
    if await self._is_domain_admin_for_content(user_id, organization_id, content_type):
        return ContentRole.ADMIN

    # 3. Owner
    if owner_id == user_id:
        return ContentRole.OWNER

    # 4. Explicit member role (user direct + via groups)
    member_role = await self._get_member_role(
        organization_id, content_type, content_id, user_id
    )

    # 4a. BLOCKED is explicit deny
    if member_role == ContentRole.BLOCKED:
        return None

    # 4b. Explicit role beats baseline
    if member_role is not None:
        return member_role

    # 5. Baseline by access mode
    if access_mode == AccessMode.OWNER_ONLY:
        return None

    if access_mode == AccessMode.EXPLICIT_MEMBERS:
        return None

    if access_mode == AccessMode.OPEN_TO_ORG:
        # Must be a member of the org to get baseline access
        if not await self._is_user_in_organization(user_id, organization_id):
            return None
        return baseline_role  # may be None

    return None
```

`_get_member_role` collects all applicable rows (direct + group) and picks the highest, with BLOCKED winning over everything:

```python
async def _get_member_role(
    self,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    user_id: UUID,
) -> ContentRole | None:
    """Highest applicable role from direct + group-derived membership.

    BLOCKED wins over any other role (from any source).
    """
    now = datetime.now(UTC)

    # Direct user grant
    direct_row = (await self.session.execute(
        select(ContentMember.role)
        .where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.content_id == content_id,
            ContentMember.subject_type == SubjectType.USER,
            ContentMember.subject_id == user_id,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
        )
    )).scalar_one_or_none()

    if direct_row == ContentRole.BLOCKED:
        return ContentRole.BLOCKED

    # Group grants
    user_groups = (
        select(GroupMember.group_id)
        .where(
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,  # noqa: E712
        )
    )
    group_rows = [
        r[0] for r in (await self.session.execute(
            select(ContentMember.role)
            .where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == content_type,
                ContentMember.content_id == content_id,
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id.in_(user_groups),
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
        )).all()
    ]

    if ContentRole.BLOCKED in group_rows:
        return ContentRole.BLOCKED

    candidates: list[ContentRole] = []
    if direct_row is not None:
        candidates.append(direct_row)
    candidates.extend(group_rows)

    if not candidates:
        return None

    return max(candidates, key=ROLE_ORDINAL.get)
```

### Role capability mapping

Lives in `core/auth/permissions/roles.py`. Single source of truth.

```python
ROLE_ORDINAL: dict[ContentRole, int] = {
    ContentRole.BLOCKED:   -1,
    ContentRole.VIEWER:     1,
    ContentRole.COMMENTER:  2,
    ContentRole.EDITOR:     3,
    ContentRole.ADMIN:      4,
    ContentRole.OWNER:      5,
}

MIN_FOR_VIEW     = ROLE_ORDINAL[ContentRole.VIEWER]
MIN_FOR_COMMENT  = ROLE_ORDINAL[ContentRole.COMMENTER]
MIN_FOR_EDIT     = ROLE_ORDINAL[ContentRole.EDITOR]
MIN_FOR_DELETE   = ROLE_ORDINAL[ContentRole.ADMIN]
MIN_FOR_MANAGE   = ROLE_ORDINAL[ContentRole.ADMIN]
MIN_FOR_TRANSFER = ROLE_ORDINAL[ContentRole.OWNER]


def role_can_view(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_VIEW


def role_can_comment(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_COMMENT


def role_can_edit(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_EDIT


def role_can_delete(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_DELETE


def role_can_manage(role: ContentRole | None) -> bool:
    """Can add/remove members, change access mode, change baseline."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_MANAGE


def role_can_transfer(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_TRANSFER


def role_is_higher_than(a: ContentRole, b: ContentRole) -> bool:
    return ROLE_ORDINAL[a] > ROLE_ORDINAL[b]
```

These replace the separate `can_view/can_edit/can_delete/can_share/can_move` flags that existed on `ContentPermission`.

---

## List queries

`ContentAccessQuery.build_accessible_filter()` gets rewritten (no fallback to a legacy version). New signature takes the table's access_mode and baseline_role columns:

```python
def build_accessible_filter(
    self,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id_column: InstrumentedAttribute,
    owner_id_column: InstrumentedAttribute,
    access_mode_column: InstrumentedAttribute,
    baseline_role_column: InstrumentedAttribute,
) -> Any:
    """Build a WHERE clause for content the user can see.

    Caller must add `organization_id` scoping themselves (every
    domain-specific list endpoint already does this).
    """
    from datetime import UTC, datetime

    from uniffy.core.models.login.group_member import GroupMember
    from uniffy.core.models.permissions.content_member import ContentMember
    from uniffy.core.models.shared import AccessMode, ContentRole, SubjectType

    now = datetime.now(UTC)

    user_groups_subq = (
        select(GroupMember.group_id)
        .where(
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,  # noqa: E712
        )
    )

    # Content where the user is explicitly BLOCKED (direct or via group).
    # These must be excluded unconditionally.
    blocked_subq = (
        select(ContentMember.content_id)
        .where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.role == ContentRole.BLOCKED,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
            or_(
                and_(
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == user_id,
                ),
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(user_groups_subq),
                ),
            ),
        )
    )

    # Content where the user has a non-blocked explicit grant.
    explicit_member_subq = (
        select(ContentMember.content_id)
        .where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.role != ContentRole.BLOCKED,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
            or_(
                and_(
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == user_id,
                ),
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(user_groups_subq),
                ),
            ),
        )
    )

    ownership = owner_id_column == user_id

    open_to_org = and_(
        access_mode_column == AccessMode.OPEN_TO_ORG,
        baseline_role_column.is_not(None),
    )

    has_any_access = or_(
        ownership,
        content_id_column.in_(explicit_member_subq),
        open_to_org,
    )

    return and_(
        content_id_column.notin_(blocked_subq),
        has_any_access,
    )
```

Org-admin-sees-everything is handled at a higher layer: `list_accessible()` checks `_is_org_admin()` first and, if true, returns all content in the org without applying the filter. Same for domain admins.

---

## Capability check on single content

`BaseContentOperations` loses its `_require_access`, `_require_edit`, `_require_delete`, `_require_admin` methods in favor of a single resolution path:

```python
async def _resolve_role(
    self,
    user_id: UUID,
    organization_id: UUID,
    content: TModel,
) -> ContentRole | None:
    return await self.permission_checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=self.content_type,
        content_id=content.id,
        owner_id=content.owner_id,
        access_mode=content.access_mode,
        baseline_role=content.baseline_role,
    )


async def _require_role(
    self,
    user_id: UUID,
    organization_id: UUID,
    content: TModel,
    predicate: Callable[[ContentRole | None], bool],
    action: str,
) -> None:
    role = await self._resolve_role(user_id, organization_id, content)
    if not predicate(role):
        raise PermissionDeniedError(action, self.content_type.value)


# Then the public helpers call _require_role with the right predicate:
async def _require_view(self, user_id, organization_id, content):
    await self._require_role(user_id, organization_id, content, role_can_view, "access")

async def _require_edit(self, user_id, organization_id, content):
    await self._require_role(user_id, organization_id, content, role_can_edit, "edit")

async def _require_delete(self, user_id, organization_id, content):
    await self._require_role(user_id, organization_id, content, role_can_delete, "delete")

async def _require_manage(self, user_id, organization_id, content):
    await self._require_role(user_id, organization_id, content, role_can_manage, "manage")

async def _require_transfer(self, user_id, organization_id, content):
    await self._require_role(user_id, organization_id, content, role_can_transfer, "transfer")
```

### Delegation for child content types

`BaseContentOperations` subclasses for child types override `_resolve_role` to look up the parent:

```python
# TaskOperations
async def _resolve_role(self, user_id, organization_id, content):
    from uniffy.domains.projects.operations import ProjectOperations
    project = await ProjectOperations(self.session)._fetch_raw(content.project_id, organization_id)
    return await self.permission_checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.PROJECT,       # resolve against parent type
        content_id=project.id,
        owner_id=project.owner_id,
        access_mode=project.access_mode,
        baseline_role=project.baseline_role,
    )
```

The delegation pattern is the same for comments, attachments, file versions, reminders, and so on.

---

## Members operations API

A new class in `core/content/members.py` that any domain can use to manage members on a content item. No per-domain member tables, no per-domain CRUD duplication.

```python
class ContentMembersOperations:
    """Generic member management for any content type."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permission_checker = PermissionChecker(session)

    async def list_members(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> list[ContentMember]:
        """List all member rows for a piece of content. Requires VIEW."""

    async def add_member(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        role: ContentRole,
        expires_at: datetime | None = None,
        note: str = "",
    ) -> ContentMember:
        """Add a new member. Requires MANAGE on the content.

        Rejects:
        - role == OWNER (must go through transfer_ownership)
        - subject is the current owner (cannot demote the owner)
        - access_mode == OWNER_ONLY (must expand mode first)
        - adding an org admin with role BLOCKED (org admins cannot be blocked)
        """

    async def update_member_role(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        new_role: ContentRole,
        note: str = "",
    ) -> ContentMember:
        """Change an existing member's role. Requires MANAGE.

        Rejects:
        - new_role == OWNER (must go through transfer_ownership)
        - demoting the owner (not representable here)
        - changing an org admin to BLOCKED
        """

    async def remove_member(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        note: str = "",
    ) -> None:
        """Remove an existing member. Requires MANAGE."""

    async def set_access_mode(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_access_mode: AccessMode,
        new_baseline_role: ContentRole | None = None,
        note: str = "",
    ) -> None:
        """Change the access mode and/or baseline role. Requires MANAGE.

        The caller is responsible for loading the content row and passing
        it via the content-aware helper in the domain layer -- this method
        updates the content row and writes the audit event.

        Rejects:
        - new_access_mode == OPEN_TO_ORG without a baseline_role
        - new_access_mode != OPEN_TO_ORG with a baseline_role
        - baseline_role in (OWNER, BLOCKED)
        - new_access_mode == OWNER_ONLY while member rows exist (rejected unless
          the caller explicitly opts in via remove_members_on_narrow=True, which
          deletes all member rows first and writes MEMBER_REMOVED events)
        """

    async def transfer_ownership(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_owner_user_id: UUID,
        note: str = "",
    ) -> None:
        """Transfer ownership to a different user. Requires TRANSFER
        (i.e. actor is current owner, org admin, or domain admin).

        Previous owner automatically becomes ADMIN via a ContentMember row.
        New owner's existing ContentMember row (if any) is deleted.

        Rejects:
        - new_owner is not an active member of the organization
        """
```

Every mutating method:

1. Loads the content row (via a domain-specific resolver function passed in, since the member ops class is generic).
2. Resolves the actor's effective role on the content.
3. Enforces the required capability (`role_can_manage` or `role_can_transfer`).
4. Applies the mutation.
5. Writes a `ContentMemberEvent` row for the audit log.
6. Emits the appropriate notification (same types as today: `PERMISSION_GRANTED` / `PERMISSION_REVOKED`).
7. Updates the search index sharing metadata via `SearchIndexer.update_sharing()`.

### Content row loaders

The members operations class needs to load the content row for each content type. To keep it generic, domains register their loaders:

```python
# core/content/members.py
CONTENT_LOADERS: dict[ContentType, Callable[[AsyncSession, UUID, UUID], Awaitable[Any]]] = {}

def register_content_loader(content_type: ContentType, loader):
    CONTENT_LOADERS[content_type] = loader


# In each domain's __init__.py:
from uniffy.core.content.members import register_content_loader
from uniffy.domains.projects.operations import _load_project_raw
register_content_loader(ContentType.PROJECT, _load_project_raw)
```

This avoids a switch statement inside `ContentMembersOperations` and keeps domain ownership clean.

---

## RPC surface

A single generic `permissions.v1.MembersService` replaces `permissions.v1.PermissionsService`:

```protobuf
// proto/permissions/v1/members.proto
syntax = "proto3";
package permissions.v1;

import "common/v1/common.proto";
import "google/protobuf/timestamp.proto";

service MembersService {
  rpc ListMembers(ListMembersRequest) returns (ListMembersResponse);
  rpc AddMember(AddMemberRequest) returns (MemberResponse);
  rpc UpdateMemberRole(UpdateMemberRoleRequest) returns (MemberResponse);
  rpc RemoveMember(RemoveMemberRequest) returns (RemoveMemberResponse);
  rpc SetAccessMode(SetAccessModeRequest) returns (AccessModeResponse);
  rpc TransferOwnership(TransferOwnershipRequest) returns (TransferOwnershipResponse);

  // Audit log
  rpc ListMemberEvents(ListMemberEventsRequest) returns (ListMemberEventsResponse);
}

message ContentMember {
  common.v1.SubjectType subject_type = 1;
  string                subject_id    = 2;
  common.v1.ContentRole role          = 3;
  string                added_by_user_id = 4;
  google.protobuf.Timestamp added_at  = 5;
  google.protobuf.Timestamp updated_at = 6;
  optional google.protobuf.Timestamp expires_at = 7;
}

message ContentAccessPolicy {
  string                owner_id = 1;
  common.v1.AccessMode  access_mode = 2;
  optional common.v1.ContentRole baseline_role = 3;
}

message ListMembersRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
}
message ListMembersResponse {
  ContentAccessPolicy policy = 1;
  repeated ContentMember members = 2;
}

message AddMemberRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  common.v1.SubjectType subject_type = 4;
  string subject_id = 5;
  common.v1.ContentRole role = 6;
  optional google.protobuf.Timestamp expires_at = 7;
  string note = 8;
}

message UpdateMemberRoleRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  common.v1.SubjectType subject_type = 4;
  string subject_id = 5;
  common.v1.ContentRole new_role = 6;
  string note = 7;
}

message RemoveMemberRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  common.v1.SubjectType subject_type = 4;
  string subject_id = 5;
  string note = 6;
}
message RemoveMemberResponse { bool success = 1; }

message SetAccessModeRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  common.v1.AccessMode access_mode = 4;
  optional common.v1.ContentRole baseline_role = 5;
  bool remove_members_on_narrow = 6;   // allows OWNER_ONLY / EXPLICIT_MEMBERS transitions that shed members
  string note = 7;
}
message AccessModeResponse { ContentAccessPolicy policy = 1; }

message TransferOwnershipRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  string new_owner_user_id = 4;
  string note = 5;
}
message TransferOwnershipResponse { ContentAccessPolicy policy = 1; }

message MemberResponse { ContentMember member = 1; }

// Audit log
message ContentMemberEvent {
  string id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  ContentMemberAction action = 4;

  optional common.v1.SubjectType subject_type = 5;
  optional string subject_id = 6;

  optional common.v1.ContentRole previous_role = 7;
  optional common.v1.ContentRole new_role = 8;
  optional common.v1.AccessMode  previous_access_mode = 9;
  optional common.v1.AccessMode  new_access_mode = 10;
  optional common.v1.ContentRole previous_baseline_role = 11;
  optional common.v1.ContentRole new_baseline_role = 12;
  optional string previous_owner_id = 13;
  optional string new_owner_id = 14;

  string actor_user_id = 15;
  common.v1.OrganizationRole actor_org_role = 16;
  string note = 17;
  google.protobuf.Timestamp occurred_at = 18;
}

enum ContentMemberAction {
  CONTENT_MEMBER_ACTION_UNSPECIFIED         = 0;
  CONTENT_MEMBER_ACTION_MEMBER_ADDED        = 1;
  CONTENT_MEMBER_ACTION_MEMBER_ROLE_CHANGED = 2;
  CONTENT_MEMBER_ACTION_MEMBER_REMOVED      = 3;
  CONTENT_MEMBER_ACTION_ACCESS_MODE_CHANGED = 4;
  CONTENT_MEMBER_ACTION_BASELINE_ROLE_CHANGED = 5;
  CONTENT_MEMBER_ACTION_OWNERSHIP_TRANSFERRED = 6;
}

message ListMemberEventsRequest {
  string organization_id = 1;
  common.v1.ContentType content_type = 2;
  string content_id = 3;
  optional common.v1.PaginationRequest pagination = 4;
  optional string actor_user_id = 5;                    // filter by actor
  optional ContentMemberAction action = 6;              // filter by action type
  optional google.protobuf.Timestamp after = 7;
  optional google.protobuf.Timestamp before = 8;
}
message ListMemberEventsResponse {
  repeated ContentMemberEvent events = 1;
  common.v1.PaginationResponse pagination = 2;
}
```

New enums in `proto/common/v1/common.proto`:

```protobuf
enum ContentRole {
  CONTENT_ROLE_UNSPECIFIED = 0;
  CONTENT_ROLE_VIEWER      = 1;
  CONTENT_ROLE_COMMENTER   = 2;
  CONTENT_ROLE_EDITOR      = 3;
  CONTENT_ROLE_ADMIN       = 4;
  CONTENT_ROLE_OWNER       = 5;
  CONTENT_ROLE_BLOCKED     = 6;
}

enum AccessMode {
  ACCESS_MODE_UNSPECIFIED      = 0;
  ACCESS_MODE_OWNER_ONLY       = 1;
  ACCESS_MODE_EXPLICIT_MEMBERS = 2;
  ACCESS_MODE_OPEN_TO_ORG      = 3;
}
```

Removed from `common.proto`: `enum VisibilityScope`, `enum PermissionLevel`.

---

## Per-domain impact summary

| Domain | Changes |
|---|---|
| **notes** | Drop `visibility` column, add `access_mode`+`baseline_role`. Update operations to use new checker. Delete any direct references to `ContentPermission`. |
| **files** | Same as notes. Folders the same way. File versions delegate to parent file. |
| **calendar** | Drop `visibility` from `calendar_events`. Add `access_mode`+`baseline_role`. Event attendees are orthogonal; they stay. Reminders delegate. |
| **projects** | Drop `visibility` from `projects_projects` and `projects_tasks`. Drop `member_ids` JSONB from projects. Add `access_mode`+`baseline_role` to projects. Tasks delegate to parent project. Sprints, field definitions, views, activities all delegate. Delete all references to ContentPermission/visibility in operations. |
| **agents** | Drop `visibility` from `agents_agents`, `agents_provider_keys`, `agents_prompts`, `agents_cron_tasks`. Add `access_mode`+`baseline_role` to each. Update operations. |
| **rooms** | Drop `visibility` from `rooms_rooms`. Add `access_mode`+`baseline_role`. |
| **comments** | Delegates to parent. No schema change; operations simplified. |
| **attachments** | Delegates to parent. No schema change; operations simplified. |
| **search** | Search indexer uses `ContentMember` instead of `ContentPermission` to compute `shared_user_ids` / `shared_group_ids`. The `visibility` field in search documents is replaced with `access_mode` + `baseline_role`. |
| **chat** | **No change** except: drop the unused `visibility` column from `chat_channels` since `channel_type` already encodes the distinction and `ChatAccessChecker` never reads `visibility`. |
| **bookmarks** | No permission changes (bookmarks are user-scoped and don't have their own access). |
| **notifications** | No changes except the text on `PERMISSION_GRANTED`/`PERMISSION_REVOKED` notifications. |
| **organizations** | Update `OrganizationPermissionDefaults` model + the `/admin/permissions` UI on the frontend. |
| **permissions** | The domain formerly hosting `PermissionsService` is repurposed to host `MembersService`. `SharingDialog` backend is deleted; the frontend replaces it with a members panel. |
| **users**, **groups**, **auth**, **bookmarks**, **presence**, **settings** | No changes. |

---

## Cascade behavior

Today's `cascade_permission_grant` propagates VIEW to content referenced by the shared item (URN mentions, attachments). The behavior is preserved in the new model:

- When a user is added to content with any non-blocked role, they get VIEWER on each referenced item that the *granting user* can manage.
- When a group is added, all group members get VIEWER on referenced items.
- BLOCKED does not cascade (a block on content X does not imply a block on content X references).
- Visibility changes are replaced with access mode changes; cascading semantics stay "VIEWER on referenced items".

The cascade lives in `core/content/cascade.py` and is updated to write `ContentMember` rows instead of `ContentPermission` rows.

---

## Search integration

`SearchIndexer.update_sharing()` keeps its signature. The backend computes `shared_user_ids` and `shared_group_ids` from `ContentMember` rows (excluding BLOCKED), not `ContentPermission`.

The search document's `visibility` field is removed. New fields:

```python
access_mode: str            # AccessMode value
baseline_role: str | None   # ContentRole value or null
```

Meilisearch filter expressions in the search service update accordingly.

---

## Frontend impact summary

This is not exhaustively enumerated here -- each screen that displays visibility or sharing gets its own pass. The key changes:

1. **New shared primitives** in `src/ui/src/features/permissions/`:
   - `AccessPolicyPanel.tsx` -- shows owner, access mode selector, baseline role selector, member list.
   - `MemberRow.tsx` -- avatar + subject + role picker + remove button. Separate variant for BLOCKED members.
   - `AddMemberPopover.tsx` -- wraps `SubjectPicker` + role selector.
   - `AccessModeSelector.tsx` -- 3-option picker (OWNER_ONLY / EXPLICIT_MEMBERS / OPEN_TO_ORG) with baseline picker when OPEN_TO_ORG.
   - `ContentRoleBadge.tsx` -- consistent role badge across the app.
   - `useContentMembers(contentType, contentId)` hook -- fetches members, exposes add/remove/update mutations.
   - `useContentAuditLog(contentType, contentId)` hook -- fetches `ListMemberEvents`.

2. **Delete `src/ui/src/features/sharing/`** entirely. The old SharingDialog path goes away. Any code that opens the dialog now opens the `AccessPolicyPanel` (as a dialog or a side panel depending on context).

3. **Delete all references to `VisibilityScope` / `PermissionLevel`** from the frontend. Any place that currently shows "Private / Organization" now shows the access mode. Any place that checks `permissionLevel >= EDIT` now checks `role_can_edit(role)` via a shared helper.

4. **Shared role-capability helpers** in `src/ui/src/shared/utils/contentRoles.ts` mirroring the backend ordinals:
   ```typescript
   export const roleCanView = (role: ContentRole | null) => ...
   export const roleCanEdit = (role: ContentRole | null) => ...
   // etc.
   ```

5. **Admin page `/admin/permissions`** updated to edit the new org defaults (`default_access_mode`, `default_baseline_role`).

6. **Every domain's content-detail / settings page** (notes, files, calendar, projects, agents, rooms) gets the `AccessPolicyPanel` wired in somewhere sensible (usually Settings > Access, or an "Access" button in the header).

7. **Audit log UI** -- a read-only "Access history" tab on each access-controlled content's settings page, powered by `useContentAuditLog`. Each event shows actor + subject + action + time. Filter controls for actor and action type.

---

## Edge cases and explicit rules

1. **Org admin / domain admin always bypass BLOCKED.** Org admins are effectively OWNER on all content; domain admins are effectively ADMIN on their domain's content. BLOCKED only applies to regular members. The UI rejects attempts to BLOCK an org admin or relevant domain admin with a clear error.

2. **Owner cannot be BLOCKED.** API rejects. UI does not offer the option. Even if the row somehow existed, `effective_role()` checks the owner before the member lookup.

3. **Owner cannot be demoted via `add_member` or `update_member_role`.** Ownership changes go through `transfer_ownership` only.

4. **`transfer_ownership` behavior**: previous owner keeps access as ADMIN via a new `ContentMember` row; the new owner's existing ContentMember row (if any) is deleted; `owner_id` on the content row is updated; a `ContentMemberEvent(OWNERSHIP_TRANSFERRED)` and a `MEMBER_ADDED` (for the ex-owner) are both written.

5. **Leaving a group after being BLOCKED via that group** lifts the block automatically. Intentional -- "remove Bob from the group, he regains access" is the expected behavior.

6. **Direct EDITOR + group BLOCKED = BLOCKED.** Any BLOCKED source wins. Rationale: BLOCKED is the explicit deny primitive.

7. **Two groups both grant roles, one EDITOR and one ADMIN**: the higher role wins (ADMIN).

8. **`EXPLICIT_MEMBERS` → `OPEN_TO_ORG`**: existing member rows are preserved and continue to override the baseline. UI shows "Everyone in the org will gain {baseline} access. Existing members keep their elevated roles."

9. **`OPEN_TO_ORG` → `EXPLICIT_MEMBERS`**: anyone currently relying on the baseline loses access; only people with an explicit role keep it. UI shows a warning listing affected org members (up to N, then "and X more").

10. **Any mode → `OWNER_ONLY`**: refused unless the caller passes `remove_members_on_narrow=True`, in which case all member rows are deleted first (each produces a `MEMBER_REMOVED` audit event). UI confirms with "This will remove N members from the {content}. Continue?".

11. **Access on child content** (tasks, comments, attachments, reminders, attendees): the child's operations class overrides `_resolve_role` to fetch the parent and delegate. There is no `access_mode` column on child tables.

12. **Calendar events attended by non-org users** does not exist in Uniffy today; out of scope.

13. **Subject deletion** (user or group): `ContentMember` rows for that subject are deleted by the ops layer when the subject is deleted (not by FK cascade -- operations layer handles it, since the `subject_id` is polymorphic and has no FK constraint). `ContentMemberEvent` rows remain untouched for audit continuity.

14. **Expired grants**: filtered in every read path (`effective_role`, `build_accessible_filter`, `list_members`). A cron job (future enhancement) cleans up grants past their expiration.

15. **`baseline_role = OWNER` or `baseline_role = BLOCKED`** are not allowed. API rejects. Enforced by application logic and documented.

---

## Test plan

All in `src/uniffy/tests/core/`:

- `test_role_capabilities.py` -- unit tests for `role_can_*` helpers.
- `test_effective_role.py` -- every branch of `effective_role()`:
  - org admin bypass (including when BLOCKED, member row, not in org, etc.)
  - domain admin bypass (same matrix)
  - owner
  - direct user member (each role including BLOCKED)
  - group member (each role including BLOCKED)
  - direct EDITOR + group BLOCKED → None
  - two groups, different roles → highest
  - OWNER_ONLY: denies non-owner
  - EXPLICIT_MEMBERS: denies non-member
  - OPEN_TO_ORG with null baseline: denies
  - OPEN_TO_ORG with baseline VIEWER: allows VIEWER
  - OPEN_TO_ORG with baseline VIEWER + user BLOCKED: denies
  - expired grant treated as absent
- `test_member_ops.py` -- `ContentMembersOperations`:
  - add_member happy path
  - add_member rejects OWNER role
  - add_member rejects BLOCKED on org admin
  - add_member rejects when OWNER_ONLY
  - update_member_role happy path
  - update_member_role rejects OWNER
  - remove_member happy path
  - set_access_mode happy path
  - set_access_mode rejects OPEN_TO_ORG without baseline
  - set_access_mode rejects OWNER_ONLY when members exist and `remove_members_on_narrow=False`
  - transfer_ownership rewrites owner_id, creates ADMIN row for ex-owner, deletes any existing member row for the new owner
- `test_member_events.py` -- audit log:
  - Every mutating op produces exactly one event row with the right state fields.
  - Events are listed in descending occurred_at.
  - Pagination works.
  - Filters by actor, action, time range.
- `test_access_query.py` -- list filter:
  - Returns owned content
  - Returns content with explicit non-blocked role
  - Returns OPEN_TO_ORG content with non-null baseline
  - Excludes content the user is BLOCKED from
  - Excludes BLOCKED via group
  - Cross-organization isolation

Integration tests live alongside each domain's operations tests and verify that the domain uses `BaseContentOperations`' new access path correctly.

---

## Out of scope / follow-ups

Captured here to avoid polluting the foundation work:

- Recursive inheritance through content hierarchies (folders → files, note trees)
- Time-bound access cleanup cron
- GDPR anonymization of audit log rows
- Public external sharing (`PUBLIC` equivalent)
- Permission templates / schemes (Jira-style)
- Cross-content-type aggregate queries ("everything I have access to, regardless of type")
- Role inheritance ("a custom 'Contributor' role that behaves like EDITOR but...")
- Team workspaces as a first-class concept

---

## File manifest

This is the list of files touched across the full rewrite. The backlog document (`permissions-redesign-backlog.md`) tracks which of these are done, in progress, or blocked.

### Backend -- foundation (phase 0)

**New files:**
```
src/uniffy/core/auth/permissions/roles.py
src/uniffy/core/auth/permissions/audit.py
src/uniffy/core/models/permissions/content_member.py
src/uniffy/core/models/permissions/content_member_event.py
src/uniffy/core/content/members.py
src/uniffy/db/migrations/versions/043_permissions_redesign.py
src/uniffy/tests/core/test_role_capabilities.py
src/uniffy/tests/core/test_effective_role.py
src/uniffy/tests/core/test_member_lookup.py
src/uniffy/tests/core/test_member_ops.py
src/uniffy/tests/core/test_member_events.py
src/uniffy/tests/core/test_access_query.py
```

**Modified files:**
```
src/uniffy/core/models/shared.py                     # new enums; delete VisibilityScope, PermissionLevel
src/uniffy/core/types.py                             # re-exports
src/uniffy/core/models/permissions/__init__.py       # export new models; stop exporting old
src/uniffy/core/models/permissions/org_permission_defaults.py  # new columns
src/uniffy/core/models/__init__.py                   # exports
src/uniffy/core/auth/permissions/checker.py          # rewrite
src/uniffy/core/auth/permissions/queries.py          # rewrite
src/uniffy/core/auth/permissions/__init__.py         # exports
src/uniffy/core/auth/permissions/helpers.py          # drop references to old types
src/uniffy/core/content/base_operations.py           # new _require_* methods
src/uniffy/core/content/cascade.py                   # rewrite to use ContentMember
```

**Deleted files:**
```
src/uniffy/core/models/permissions/content_permission.py
src/uniffy/core/models/permissions/content_group_link.py
```

### Backend -- domains (phase 1)

Each domain gets its own change list. The pattern is the same for all: drop `visibility` column, add `access_mode` + `baseline_role`, update operations / handlers / converters to use new checker.

(Full list lives in the backlog document.)

### Proto

```
src/proto/common/v1/common.proto                     # add ContentRole, AccessMode; delete VisibilityScope, PermissionLevel
src/proto/permissions/v1/permissions.proto           # DELETE (replaced by members.proto)
src/proto/permissions/v1/members.proto               # NEW (MembersService)
src/proto/{notes,files,calendar,projects,agents,rooms,organizations}/v1/*.proto  # remove VisibilityScope references, add AccessMode + baseline_role
```

After proto changes: `./run.sh proto` regenerates everything.

### Frontend

```
src/ui/src/features/permissions/                     # NEW directory (AccessPolicyPanel, MemberRow, etc.)
src/ui/src/features/sharing/                         # DELETE
src/ui/src/shared/utils/contentRoles.ts              # NEW (ordinals + role_can_* helpers)
src/ui/src/features/projects/components/settings/MembersSection.tsx  # NEW (uses AccessPolicyPanel)
src/ui/src/features/projects/components/settings/GeneralSection.tsx  # remove visibility selector
... # similarly for notes/files/calendar/agents/rooms
src/ui/src/features/admin/components/permissions/    # update to new org defaults shape
```

Full frontend list in the backlog document.

---

## Implementation plan at a glance

The implementation runs through the backlog document in order. High-level grouping:

1. **Phase 0 -- Foundation**
   - Delete / gut the existing permission primitives that no one reads yet
   - Add new enums, models, helpers, audit log, migration
   - Rewrite `PermissionChecker`, `ContentAccessQuery`, `BaseContentOperations`
   - Write full unit test coverage
   - `./run.sh test` + `./run.sh lint-backend` clean
   - At this point nothing domain-specific compiles -- every domain will be broken until phase 1 starts (since we removed `VisibilityScope`). That's fine and intended: we do the domains in a single continuous pass right after.

2. **Phase 1 -- Domains (all in one pass)**
   - notes, files, calendar, projects, agents, rooms, comments, attachments, search, chat (just the visibility-drop), organizations admin defaults
   - For each domain: model change, migration, operations, handlers, converters
   - `./run.sh test` + `./run.sh lint-backend` clean

3. **Phase 2 -- Proto**
   - Update proto files, regenerate.
   - Backend imports the new generated code.
   - `./run.sh test` clean.

4. **Phase 3 -- Frontend**
   - Update types (generated + hand-rolled).
   - Delete `features/sharing/`.
   - Build `features/permissions/` primitives.
   - Update each domain's pages/panels to use the new components.
   - Update admin permissions page.
   - `./run.sh lint-frontend` + `./run.sh test-frontend` clean.

5. **Phase 4 -- End-to-end verification**
   - Manual walkthrough: create org, create project, add members, block a member, transfer ownership, inspect audit log, verify each domain works.
   - Fix any regressions.

This is a single continuous refactor with no reversible milestones in between (since we're not keeping the old system). Each phase has a clean compile/lint/test requirement before we move on.
