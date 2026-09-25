from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.rooms.v1.rooms_pb import (
    CreateRoomRequest,
    CreateRoomResponse,
    DeleteRoomRequest,
    DeleteRoomResponse,
    GetRoomRequest,
    GetRoomResponse,
    ListRoomsRequest,
    ListRoomsResponse,
    UpdateRoomRequest,
    UpdateRoomResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.scheduling.rooms.converters import (
    room_status_from_proto,
    room_to_proto,
    room_type_from_proto,
)
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations
from uniffy.domains.scheduling.rooms.rpc.support import (
    map_domain_error,
    parse_uuid,
    resolve_room_effective_policy,
)
from uniffy.infrastructure.database import open_session


class RoomHandlers:
    search_indexer: SearchIndexer

    async def create_room(
        self,
        request: CreateRoomRequest,
        ctx: RequestContext,
    ) -> CreateRoomResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        group_ids = None
        if request.group_ids:
            group_ids = [parse_uuid(gid, "group_id") for gid in request.group_ids]

        image_file_id = None
        if request.has_field("image_file_id"):
            image_file_id = parse_uuid(request.image_file_id, "image_file_id")

        kwargs: dict = {
            "user_id": user_id,
            "organization_id": organization_id,
            "name": request.name,
            "room_type": room_type_from_proto(request.room_type),
            "capacity": request.capacity,
            "access_mode": access_mode,
            "baseline_role": baseline_role,
        }

        if request.has_field("description"):
            kwargs["description"] = request.description
        if request.has_field("floor"):
            kwargs["floor"] = request.floor
        if request.has_field("building"):
            kwargs["building"] = request.building
        if request.has_field("location"):
            kwargs["location"] = request.location
        if request.amenities:
            kwargs["amenities"] = list(request.amenities)
        if image_file_id is not None:
            kwargs["image_file_id"] = image_file_id
        if group_ids is not None:
            kwargs["group_ids"] = group_ids

        try:
            async with open_session() as session:
                ops = RoomOperations(session, self.search_indexer)
                room = await ops.create_room(**kwargs)
                eff_mode, eff_baseline = await resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                user_role = await ops._resolve_role(user_id, organization_id, room)
                return CreateRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_room", exc) from exc

    async def get_room(
        self,
        request: GetRoomRequest,
        ctx: RequestContext,
    ) -> GetRoomResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                room = await ops.get_by_id(user_id, organization_id, room_id)
                eff_mode, eff_baseline = await resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                user_role = await ops._resolve_role(user_id, organization_id, room)
                return GetRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_room", exc) from exc

    async def update_room(
        self,
        request: UpdateRoomRequest,
        ctx: RequestContext,
    ) -> UpdateRoomResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id")

        kwargs: dict = {}
        if request.has_field("name"):
            kwargs["name"] = request.name
        if request.has_field("description"):
            kwargs["description"] = request.description
        if request.has_field("room_type"):
            kwargs["room_type"] = room_type_from_proto(request.room_type)
        if request.has_field("status"):
            kwargs["status"] = room_status_from_proto(request.status)
        if request.has_field("capacity"):
            kwargs["capacity"] = request.capacity
        if request.has_field("floor"):
            kwargs["floor"] = request.floor
        if request.has_field("building"):
            kwargs["building"] = request.building
        if request.has_field("location"):
            kwargs["location"] = request.location
        if request.has_field("image_file_id"):
            kwargs["image_file_id"] = parse_uuid(request.image_file_id, "image_file_id")
        if request.replace_amenities:
            kwargs["amenities"] = list(request.amenities)

        try:
            async with open_session() as session:
                ops = RoomOperations(session, self.search_indexer)
                room = await ops.update_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    **kwargs,
                )
                eff_mode, eff_baseline = await resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                user_role = await ops._resolve_role(user_id, organization_id, room)
                return UpdateRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_room", exc) from exc

    async def delete_room(
        self,
        request: DeleteRoomRequest,
        ctx: RequestContext,
    ) -> DeleteRoomResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                ops = RoomOperations(session, self.search_indexer)
                await ops.delete_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    permanent=request.permanent,
                )
                message = "Room permanently deleted" if request.permanent else "Room deleted"
                return DeleteRoomResponse(success=True, message=message)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_room", exc) from exc

    async def list_rooms(
        self,
        request: ListRoomsRequest,
        ctx: RequestContext,
    ) -> ListRoomsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        room_type = None
        if request.has_field("room_type"):
            room_type = room_type_from_proto(request.room_type)

        status = None
        if request.has_field("status"):
            status = room_status_from_proto(request.status)

        min_capacity = request.min_capacity if request.has_field("min_capacity") else None
        building = request.building if request.has_field("building") else None
        floor = request.floor if request.has_field("floor") else None
        search_query = request.search_query if request.has_field("search_query") else None

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                rooms, total = await ops.list_rooms(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_type=room_type,
                    status=status,
                    min_capacity=min_capacity,
                    amenities=list(request.amenities) if request.amenities else None,
                    building=building,
                    floor=floor,
                    search_query=search_query,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                )

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.ROOM,
                )
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[ResourceKey(ContentType.ROOM, r.id) for r in rooms],
                )
                proto_rooms = []
                for r in rooms:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        r.access_mode,
                        r.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_rooms.append(
                        room_to_proto(
                            r,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                            user_role=decisions[ResourceKey(ContentType.ROOM, r.id)].role,
                        )
                    )

                return ListRoomsResponse(
                    rooms=proto_rooms,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_rooms", exc) from exc
