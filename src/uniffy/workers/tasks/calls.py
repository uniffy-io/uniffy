"""Calls reconciliation crons: DB state converges to SFU truth.

Webhooks are the fast path; these sweeps are the backstop for missed
deliveries (backend restart, LiveKit redelivery exhaustion). Everything here
is idempotent - `mark_participant_left` / `end_call_internal` no-op on rows
already settled.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config
from uniffy.domains.calls.livekit_client import (
    LiveKitApiError,
    LiveKitUnavailableError,
    get_livekit_admin_client,
)
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import parse_room_call_id

logger = logger.bind(component="tasks.calls")

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
_LOCK_TTL_SECONDS = 240


async def _acquire_lock(key: str) -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(key, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning(f"calls task lock SET NX failed for {key}")
        return False


async def _release_lock(key: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(key)
    except Exception:
        logger.warning(f"calls task lock DEL failed for {key}")


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
    if not await _acquire_lock(_RECONCILE_LOCK):
        return {"status": "skipped", "reason": "lock_held"}

    ended = 0
    ghosts = 0
    try:
        client = get_livekit_admin_client()
        async with open_session() as session:
            result = await session.execute(select(Call).where(Call.ended_at.is_(None)))
            active_calls = list(result.scalars().all())

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

                try:
                    live = await client.list_participants(call.livekit_room_name)
                    live_identities = {p.get("identity", "") for p in live}
                except LiveKitUnavailableError:
                    break
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

        return {"status": "success", "ended": ended, "ghost_participants": ghosts}
    except Exception as exc:
        logger.exception(f"reconcile_calls failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(_RECONCILE_LOCK)


async def cleanup_orphan_call_rooms(ctx: dict[str, Any]) -> dict[str, Any]:
    """Hourly: close LiveKit rooms whose Call row is gone or already ended."""
    del ctx
    if not _livekit_ready():
        return {"status": "skipped", "reason": "livekit_not_configured"}
    if not await _acquire_lock(_ORPHAN_LOCK):
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
        await _release_lock(_ORPHAN_LOCK)
