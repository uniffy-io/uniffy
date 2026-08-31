"""Seed bookable rooms for the demo offices."""

from __future__ import annotations

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, ContentRole, RoomType
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult
from uniffy.scripts.demo_company.loader import RoomSpec
from uniffy.scripts.demo_company.mentions import ROOM, MentionRegistry

logger = logger.bind(component="scripts.demo_company.rooms")


async def seed_rooms(
    ctx: DemoContext,
    rooms: tuple[RoomSpec, ...],
    registry: MentionRegistry,
) -> DomainResult:
    result = DomainResult()
    if not rooms:
        return result

    ops = RoomOperations(ctx.session)
    existing_ids = {
        row.name: row.id
        for row in (
            await ctx.session.execute(
                select(Room.name, Room.id).where(
                    Room.organization_id == ctx.organization_id,
                    Room.is_deleted == False,  # noqa: E712
                )
            )
        ).all()
    }

    for spec in rooms:
        if spec.name in existing_ids:
            registry.register(ROOM, spec.name, existing_ids[spec.name])
            result.skipped += 1
            continue

        if ctx.dry_run:
            logger.info(f"[dry-run] room {spec.name!r} ({spec.building})")
            result.created += 1
            continue

        room = await ops.create_room(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            name=spec.name,
            description=spec.description,
            room_type=RoomType(spec.room_type),
            capacity=spec.capacity,
            floor=spec.floor,
            building=spec.building,
            location=spec.location,
            amenities=list(spec.amenities),
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        registry.register(ROOM, spec.name, room.id)
        result.created += 1
        logger.info(f"Created room {spec.name!r}")

    return result
