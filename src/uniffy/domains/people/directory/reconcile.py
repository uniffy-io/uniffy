"""Reconcile engine: normalized directory records into local users, profiles, groups.

Per-record primitives serve every plane - the pull driver here, a SCIM push
endpoint, an OIDC JIT login later. `find_linked_user` / `provision_from_login`
are that door. Global identity is written ONCE at creation; afterwards a source
owns org-scoped facts only, and name/username/email drift is reported, never
applied.
"""

import time
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.emails import normalize_email
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentityLink, IdentitySource
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.search import SearchIndexer
from uniffy.core.types import SubjectType, generate_id
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.groups.naming import dedupe_name, resolve_slug
from uniffy.domains.groups.search import TeamSearchIndexer
from uniffy.domains.organizations.operations import (
    OrganizationOperations,
)
from uniffy.domains.people.cache import invalidate_org_people, invalidate_person
from uniffy.domains.people.directory.base import DirectorySyncProvider
from uniffy.domains.people.directory.types import (
    DirectoryGroup,
    DirectoryUser,
    ReconcileReport,
)
from uniffy.domains.people.search import sync_people_search
from uniffy.domains.users.search import UserSearchIndexer

logger = logger.bind(component="people.directory.reconcile")

CHUNK_SIZE = 500

# A truncated LDAP page or a wrong base DN must not depopulate an org: a run
# that would deactivate more than this share of active members aborts whole.
MAX_DEPROVISION_RATIO = 0.2

# Profile columns a source may supply; every supplied one is also marked managed.
SYNCED_PROFILE_FIELDS = (
    "job_title",
    "department",
    "office_location",
    "timezone",
    "work_phone",
    "mobile_phone",
)


def record_display_name(record: DirectoryUser) -> str:
    if record.display_name:
        return record.display_name
    parts = [p for p in (record.given_name, record.family_name) if p]
    return " ".join(parts) if parts else record.user_name


def record_profile_fields(record: DirectoryUser) -> dict[str, str]:
    """Supplied org-scoped fields only; an absent field stays admin/self-owned."""
    fields: dict[str, str] = {}
    for name in SYNCED_PROFILE_FIELDS:
        value = getattr(record, name)
        if value is not None:
            fields[name] = value
    return fields


async def _dedupe_username(session: AsyncSession, base: str) -> str:
    """Global usernames collide across tenants; suffix with a counter."""
    base = (base or "user")[:240]
    candidate = base
    suffix = 1
    while True:
        existing = await session.execute(select(User.id).where(User.username == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        suffix += 1
        candidate = f"{base}{suffix}"


async def _get_link(
    session: AsyncSession,
    source: IdentitySource,
    subject_type: SubjectType,
    external_id: str,
) -> IdentityLink | None:
    result = await session.execute(
        select(IdentityLink).where(
            IdentityLink.source_id == source.id,
            IdentityLink.subject_type == subject_type,
            IdentityLink.external_id == external_id,
        )
    )
    return result.scalar_one_or_none()


async def find_linked_user(
    session: AsyncSession, source: IdentitySource, external_id: str
) -> User | None:
    """The login-plane lookup: which local User is this external record."""
    result = await session.execute(
        select(User)
        .join(IdentityLink, IdentityLink.subject_id == User.id)
        .where(
            IdentityLink.source_id == source.id,
            IdentityLink.subject_type == SubjectType.USER,
            IdentityLink.external_id == external_id,
        )
    )
    return result.scalar_one_or_none()


def _touch_link(link: IdentityLink, record: DirectoryUser | DirectoryGroup) -> None:
    link.external_dn = record.external_dn
    link.raw = dict(record.raw)
    link.synced_at = datetime.now(UTC)


async def _write_profile(
    session: AsyncSession, organization_id: UUID, user_id: UUID, record: DirectoryUser
) -> None:
    fields = record_profile_fields(record)
    if not fields:
        return
    now = datetime.now(UTC)
    values = {
        "id": generate_id(),
        "organization_id": organization_id,
        "user_id": user_id,
        "created_at": now,
        "updated_at": now,
        "managed_fields": sorted(fields),
        **fields,
    }
    stmt = pg_insert(PeopleProfile).values(**values)
    await session.execute(
        stmt.on_conflict_do_update(
            constraint="uq_people_profiles_org_user",
            set_={"managed_fields": sorted(fields), "updated_at": now, **fields},
        )
    )


async def upsert_user(
    session: AsyncSession,
    source: IdentitySource,
    record: DirectoryUser,
    *,
    report: ReconcileReport,
) -> UUID | None:
    """Match (link -> email -> create), ensure membership, write org facts.

    Returns the local user id, or None when the record is skipped (inactive
    and unknown, no email to create with, or an email collision with an
    inactive account).
    """
    org_id = source.organization_id
    link = await _get_link(session, source, SubjectType.USER, record.external_id)

    user: User | None = None
    if link is not None:
        result = await session.execute(select(User).where(User.id == link.subject_id))
        user = result.scalar_one_or_none()
        if user is None:
            # The linked user was hard-deleted (platform path missed the link);
            # drop the stale link and fall through to a fresh match.
            await session.delete(link)
            link = None

    if user is None and record.email:
        email = normalize_email(record.email)
        result = await session.execute(select(User).where(User.email == email))
        by_email = result.scalar_one_or_none()
        if by_email is not None:
            if not by_email.is_active:
                logger.warning(
                    f"directory sync: record {record.external_id} matches "
                    f"deactivated user {by_email.id}; skipped"
                )
                report.users_skipped += 1
                return None
            user = by_email

    if user is None:
        if not record.active:
            report.users_skipped += 1
            return None
        if not record.email:
            # User.email is NOT NULL; a record without one cannot create.
            logger.warning(
                f"directory sync: record {record.external_id} has no email; cannot create"
            )
            report.users_skipped += 1
            return None
        user = User(
            email=normalize_email(record.email),
            username=await _dedupe_username(session, record.user_name),
            full_name=record_display_name(record),
            # Passwordless: the login path answers "use SSO" for such rows.
            hashed_password=None,
        )
        session.add(user)
        await session.flush()
        report.users_created += 1
    else:
        report.users_updated += 1
        supplied_name = record.display_name or record.given_name or record.family_name
        drift = bool(record.email and normalize_email(record.email) != user.email) or bool(
            supplied_name and record_display_name(record) != (user.full_name or user.username)
        )
        if drift:
            # Global identity is written once; a user synced by two tenants
            # must not have login identity clobbered by whichever ran last.
            report.skipped_global_changes += 1

    if link is None:
        link = IdentityLink(
            organization_id=org_id,
            source_id=source.id,
            subject_type=SubjectType.USER,
            subject_id=user.id,
            external_id=record.external_id,
        )
        session.add(link)
    _touch_link(link, record)

    if record.active:
        membership = await OrganizationOperations(session).get_membership(user.id, org_id)
        if membership is None or not membership.is_active:
            # Directly, never the invitations flow: a 5k-user sync must not
            # send 5k mails. add_member is reactivate-idempotent.
            await OrganizationOperations(session).add_member(user.id, org_id)

    await _write_profile(session, org_id, user.id, record)
    return user.id


async def resolve_manager(
    session: AsyncSession,
    source: IdentitySource,
    user_id: UUID,
    manager_external_id: str | None,
    manager_external_dn: str | None,
) -> bool:
    """Second-pass manager edge; the referenced user may have synced later."""
    manager_id: UUID | None = None
    if manager_external_id:
        link = await _get_link(session, source, SubjectType.USER, manager_external_id)
        manager_id = link.subject_id if link else None
    if manager_id is None and manager_external_dn:
        result = await session.execute(
            select(IdentityLink.subject_id).where(
                IdentityLink.source_id == source.id,
                IdentityLink.subject_type == SubjectType.USER,
                IdentityLink.external_dn == manager_external_dn,
            )
        )
        manager_id = result.scalars().first()
    if manager_id is None or manager_id == user_id:
        return False
    await session.execute(
        update(PeopleProfile)
        .where(
            PeopleProfile.organization_id == source.organization_id,
            PeopleProfile.user_id == user_id,
        )
        .values(manager_user_id=manager_id)
    )
    return True


async def upsert_group(
    session: AsyncSession,
    source: IdentitySource,
    record: DirectoryGroup,
    *,
    created_by_user_id: UUID,
    report: ReconcileReport,
) -> UUID:
    org_id = source.organization_id
    link = await _get_link(session, source, SubjectType.GROUP, record.external_id)

    group: Group | None = None
    if link is not None:
        result = await session.execute(select(Group).where(Group.id == link.subject_id))
        group = result.scalar_one_or_none()
        if group is None:
            await session.delete(link)
            link = None

    if group is None:
        name = await dedupe_name(session, org_id, record.display_name)
        if name != record.display_name:
            report.groups_renamed += 1
        group = Group(
            organization_id=org_id,
            name=name,
            slug=await resolve_slug(session, org_id, name),
            kind=record.kind,
            # A TEAM is always org-visible; the chart and mention fanout have
            # no per-viewer redaction.
            is_private=False,
            created_by_user_id=created_by_user_id,
            managed_fields=["name", "kind"],
        )
        session.add(group)
        await session.flush()
        report.groups_created += 1
    else:
        desired = await dedupe_name(session, org_id, record.display_name, exclude_group_id=group.id)
        if desired != group.name or group.kind != record.kind:
            if desired != group.name:
                if desired != record.display_name:
                    report.groups_renamed += 1
                group.name = desired
                group.slug = await resolve_slug(session, org_id, desired, exclude_group_id=group.id)
            group.kind = record.kind
            group.is_private = False
            report.groups_updated += 1
        group.managed_fields = ["name", "kind"]

    if link is None:
        link = IdentityLink(
            organization_id=org_id,
            source_id=source.id,
            subject_type=SubjectType.GROUP,
            subject_id=group.id,
            external_id=record.external_id,
        )
        session.add(link)
    _touch_link(link, record)
    return group.id


async def apply_group_membership(
    session: AsyncSession, group_id: UUID, member_user_ids: set[UUID]
) -> tuple[int, int]:
    """The synced roster is authoritative for a synced group: upsert the feed's
    members (keeping a manually granted ADMIN role), delete the rest."""
    added = 0
    if member_user_ids:
        now = datetime.now(UTC)
        rows = [
            {
                "id": generate_id(),
                "group_id": group_id,
                "user_id": user_id,
                "role": GroupRole.MEMBER,
                "is_active": True,
                "joined_at": now,
                "updated_at": now,
            }
            for user_id in member_user_ids
        ]
        for start in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[start : start + CHUNK_SIZE]
            stmt = pg_insert(GroupMember).values(chunk)
            result = await session.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_login_group_members_group_user",
                    set_={"is_active": True, "updated_at": now},
                )
            )
            added += result.rowcount or 0

    removal = delete(GroupMember).where(GroupMember.group_id == group_id)
    if member_user_ids:
        removal = removal.where(GroupMember.user_id.notin_(member_user_ids))
    result = await session.execute(removal)
    return added, int(result.rowcount or 0)


async def deprovision_user(
    session: AsyncSession,
    source: IdentitySource,
    user_id: UUID,
    search_indexer: SearchIndexer,
    *,
    active_owner_ids: set[UUID],
) -> bool:
    """Deactivate the org membership (never delete); refuses the last OWNER.

    Perm caches drop in the same operation - without that a deprovisioned
    user stays fully powered for the cache TTL.
    """
    org_id = source.organization_id
    membership = await OrganizationOperations(session).get_membership(user_id, org_id)
    if membership is None or not membership.is_active:
        return False
    if membership.role == OrganizationRole.OWNER and active_owner_ids <= {user_id}:
        logger.warning(f"directory sync: refusing to deprovision last owner {user_id}")
        return False

    membership.is_active = False
    membership.updated_at = datetime.now(UTC)
    await session.commit()

    active_owner_ids.discard(user_id)
    await invalidate_person(org_id, user_id)

    urn = f"urn:uniffy:content:USER:{user_id}"
    await UserSearchIndexer(session, search_indexer).remove_from_organization(user_id, org_id)
    await publish_mention_state(org_id, urn, {"urn_status": "DELETED"})
    return True


async def provision_from_login(
    session: AsyncSession,
    source: IdentitySource,
    record: DirectoryUser,
    search_indexer: SearchIndexer,
) -> User:
    """The whole job of a future OIDC callback or SCIM push: one record through
    the same primitives the pull driver uses."""
    report = ReconcileReport()
    user_id = await upsert_user(session, source, record, report=report)
    if user_id is None:
        raise ValidationError("record", "record cannot be provisioned")
    await session.commit()
    await invalidate_person(source.organization_id, user_id)
    await sync_people_search(session, search_indexer, source.organization_id, [user_id])
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one()


async def _resolve_sync_actor(session: AsyncSession, organization_id: UUID) -> UUID:
    """Synced groups need a created_by row owner; the earliest active OWNER serves."""
    result = await session.execute(
        select(OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.role == OrganizationRole.OWNER,
            OrganizationMember.is_active.is_(True),
        )
        .order_by(OrganizationMember.joined_at)
        .limit(1)
    )
    owner_id = result.scalars().first()
    if owner_id is None:
        raise ValidationError("organization", "organization has no active owner")
    return owner_id


async def _deprovision_pass(
    session: AsyncSession,
    source: IdentitySource,
    search_indexer: SearchIndexer,
    seen_external_ids: set[str],
    report: ReconcileReport,
) -> None:
    org_id = source.organization_id
    result = await session.execute(
        select(IdentityLink.external_id, IdentityLink.subject_id)
        .join(
            OrganizationMember,
            OrganizationMember.user_id == IdentityLink.subject_id,
        )
        .where(
            IdentityLink.source_id == source.id,
            IdentityLink.subject_type == SubjectType.USER,
            OrganizationMember.organization_id == org_id,
            OrganizationMember.is_active.is_(True),
        )
    )
    candidates = [row[1] for row in result.all() if row[0] not in seen_external_ids]
    if not candidates:
        return

    active_count = (
        await session.execute(
            select(func.count()).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.is_active.is_(True),
            )
        )
    ).scalar() or 0
    if active_count and len(candidates) / active_count > MAX_DEPROVISION_RATIO:
        report.aborted = True
        logger.error(
            f"directory sync aborted: feed would deprovision {len(candidates)} of "
            f"{active_count} active members in org {org_id}"
        )
        return

    owners = await session.execute(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.role == OrganizationRole.OWNER,
            OrganizationMember.is_active.is_(True),
        )
    )
    active_owner_ids = {row[0] for row in owners.all()}

    for user_id in candidates:
        if await deprovision_user(
            session,
            source,
            user_id,
            search_indexer,
            active_owner_ids=active_owner_ids,
        ):
            report.users_deprovisioned += 1
        else:
            report.deprovision_skipped += 1


async def run_full_sync(
    session: AsyncSession,
    source: IdentitySource,
    provider: DirectorySyncProvider,
    search_indexer: SearchIndexer,
) -> ReconcileReport:
    """Three-pass pull driver: users, then manager edges, then groups.

    Manager and parent references resolve in their own pass because the
    referenced record may sort later in the feed.
    """
    started = time.monotonic()
    report = ReconcileReport()
    org_id = source.organization_id

    source.last_sync_status = "running"
    source.last_sync_error = None
    await session.commit()

    touched: set[UUID] = set()
    seen_active: set[str] = set()
    manager_refs: list[tuple[UUID, str | None, str | None]] = []

    processed = 0
    async for record in provider.fetch_users():
        user_id = await upsert_user(session, source, record, report=report)
        if user_id is not None:
            touched.add(user_id)
            if record.active:
                seen_active.add(record.external_id)
            if record.manager_external_id or record.manager_external_dn:
                manager_refs.append((
                    user_id,
                    record.manager_external_id,
                    record.manager_external_dn,
                ))
        processed += 1
        if processed % CHUNK_SIZE == 0:
            await session.commit()
    await session.commit()

    for user_id, ext_id, ext_dn in manager_refs:
        if not await resolve_manager(session, source, user_id, ext_id, ext_dn):
            report.unresolved_managers += 1
    await session.commit()

    if provider.capabilities.supports_pull_groups:
        actor_id = await _resolve_sync_actor(session, org_id)
        group_records: list[DirectoryGroup] = []
        group_ids: dict[str, UUID] = {}
        async for group_record in provider.fetch_groups():
            group_ids[group_record.external_id] = await upsert_group(
                session, source, group_record, created_by_user_id=actor_id, report=report
            )
            group_records.append(group_record)
        await session.commit()

        for group_record in group_records:
            group_id = group_ids[group_record.external_id]
            group = (await session.execute(select(Group).where(Group.id == group_id))).scalar_one()
            if group_record.parent_external_id:
                parent_id = group_ids.get(group_record.parent_external_id)
                if parent_id and parent_id != group_id:
                    group.parent_group_id = parent_id
            if group_record.lead_external_id:
                lead_link = await _get_link(
                    session, source, SubjectType.USER, group_record.lead_external_id
                )
                if lead_link:
                    group.lead_user_id = lead_link.subject_id

            member_ids: set[UUID] = set()
            for member_ext in group_record.member_external_ids:
                member_link = await _get_link(session, source, SubjectType.USER, member_ext)
                if member_link:
                    member_ids.add(member_link.subject_id)
            added, removed = await apply_group_membership(session, group_id, member_ids)
            report.memberships_added += added
            report.memberships_removed += removed
            touched.update(member_ids)
        await session.commit()

        # After rosters and parent edges are final: synced TEAMs get their
        # search doc refreshed; groups the feed demoted to ACCESS tombstone.
        await TeamSearchIndexer(session, search_indexer).sync_teams(
            org_id,
            list(group_ids.values()),
        )

    if provider.capabilities.supports_pull_users:
        await _deprovision_pass(session, source, search_indexer, seen_active, report)

    touched_list = list(touched)
    for start in range(0, len(touched_list), CHUNK_SIZE):
        await sync_people_search(
            session,
            search_indexer,
            org_id,
            touched_list[start : start + CHUNK_SIZE],
        )
    await invalidate_org_people(org_id)

    report.elapsed_seconds = round(time.monotonic() - started, 3)
    source.last_sync_at = datetime.now(UTC)
    source.last_sync_status = "aborted" if report.aborted else "succeeded"
    await write_audit_event(
        session,
        organization_id=org_id,
        actor_user_id=None,
        action=Action.IDENTITY_SYNC_COMPLETED,
        resource_type=AuditResourceType.IDENTITY_SOURCE,
        resource_id=source.id,
        details=report.as_dict(),
    )
    await session.commit()
    logger.info(f"directory sync {source.id} finished: {report.as_dict()}")
    return report
