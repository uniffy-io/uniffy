"""Reconcile PostgreSQL call state with SFU truth after missed webhooks."""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.calls.admission import MediaAdmission, matches_media_session
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.domains.calls.livekit import (
    LiveKitAdminClient,
    LiveKitApiError,
    LiveKitUnavailableError,
    get_livekit_admin_client,
)
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import parse_room_call_id
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="calls.jobs.jobs")

# Participants younger than this are skipped - they may still be connecting.
JOIN_GRACE_SECONDS = 60
SOLO_AUTO_END_MINUTES = 5
# A row must be absent from the SFU across two consecutive reconcile passes
# before it is retired. Kept below the 5-min cron cadence so the second pass
# always sees an older missing_since; an SFU restart inside one window records
# absence instead of mass-evicting still-connected clients.
ABSENCE_CONFIRM_SECONDS = 60
DEFAULT_MAX_DURATION_MINUTES = 480

_RECONCILE_LOCK = "calls_reconcile:lock"
_ORPHAN_LOCK = "calls_orphan_cleanup:lock"
CALL_MAINTENANCE_JOB_TIMEOUT_SECONDS = 300
ROOM_LOOKUP_BATCH_SIZE = 500
_LOCK_TTL_SECONDS = CALL_MAINTENANCE_JOB_TIMEOUT_SECONDS + 30


async def _acquire_lock(key: str) -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, key, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning(f"calls job lock SET NX failed for {key}")
        return None


async def _release_lock(key: str, token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, key, token)
    except Exception:
        logger.warning(f"calls job lock release failed for {key}")


def _livekit_ready() -> bool:
    try:
        get_livekit_config()
        return True
    except LiveKitConfigError:
        return False


async def _organization_end_reason(session: AsyncSession, call: Call) -> CallEndReason | None:
    row = (
        await session.execute(
            select(Organization.is_suspended, Organization.deleted_at).where(
                Organization.id == call.organization_id
            )
        )
    ).one_or_none()
    if row is None:
        return None
    if row.deleted_at is not None:
        return CallEndReason.ORG_DELETED
    if row.is_suspended:
        return CallEndReason.ORG_SUSPENDED
    return None


async def _evict_revoked_participants(session: AsyncSession, ops: CallOperations, call: Call) -> int:
    """Backstop for inline eviction; a revoked session drops only the devices on it."""
    rows = await session.execute(
        select(
            CallParticipant.user_id,
            CallParticipant.auth_session_id,
            User.is_active,
            OrganizationMember.id,
            OrganizationMember.is_active,
            UserSession.is_revoked,
        )
        .select_from(CallParticipant)
        .join(User, User.id == CallParticipant.user_id)
        .outerjoin(
            OrganizationMember,
            (OrganizationMember.user_id == CallParticipant.user_id)
            & (OrganizationMember.organization_id == call.organization_id),
        )
        .outerjoin(UserSession, UserSession.id == CallParticipant.auth_session_id)
        .where(
            CallParticipant.call_id == call.id,
            CallParticipant.left_at.is_(None),
            or_(
                User.is_active.is_(False),
                OrganizationMember.id.is_(None),
                OrganizationMember.is_active.is_(False),
                UserSession.is_revoked.is_(True),
            ),
        )
    )
    user_reasons: dict[UUID, CallEvictionReason] = {}
    revoked_sessions: dict[UUID, set[UUID]] = {}
    for user_id, session_id, user_active, member_id, member_active, _ in rows.all():
        if not user_active:
            user_reasons[user_id] = CallEvictionReason.USER_DEACTIVATED
        elif member_id is None or not member_active:
            user_reasons.setdefault(user_id, CallEvictionReason.MEMBERSHIP_REVOKED)
        elif session_id is not None:
            revoked_sessions.setdefault(user_id, set()).add(session_id)

    evicted = 0
    for user_id, reason in user_reasons.items():
        evicted += await ops.evict_user(user_id, reason=reason, organization_id=call.organization_id)
    for user_id, session_ids in revoked_sessions.items():
        if user_id in user_reasons:
            continue
        evicted += await ops.evict_user(
            user_id,
            reason=CallEvictionReason.SESSION_REVOKED,
            organization_id=call.organization_id,
            session_ids=sorted(session_ids),
        )
    return evicted


async def reconcile_calls(ctx: dict[str, Any]) -> dict[str, Any]:
    """Every 5 min: drop ghost participants, enforce duration/solo policies."""
    del ctx
    if not _livekit_ready():
        return {"status": "skipped", "reason": "livekit_not_configured"}
    lock_token = await _acquire_lock(_RECONCILE_LOCK)
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held"}

    ended = 0
    ghosts = 0
    revoked = 0
    closed_rooms = 0
    try:
        client = get_livekit_admin_client()
        with client.stop_after_unavailable() as media:
            async with open_session() as session:
                result = await session.execute(
                    select(Call).where(Call.ended_at.is_(None)).order_by(Call.id)
                )
                active_calls = list(result.scalars().all())
                await session.commit()
                with suppress(LiveKitUnavailableError):
                    closed_rooms = await _cleanup_orphan_rooms(session, client)

                for call in active_calls:
                    ops = CallOperations(session)
                    now = datetime.now(UTC)

                    org_end_reason = await _organization_end_reason(session, call)
                    if org_end_reason is not None:
                        if await ops.end_call_internal(call, org_end_reason):
                            ended += 1
                        continue
                    revoked += await _evict_revoked_participants(session, ops, call)
                    if call.ended_at is not None:
                        ended += 1
                        continue

                    max_minutes = DEFAULT_MAX_DURATION_MINUTES
                    policy = await ops.get_org_policy(call.organization_id)
                    if policy is not None:
                        max_minutes = policy.max_duration_minutes
                    if call.started_at < now - timedelta(minutes=max_minutes):
                        if await ops.end_call_internal(call, CallEndReason.MAX_DURATION):
                            ended += 1
                        continue

                    if not media.reachable:
                        continue

                    try:
                        live = await client.list_participants(call.livekit_room_name)
                        live_identities = {p.get("identity", "") for p in live}
                    except LiveKitUnavailableError:
                        continue
                    except LiveKitApiError as exc:
                        if exc.status_code == 404:
                            live, live_identities = [], set()
                        else:
                            logger.warning(f"reconcile list_participants failed: {exc}")
                            continue

                    grace_cutoff = now - timedelta(seconds=JOIN_GRACE_SECONDS)
                    absence_cutoff = now - timedelta(seconds=ABSENCE_CONFIRM_SECONDS)
                    for participant in await ops.list_active_participants(call.id):
                        if participant.identity in live_identities:
                            if participant.missing_since is not None:
                                await ops.clear_absence(participant)
                            continue
                        if participant.joined_at > grace_cutoff:
                            continue
                        if participant.missing_since is None:
                            await ops.record_absence(participant, now)
                            continue
                        if participant.missing_since < absence_cutoff:
                            if await ops.retire_ghost_participant(call, participant, absence_cutoff):
                                ghosts += 1

                    if call.ended_at is not None:
                        ended += 1
                        continue

                    db_active = {r.identity: r for r in await ops.list_active_participants(call.id)}
                    await session.commit()  # no open transaction across the LiveKit remove HTTP
                    for entry in live:
                        identity = entry.get("identity", "")
                        participant = db_active.get(identity)
                        if not identity or (
                            participant is not None
                            and matches_media_session(
                                entry, participant.token_jti, participant.session_jti
                            )
                        ):
                            continue
                        try:
                            await MediaAdmission(session, client).evict_if_unauthorized(
                                call.id, call.livekit_room_name, identity
                            )
                        except LiveKitApiError as exc:
                            if exc.status_code != 404:
                                logger.warning(
                                    f"reconcile orphan remove failed for {identity}: {exc}"
                                )

                    remaining = await ops.list_active_participants(call.id)
                    if not remaining:
                        if call.started_at < now - timedelta(seconds=JOIN_GRACE_SECONDS):
                            if await ops.end_call_internal(call, CallEndReason.ALL_LEFT):
                                ended += 1
                        continue

                    await ops.reassign_host_if_absent(call)

                    if len(remaining) == 1:
                        others_left = await session.execute(
                            select(func.max(CallParticipant.left_at)).where(
                                CallParticipant.call_id == call.id,
                                CallParticipant.left_at.is_not(None),
                            )
                        )
                        solo_since = others_left.scalar_one_or_none() or call.started_at
                        if solo_since < now - timedelta(minutes=SOLO_AUTO_END_MINUTES):
                            if await ops.end_call_internal(call, CallEndReason.SOLO_TIMEOUT):
                                ended += 1

        return {
            "status": "success",
            "ended": ended,
            "ghost_participants": ghosts,
            "revoked_participants": revoked,
            "closed_rooms": closed_rooms,
            "media_reachable": media.reachable,
        }
    except Exception as exc:
        logger.exception(f"reconcile_calls failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(_RECONCILE_LOCK, lock_token)


async def cleanup_orphan_call_rooms(ctx: dict[str, Any]) -> dict[str, Any]:
    """Hourly: close LiveKit rooms whose Call row is gone or already ended."""
    del ctx
    if not _livekit_ready():
        return {"status": "skipped", "reason": "livekit_not_configured"}
    lock_token = await _acquire_lock(_ORPHAN_LOCK)
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held"}

    try:
        client = get_livekit_admin_client()
        with client.stop_after_unavailable():
            async with open_session() as session:
                closed = await _cleanup_orphan_rooms(session, client)

        return {"status": "success", "closed": closed}
    except LiveKitUnavailableError:
        return {"status": "skipped", "reason": "livekit_unavailable"}
    except Exception as exc:
        logger.exception(f"cleanup_orphan_call_rooms failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(_ORPHAN_LOCK, lock_token)


async def _cleanup_orphan_rooms(session: AsyncSession, client: LiveKitAdminClient) -> int:
    rooms = await client.list_rooms()
    names = [room["name"] for room in rooms if parse_room_call_id(room.get("name", "")) is not None]
    closed = 0
    for start in range(0, len(names), ROOM_LOOKUP_BATCH_SIZE):
        batch = names[start : start + ROOM_LOOKUP_BATCH_SIZE]
        # Read after the SFU snapshot so a concurrent valid join cannot look orphaned.
        rows = await session.scalars(
            select(Call.livekit_room_name).where(
                Call.livekit_room_name.in_(batch), Call.ended_at.is_(None)
            )
        )
        active = set(rows.all())
        await session.commit()
        for name in batch:
            if name in active:
                continue
            try:
                await client.delete_room(name)
                closed += 1
            except LiveKitUnavailableError:
                raise
            except LiveKitApiError as exc:
                if exc.status_code != 404:
                    logger.warning(f"orphan room delete failed for {name}: {exc}")
    return closed
