"""Notifications RPC handlers."""

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from sqlalchemy import select
from uniffy_proto.notifications.v1.notifications_pb2 import (
    AccessRequestChangedPayload,
    BulkDeleteNotificationsRequest,
    BulkDeleteNotificationsResponse,
    BulkMarkAsReadRequest,
    BulkMarkAsReadResponse,
    ContentAccessChangedPayload,
    DailyNotificationStat,
    DeleteNotificationRequest,
    DeleteNotificationResponse,
    FileUpdatePayload,
    GetNotificationStatsRequest,
    GetNotificationStatsResponse,
    GetUnreadCountRequest,
    GetUnreadCountResponse,
    GetVapidPublicKeyRequest,
    GetVapidPublicKeyResponse,
    ListNotificationsRequest,
    ListNotificationsResponse,
    MarkAllAsReadRequest,
    MarkAllAsReadResponse,
    MarkAsReadRequest,
    MarkAsReadResponse,
    MentionStateChangedPayload,
    PresenceChangedPayload,
    RegisterPushSubscriptionRequest,
    RegisterPushSubscriptionResponse,
    SearchNotificationsRequest,
    SearchNotificationsResponse,
    StreamNotificationsRequest,
    StreamNotificationsResponse,
    TypeNotificationStat,
    UnregisterPushSubscriptionRequest,
    UnregisterPushSubscriptionResponse,
)
from uniffy_proto.notifications.v1.notifications_pb2 import (
    Notification as ProtoNotification,
)

from uniffy.core.config.push import get_vapid_config
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.models.login.user import User
from uniffy.core.valkey import NotificationPayloadType, subscribe_channels
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.notifications.converters import (
    notification_to_proto,
    notification_type_from_proto,
    notification_type_to_proto,
)
from uniffy.domains.notifications.middleware import get_disconnect_event
from uniffy.domains.notifications.operations import (
    NotificationOperations,
    PushSubscriptionOperations,
)
from uniffy.domains.notifications.tag_relay import TagEventRelay

logger = logger.bind(component="notifications handler")


class NotificationsHandlers:
    """RPC handlers for notifications service."""

    async def list_notifications(
        self,
        request: ListNotificationsRequest,
        ctx: RequestContext,
    ) -> ListNotificationsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 20
        page_size = min(page_size, 100)

        is_read = None
        if request.HasField("is_read"):
            is_read = request.is_read

        notification_types = None
        if request.notification_types:
            notification_types = []
            for proto_type in request.notification_types:
                nt = notification_type_from_proto(proto_type)
                if nt:
                    notification_types.append(nt)

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                notifications, total_count, unread_count = await ops.list_notifications(
                    user_id=user_id,
                    organization_id=organization_id,
                    page=page,
                    page_size=page_size,
                    is_read=is_read,
                    notification_types=notification_types,
                )

                actor_ids = {n.actor_id for n in notifications if n.actor_id}
                actor_map: dict[UUID, str] = {}
                if actor_ids:
                    result = await session.execute(
                        select(User.id, User.full_name, User.username).where(User.id.in_(actor_ids))
                    )
                    for row in result.all():
                        actor_map[row[0]] = row[1] or row[2]

                return ListNotificationsResponse(
                    notifications=[
                        notification_to_proto(
                            n,
                            actor_name=actor_map.get(n.actor_id, "") if n.actor_id else "",
                        )
                        for n in notifications
                    ],
                    total_count=total_count,
                    unread_count=unread_count,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing notifications: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_unread_count(
        self,
        request: GetUnreadCountRequest,
        ctx: RequestContext,
    ) -> GetUnreadCountResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                count = await ops.get_unread_count(user_id, organization_id)
                return GetUnreadCountResponse(unread_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting unread count: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def mark_as_read(
        self,
        request: MarkAsReadRequest,
        ctx: RequestContext,
    ) -> MarkAsReadResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            notification_id = UUID(request.notification_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid notification_id format")

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                notification = await ops.mark_as_read(user_id, notification_id)

                if not notification:
                    raise ConnectError(Code.NOT_FOUND, "Notification not found")

                return MarkAsReadResponse(
                    notification=notification_to_proto(notification),
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error marking notification as read: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def mark_all_as_read(
        self,
        request: MarkAllAsReadRequest,
        ctx: RequestContext,
    ) -> MarkAllAsReadResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                count = await ops.mark_all_as_read(user_id, organization_id)
                return MarkAllAsReadResponse(updated_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error marking all as read: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_notification(
        self,
        request: DeleteNotificationRequest,
        ctx: RequestContext,
    ) -> DeleteNotificationResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            notification_id = UUID(request.notification_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid notification_id format")

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                deleted = await ops.delete_notification(user_id, notification_id)

                if not deleted:
                    raise ConnectError(Code.NOT_FOUND, "Notification not found")

                return DeleteNotificationResponse(success=True)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error deleting notification: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def register_push_subscription(
        self,
        request: RegisterPushSubscriptionRequest,
        ctx: RequestContext,
    ) -> RegisterPushSubscriptionResponse:
        user_id = get_user_id_from_context(ctx)

        if not request.endpoint:
            raise ConnectError(Code.INVALID_ARGUMENT, "Endpoint is required")
        if not request.p256dh_key:
            raise ConnectError(Code.INVALID_ARGUMENT, "p256dh_key is required")
        if not request.auth_key:
            raise ConnectError(Code.INVALID_ARGUMENT, "auth_key is required")

        try:
            async with open_session() as session:
                ops = PushSubscriptionOperations(session)
                subscription = await ops.register(
                    user_id=user_id,
                    endpoint=request.endpoint,
                    p256dh_key=request.p256dh_key,
                    auth_key=request.auth_key,
                    user_agent=request.user_agent or None,
                )
                return RegisterPushSubscriptionResponse(id=str(subscription.id))

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error registering push subscription: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def unregister_push_subscription(
        self,
        request: UnregisterPushSubscriptionRequest,
        ctx: RequestContext,
    ) -> UnregisterPushSubscriptionResponse:
        user_id = get_user_id_from_context(ctx)

        if not request.endpoint:
            raise ConnectError(Code.INVALID_ARGUMENT, "Endpoint is required")

        try:
            async with open_session() as session:
                ops = PushSubscriptionOperations(session)
                removed = await ops.unregister(user_id, request.endpoint)
                return UnregisterPushSubscriptionResponse(success=removed)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error unregistering push subscription: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_vapid_public_key(
        self,
        request: GetVapidPublicKeyRequest,
        ctx: RequestContext,
    ) -> GetVapidPublicKeyResponse:
        """Return the server's VAPID public key (no auth required for subscribe flow)."""
        config = get_vapid_config()
        if not config:
            raise ConnectError(
                Code.FAILED_PRECONDITION,
                "Push notifications are not configured on this server",
            )
        return GetVapidPublicKeyResponse(public_key=config.public_key)

    async def search_notifications(
        self,
        request: SearchNotificationsRequest,
        ctx: RequestContext,
    ) -> SearchNotificationsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 20
        page_size = min(page_size, 100)

        is_read = None
        if request.HasField("is_read"):
            is_read = request.is_read

        notification_types = None
        if request.notification_types:
            notification_types = []
            for proto_type in request.notification_types:
                nt = notification_type_from_proto(proto_type)
                if nt:
                    notification_types.append(nt)

        date_from = None
        if request.HasField("date_from"):
            date_from = timestamp_to_datetime(request.date_from)

        date_to = None
        if request.HasField("date_to"):
            date_to = timestamp_to_datetime(request.date_to)

        actor_id = None
        if request.actor_id:
            try:
                actor_id = UUID(request.actor_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid actor_id format")

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                notifications, total_count, unread_count = await ops.search_notifications(
                    user_id=user_id,
                    organization_id=organization_id,
                    query=request.query,
                    page=page,
                    page_size=page_size,
                    is_read=is_read,
                    notification_types=notification_types,
                    date_from=date_from,
                    date_to=date_to,
                    actor_id=actor_id,
                )

                actor_ids = {n.actor_id for n in notifications if n.actor_id}
                actor_map: dict[UUID, str] = {}
                if actor_ids:
                    result = await session.execute(
                        select(User.id, User.full_name, User.username).where(User.id.in_(actor_ids))
                    )
                    for row in result.all():
                        actor_map[row[0]] = row[1] or row[2]

                return SearchNotificationsResponse(
                    notifications=[
                        notification_to_proto(
                            n,
                            actor_name=actor_map.get(n.actor_id, "") if n.actor_id else "",
                        )
                        for n in notifications
                    ],
                    total_count=total_count,
                    unread_count=unread_count,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error searching notifications: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_notification_stats(
        self,
        request: GetNotificationStatsRequest,
        ctx: RequestContext,
    ) -> GetNotificationStatsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        days = request.days if request.days > 0 else 30
        days = min(days, 365)

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                (
                    daily_stats,
                    type_stats,
                    total_count,
                    unread_count,
                    read_count,
                ) = await ops.get_notification_stats(
                    user_id=user_id,
                    organization_id=organization_id,
                    days=days,
                )

                return GetNotificationStatsResponse(
                    daily_stats=[
                        DailyNotificationStat(
                            date=date_str,
                            total=total,
                            unread=unread,
                            read=read,
                        )
                        for date_str, total, unread, read in daily_stats
                    ],
                    type_stats=[
                        TypeNotificationStat(
                            notification_type=notification_type_to_proto(nt),
                            count=count,
                        )
                        for nt, count in type_stats
                    ],
                    total_count=total_count,
                    unread_count=unread_count,
                    read_count=read_count,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting notification stats: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_mark_as_read(
        self,
        request: BulkMarkAsReadRequest,
        ctx: RequestContext,
    ) -> BulkMarkAsReadResponse:
        user_id = get_user_id_from_context(ctx)

        notification_ids = []
        for nid in request.notification_ids:
            try:
                notification_ids.append(UUID(nid))
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid notification_id format: {nid}")

        if not notification_ids:
            return BulkMarkAsReadResponse(updated_count=0)

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                count = await ops.bulk_mark_as_read(user_id, notification_ids)
                return BulkMarkAsReadResponse(updated_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error bulk marking as read: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_delete_notifications(
        self,
        request: BulkDeleteNotificationsRequest,
        ctx: RequestContext,
    ) -> BulkDeleteNotificationsResponse:
        user_id = get_user_id_from_context(ctx)

        notification_ids = []
        for nid in request.notification_ids:
            try:
                notification_ids.append(UUID(nid))
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid notification_id format: {nid}")

        if not notification_ids:
            return BulkDeleteNotificationsResponse(deleted_count=0)

        try:
            async with open_session() as session:
                ops = NotificationOperations(session)
                count = await ops.bulk_delete_notifications(user_id, notification_ids)
                return BulkDeleteNotificationsResponse(deleted_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error bulk deleting notifications: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def stream_notifications(
        self,
        request: StreamNotificationsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamNotificationsResponse]:
        """Stream notification events plus periodic heartbeats for the user."""
        user_id = get_user_id_from_context(ctx)

        try:
            UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        logger.info(
            f"starting notification stream for user {user_id}",
            component="notifications handler",
        )
        heartbeat_interval = 30  # seconds
        disconnect = get_disconnect_event()

        organization_uuid = UUID(request.organization_id)
        relay = TagEventRelay(user_id, organization_uuid)

        try:
            async with aclosing(
                subscribe_channels(
                    f"notifications:{user_id}",
                    f"presence:{request.organization_id}",
                    f"mentions:{request.organization_id}",
                    f"tags:{request.organization_id}",
                    f"content:{request.organization_id}",
                )
            ) as subscriber:
                last_send = time.monotonic()

                async for payload in subscriber:
                    if disconnect and disconnect.is_set():
                        logger.info(
                            f"stream client disconnected, stopping for {user_id}",
                            component="notifications handler",
                        )
                        break

                    now = time.monotonic()

                    if payload is None:
                        # Poll timeout tick - send heartbeat if interval elapsed.
                        if now - last_send >= heartbeat_interval:
                            ts = Timestamp()
                            ts.FromDatetime(datetime.now(UTC))
                            yield StreamNotificationsResponse(
                                event_type=StreamNotificationsResponse.EVENT_TYPE_HEARTBEAT,
                                timestamp=ts,
                            )
                            last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.FILE_UPDATED:
                        yield StreamNotificationsResponse(
                            event_type=StreamNotificationsResponse.EVENT_TYPE_FILE_UPDATED,
                            file_update=FileUpdatePayload(
                                file_id=payload.get("file_id", ""),
                                organization_id=payload.get("organization_id", ""),
                            ),
                        )
                        last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.PRESENCE_CHANGED:
                        ts = Timestamp()
                        ts.FromDatetime(datetime.fromisoformat(payload["last_active"]))
                        presence_payload = PresenceChangedPayload(
                            user_id=payload.get("user_id", ""),
                            status=payload.get("status", ""),
                            last_active=ts,
                        )
                        custom = payload.get("custom_status")
                        if custom:
                            presence_payload.status_emoji = custom.get("emoji", "")
                            presence_payload.status_text = custom.get("text", "")
                            if custom.get("expires_at"):
                                exp_ts = Timestamp()
                                exp_ts.FromDatetime(datetime.fromisoformat(custom["expires_at"]))
                                presence_payload.status_expires_at.CopyFrom(exp_ts)
                        yield StreamNotificationsResponse(
                            event_type=StreamNotificationsResponse.EVENT_TYPE_PRESENCE_CHANGED,
                            presence_changed=presence_payload,
                        )
                        last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.PERMISSIONS_CHANGED:
                        yield StreamNotificationsResponse(
                            event_type=StreamNotificationsResponse.EVENT_TYPE_PERMISSIONS_CHANGED,
                        )
                        last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.CONTENT_ACCESS_CHANGED:
                        yield StreamNotificationsResponse(
                            event_type=StreamNotificationsResponse.EVENT_TYPE_CONTENT_ACCESS_CHANGED,
                            content_access_changed=ContentAccessChangedPayload(
                                content_type=payload.get("content_type", 0),
                                content_id=payload.get("content_id", ""),
                                action=payload.get("action", ""),
                            ),
                        )
                        last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.ACCESS_REQUEST_CHANGED:
                        changed = AccessRequestChangedPayload(
                            request_id=payload.get("request_id", ""),
                            requested_urn=payload.get("requested_urn", ""),
                            state=payload.get("state", 0),
                        )
                        if payload.get("can_request_again_at"):
                            retry_at = Timestamp()
                            retry_at.FromDatetime(
                                datetime.fromisoformat(payload["can_request_again_at"])
                            )
                            changed.can_request_again_at.CopyFrom(retry_at)
                        yield StreamNotificationsResponse(
                            event_type=(
                                StreamNotificationsResponse.EVENT_TYPE_ACCESS_REQUEST_CHANGED
                            ),
                            access_request_changed=changed,
                        )
                        last_send = now
                        continue

                    if payload.get("_type") == NotificationPayloadType.MENTION_STATE_CHANGED:
                        # Restricted content broadcasts org-wide but is only
                        # forwarded to recipients who can view it.
                        if payload.get("restricted") and not await relay.allows_mention_state(
                            payload
                        ):
                            continue
                        mention_payload = MentionStateChangedPayload(
                            urn=payload.get("urn", ""),
                            changes=payload.get("changes", {}),
                        )
                        yield StreamNotificationsResponse(
                            event_type=StreamNotificationsResponse.EVENT_TYPE_MENTION_STATE_CHANGED,
                            mention_state_changed=mention_payload,
                        )
                        last_send = now
                        continue

                    # Per-recipient filter; re-emitted as MENTION_STATE_CHANGED
                    # so the chip-state pipeline picks them up unchanged.
                    if payload.get("_type", "").startswith("tag."):
                        relayed = await relay.project(payload)
                        for changes in relayed:
                            urn = changes.pop("urn", "")
                            if not urn:
                                continue
                            yield StreamNotificationsResponse(
                                event_type=StreamNotificationsResponse.EVENT_TYPE_MENTION_STATE_CHANGED,
                                mention_state_changed=MentionStateChangedPayload(
                                    urn=urn,
                                    changes=changes,
                                ),
                            )
                            last_send = now
                        continue

                    logger.debug(
                        f"delivering notification {payload.get('id', '?')} to user {user_id}",
                        component="notifications handler",
                    )
                    proto_notification = ProtoNotification(
                        id=payload.get("id", ""),
                        organization_id=payload.get("organization_id", ""),
                        user_id=payload.get("user_id", ""),
                        notification_type=payload.get("notification_type", 0),
                        title=payload.get("title", ""),
                        body=payload.get("body", ""),
                        source_urn=payload.get("source_urn", ""),
                        actor_id=payload.get("actor_id", ""),
                        actor_name=payload.get("actor_name", ""),
                        is_read=False,
                        metadata=payload.get("metadata") or {},
                    )

                    if "created_at" in payload:  # noqa: PLR2004
                        ts = Timestamp()
                        ts.FromDatetime(datetime.fromisoformat(payload["created_at"]))
                        proto_notification.created_at.CopyFrom(ts)

                    yield StreamNotificationsResponse(
                        event_type=StreamNotificationsResponse.EVENT_TYPE_NEW_NOTIFICATION,
                        notification=proto_notification,
                    )
                    last_send = now

        except asyncio.CancelledError, GeneratorExit:
            logger.info(
                f"cancelled for user {user_id} (client disconnect)",
                component="notifications handler",
            )
        except Exception as e:
            if not isinstance(e, StopAsyncIteration):
                logger.exception(
                    f"error for user {user_id}: {e}",
                    component="notifications handler",
                )
        finally:
            logger.info(f"ended for user {user_id}", component="notifications handler")
