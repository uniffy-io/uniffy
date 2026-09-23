import time
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentityLink, IdentitySource
from uniffy.core.search import SearchIndexer
from uniffy.core.types import SubjectType
from uniffy.domains.calls.lifecycle import CallEvictionReason, CallRevocationLifecycle
from uniffy.domains.directory.groups.projection import TeamSearchIndexer
from uniffy.domains.directory.projection import (
    UserDirectoryProjection,
    invalidate_directory,
    invalidate_person,
    sync_people_search,
)
from uniffy.domains.directory.sync.base import DirectorySyncProvider
from uniffy.domains.directory.sync.records import (
    CHUNK_SIZE,
    apply_group_membership,
    get_identity_link,
    resolve_manager,
    upsert_group,
    upsert_user,
)
from uniffy.domains.directory.sync.types import DirectoryGroup, DirectoryUser, ReconcileReport
from uniffy.domains.organizations.operations import (
    OrganizationOperations,
    StagedOrganizationMembership,
)

logger = logger.bind(component="directory.sync.reconcile")

MAX_DEPROVISION_RATIO = 0.2


async def deprovision_user(
    session: AsyncSession,
    source: IdentitySource,
    user_id: UUID,
    search_indexer: SearchIndexer,
    call_lifecycle: CallRevocationLifecycle,
    *,
    active_owner_ids: set[UUID],
) -> bool:
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
    await UserDirectoryProjection(session, search_indexer).remove_from_organization(
        user_id,
        org_id,
    )
    await publish_mention_state(org_id, urn, {"urn_status": "DELETED"})
    await call_lifecycle.evict_user(
        session,
        user_id,
        reason=CallEvictionReason.MEMBERSHIP_REVOKED,
        organization_id=org_id,
    )
    return True


async def provision_from_login(
    session: AsyncSession,
    source: IdentitySource,
    record: DirectoryUser,
    search_indexer: SearchIndexer,
) -> User:
    report = ReconcileReport()
    staged_memberships: list[StagedOrganizationMembership] = []
    user_id = await upsert_user(
        session,
        source,
        record,
        report=report,
        staged_memberships=staged_memberships,
    )
    if user_id is None:
        raise ValidationError("record", "record cannot be provisioned")
    await session.commit()
    await _finish_membership_effects(session, staged_memberships)
    await invalidate_person(source.organization_id, user_id)
    await sync_people_search(session, search_indexer, source.organization_id, [user_id])
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one()


async def _resolve_sync_actor(session: AsyncSession, organization_id: UUID) -> UUID:
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


async def _finish_membership_effects(
    session: AsyncSession,
    staged_memberships: list[StagedOrganizationMembership],
) -> None:
    operations = OrganizationOperations(session)
    for staged in staged_memberships:
        await operations.finish_member_add_cache_after_commit(staged)
    staged_memberships.clear()


async def _deprovision_pass(
    session: AsyncSession,
    source: IdentitySource,
    search_indexer: SearchIndexer,
    call_lifecycle: CallRevocationLifecycle,
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
            call_lifecycle,
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
    call_lifecycle: CallRevocationLifecycle,
) -> ReconcileReport:
    started = time.monotonic()
    report = ReconcileReport()
    org_id = source.organization_id

    source.last_sync_status = "running"
    source.last_sync_error = None
    await session.commit()

    touched: set[UUID] = set()
    seen_active: set[str] = set()
    manager_refs: list[tuple[UUID, str | None, str | None]] = []
    staged_memberships: list[StagedOrganizationMembership] = []

    processed = 0
    async for record in provider.fetch_users():
        user_id = await upsert_user(
            session,
            source,
            record,
            report=report,
            staged_memberships=staged_memberships,
        )
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
            await _finish_membership_effects(session, staged_memberships)
    await session.commit()
    await _finish_membership_effects(session, staged_memberships)

    for user_id, external_id, external_dn in manager_refs:
        if not await resolve_manager(
            session,
            source,
            user_id,
            external_id,
            external_dn,
        ):
            report.unresolved_managers += 1
    await session.commit()

    if provider.capabilities.supports_pull_groups:
        actor_id = await _resolve_sync_actor(session, org_id)
        group_records: list[DirectoryGroup] = []
        group_ids: dict[str, UUID] = {}
        async for group_record in provider.fetch_groups():
            group_ids[group_record.external_id] = await upsert_group(
                session,
                source,
                group_record,
                created_by_user_id=actor_id,
                report=report,
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
                lead_link = await get_identity_link(
                    session,
                    source,
                    SubjectType.USER,
                    group_record.lead_external_id,
                )
                if lead_link:
                    group.lead_user_id = lead_link.subject_id

            member_ids: set[UUID] = set()
            for member_external_id in group_record.member_external_ids:
                member_link = await get_identity_link(
                    session,
                    source,
                    SubjectType.USER,
                    member_external_id,
                )
                if member_link:
                    member_ids.add(member_link.subject_id)
            added, removed = await apply_group_membership(session, group_id, member_ids)
            report.memberships_added += added
            report.memberships_removed += removed
            touched.update(member_ids)
        await session.commit()

        await TeamSearchIndexer(session, search_indexer).sync_teams(
            org_id,
            list(group_ids.values()),
        )

    if provider.capabilities.supports_pull_users:
        await _deprovision_pass(session, source, search_indexer, call_lifecycle, seen_active, report)

    touched_list = list(touched)
    for start in range(0, len(touched_list), CHUNK_SIZE):
        await sync_people_search(
            session,
            search_indexer,
            org_id,
            touched_list[start : start + CHUNK_SIZE],
        )
    await invalidate_directory(org_id)

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
