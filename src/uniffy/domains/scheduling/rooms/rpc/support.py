from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, ContentRole, ContentType

logger = logger.bind(component="scheduling.rooms.rpc.support")


async def resolve_room_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    room: Room,
    checker: PermissionChecker | None = None,
) -> tuple[AccessMode, ContentRole | None]:
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.ROOM,
    )
    return resolve_effective_policy(
        room.access_mode,
        room.baseline_role,
        default_mode,
        default_baseline,
    )


def parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


async def load_booking_names(
    session: AsyncSession,
    room_id: UUID,
    booker_id: UUID,
) -> tuple[str, str]:
    room = (await session.execute(select(Room).where(Room.id == room_id))).scalar_one_or_none()
    room_name = room.name if room else ""
    user = (await session.execute(select(User).where(User.id == booker_id))).scalar_one_or_none()
    booker_name = (user.full_name or user.username) if user else ""
    return room_name, booker_name
