"""Reconcile PostgreSQL call state with SFU truth after missed webhooks."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config
from uniffy.domains.calls.livekit import (
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
    try:
        client = get_livekit_admin_client()
        async with open_session() as session:
            result = await session.execute(
                select(Call).where(Call.ended_at.is_(None)).order_by(Call.id)
            )
            active_calls = list(result.scalars().all())

            # Unreachable media is a property of the pass, not of one call, so the
            # first failure stops us asking again rather than paying a timeout per
            # call. The loop continues regardless: ending an overlong call is a
            # clock comparison that needs no roster, and abandoning the pass is
            # what used to leave those calls running for the length of an outage.
            media_reachable = True

            for call in active_calls:
                ops = CallOperations(session)
                now = datetime.now(UTC)

                max_minutes = DEFAULT_MAX_DURATION_MINUTES
                policy = await ops.get_org_policy(call.organization_id)
                if policy is not None:
                    max_minutes = policy.max_duration_minutes
                if call.started_at < now - timedelta(minutes=max_minutes):
                    if await ops.end_call_internal(call, CallEndReason.MAX_DURATION):
                        ended += 1
                    continue

                if not media_reachable:
                    continue

                try:
                    live = await client.list_participants(call.livekit_room_name)
                    live_identities = {p.get("identity", "") for p in live}
                except LiveKitUnavailableError:
                    media_reachable = False
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

                db_active = {r.identity for r in await ops.list_active_participants(call.id)}
                await session.commit()  # no open transaction across the LiveKit remove HTTP
                for entry in live:
                    identity = entry.get("identity", "")
                    if not identity or identity in db_active:
                        continue
                    try:
                        await client.remove_participant(call.livekit_room_name, identity)
                    except LiveKitApiError as exc:
                        if exc.status_code != 404:
                            logger.warning(f"reconcile orphan remove failed for {identity}: {exc}")

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
            "media_reachable": media_reachable,
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

    closed = 0
    try:
        client = get_livekit_admin_client()
        rooms = await client.list_rooms()
        async with open_session() as session:
            for room in rooms:
                name = room.get("name", "")
                call_id = parse_room_call_id(name)
                if call_id is None:
                    continue
                result = await session.execute(
                    select(Call.id).where(Call.id == call_id, Call.ended_at.is_(None))
                )
                if result.scalar_one_or_none() is not None:
                    continue
                try:
                    await client.delete_room(name)
                    closed += 1
                except LiveKitApiError as exc:
                    if exc.status_code != 404:
                        logger.warning(f"orphan room delete failed for {name}: {exc}")

        return {"status": "success", "closed": closed}
    except LiveKitUnavailableError:
        return {"status": "skipped", "reason": "livekit_unavailable"}
    except Exception as exc:
        logger.exception(f"cleanup_orphan_call_rooms failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(_ORPHAN_LOCK, lock_token)
