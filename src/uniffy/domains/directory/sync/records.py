from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.emails import normalize_email
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentityLink, IdentitySource
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.directory.groups.naming import dedupe_name, resolve_slug
from uniffy.domains.directory.sync.types import (
    DirectoryGroup,
    DirectoryUser,
    ReconcileReport,
)
from uniffy.domains.organizations.operations import (
    OrganizationOperations,
    StagedOrganizationMembership,
)

logger = logger.bind(component="directory.sync.records")

CHUNK_SIZE = 500

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
    parts = [part for part in (record.given_name, record.family_name) if part]
    return " ".join(parts) if parts else record.user_name


def record_profile_fields(record: DirectoryUser) -> dict[str, str]:
    fields: dict[str, str] = {}
    for name in SYNCED_PROFILE_FIELDS:
        value = getattr(record, name)
        if value is not None:
            fields[name] = value
    return fields


async def dedupe_username(session: AsyncSession, base: str) -> str:
    base = (base or "user")[:240]
    candidate = base
    suffix = 1
    while True:
        existing = await session.execute(select(User.id).where(User.username == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        suffix += 1
        candidate = f"{base}{suffix}"


async def get_identity_link(
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
    session: AsyncSession,
    source: IdentitySource,
    external_id: str,
) -> User | None:
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
    session: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
    record: DirectoryUser,
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
    statement = pg_insert(PeopleProfile).values(**values)
    await session.execute(
        statement.on_conflict_do_update(
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
    staged_memberships: list[StagedOrganizationMembership],
) -> UUID | None:
    org_id = source.organization_id
    link = await get_identity_link(session, source, SubjectType.USER, record.external_id)

    user: User | None = None
    if link is not None:
        result = await session.execute(select(User).where(User.id == link.subject_id))
        user = result.scalar_one_or_none()
        if user is None:
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
            logger.warning(
                f"directory sync: record {record.external_id} has no email; cannot create"
            )
            report.users_skipped += 1
            return None
        user = User(
            email=normalize_email(record.email),
            username=await dedupe_username(session, record.user_name),
            full_name=record_display_name(record),
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
        organization = OrganizationOperations(session)
        membership = await organization.get_membership(user.id, org_id)
        if membership is None or not membership.is_active:
            staged_memberships.append(await organization.stage_member(user.id, org_id))

    await _write_profile(session, org_id, user.id, record)
    return user.id


async def resolve_manager(
    session: AsyncSession,
    source: IdentitySource,
    user_id: UUID,
    manager_external_id: str | None,
    manager_external_dn: str | None,
) -> bool:
    manager_id: UUID | None = None
    if manager_external_id:
        link = await get_identity_link(
            session,
            source,
            SubjectType.USER,
            manager_external_id,
        )
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
    link = await get_identity_link(session, source, SubjectType.GROUP, record.external_id)

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
            is_private=False,
            created_by_user_id=created_by_user_id,
            managed_fields=["name", "kind"],
        )
        session.add(group)
        await session.flush()
        report.groups_created += 1
    else:
        desired = await dedupe_name(
            session,
            org_id,
            record.display_name,
            exclude_group_id=group.id,
        )
        if desired != group.name or group.kind != record.kind:
            if desired != group.name:
                if desired != record.display_name:
                    report.groups_renamed += 1
                group.name = desired
                group.slug = await resolve_slug(
                    session,
                    org_id,
                    desired,
                    exclude_group_id=group.id,
                )
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
    session: AsyncSession,
    group_id: UUID,
    member_user_ids: set[UUID],
) -> tuple[int, int]:
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
            statement = pg_insert(GroupMember).values(rows[start : start + CHUNK_SIZE])
            result = await session.execute(
                statement.on_conflict_do_update(
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
