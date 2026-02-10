"""Notifications RPC handlers - thin layer delegating to operations."""

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

from uniffy.core.config.push import get_vapid_config
from uniffy.core.models.login.user import User
from uniffy.core.valkey import subscribe_user
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.notifications.converters import (
    notification_to_proto,
    notification_type_from_proto,
)
from uniffy.domains.notifications.middleware import get_disconnect_event
from uniffy.domains.notifications.operations import (
    NotificationOperations,
    PushSubscriptionOperations,
)
from uniffy.gen.notifications.v1.notifications_pb2 import (
    DeleteNotificationRequest,
    DeleteNotificationResponse,
    FileUpdatePayload,
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
    RegisterPushSubscriptionRequest,
    RegisterPushSubscriptionResponse,
    StreamNotificationEvent,
    StreamNotificationsRequest,
    UnregisterPushSubscriptionRequest,
    UnregisterPushSubscriptionResponse,
)
from uniffy.gen.notifications.v1.notifications_pb2 import (
    Notification as ProtoNotification,
)


class NotificationsHandlers:
    """RPC handlers for notifications service."""

    async def list_notifications(
        self,
        request: ListNotificationsRequest,
        ctx: RequestContext,
    ) -> ListNotificationsResponse:
        """
        Handle list_notifications RPC call.

        Parameters
        ----------
        request : ListNotificationsRequest
            The list request with filters and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListNotificationsResponse
            List of notifications with counts.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 20
        page_size = min(page_size, 100)

        # Parse optional is_read filter
        is_read = None
        if request.HasField("is_read"):
            is_read = request.is_read

        # Parse notification type filters
        notification_types = None
        if request.notification_types:
            notification_types = []
            for proto_type in request.notification_types:
                nt = notification_type_from_proto(proto_type)
                if nt:
                    notification_types.append(nt)

        try:
            async for session in get_async_session():
                ops = NotificationOperations(session)
                notifications, total_count, unread_count = await ops.list_notifications(
                    user_id=user_id,
                    organization_id=organization_id,
                    page=page,
                    page_size=page_size,
                    is_read=is_read,
                    notification_types=notification_types,
                )

                # Resolve actor display names
                actor_ids = {n.actor_id for n in notifications if n.actor_id}
                actor_map: dict[UUID, str] = {}
                if actor_ids:
                    result = await session.execute(
                        select(User.id, User.full_name, User.username).where(
                            User.id.in_(actor_ids)
                        )
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
            logger.error(f"Error listing notifications: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_unread_count(
        self,
        request: GetUnreadCountRequest,
        ctx: RequestContext,
    ) -> GetUnreadCountResponse:
        """
        Handle get_unread_count RPC call.

        Parameters
        ----------
        request : GetUnreadCountRequest
            The request with organization_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetUnreadCountResponse
            Unread count.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async for session in get_async_session():
                ops = NotificationOperations(session)
                count = await ops.get_unread_count(user_id, organization_id)
                return GetUnreadCountResponse(unread_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting unread count: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def mark_as_read(
        self,
        request: MarkAsReadRequest,
        ctx: RequestContext,
    ) -> MarkAsReadResponse:
        """
        Handle mark_as_read RPC call.

        Parameters
        ----------
        request : MarkAsReadRequest
            The request with notification_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        MarkAsReadResponse
            The updated notification.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            notification_id = UUID(request.notification_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid notification_id format")

        try:
            async for session in get_async_session():
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
            logger.error(f"Error marking notification as read: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def mark_all_as_read(
        self,
        request: MarkAllAsReadRequest,
        ctx: RequestContext,
    ) -> MarkAllAsReadResponse:
        """
        Handle mark_all_as_read RPC call.

        Parameters
        ----------
        request : MarkAllAsReadRequest
            The request with organization_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        MarkAllAsReadResponse
            Count of updated notifications.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async for session in get_async_session():
                ops = NotificationOperations(session)
                count = await ops.mark_all_as_read(user_id, organization_id)
                return MarkAllAsReadResponse(updated_count=count)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error marking all as read: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_notification(
        self,
        request: DeleteNotificationRequest,
        ctx: RequestContext,
    ) -> DeleteNotificationResponse:
        """
        Handle delete_notification RPC call.

        Parameters
        ----------
        request : DeleteNotificationRequest
            The request with notification_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteNotificationResponse
            Success flag.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            notification_id = UUID(request.notification_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid notification_id format")

        try:
            async for session in get_async_session():
                ops = NotificationOperations(session)
                deleted = await ops.delete_notification(user_id, notification_id)

                if not deleted:
                    raise ConnectError(Code.NOT_FOUND, "Notification not found")

                return DeleteNotificationResponse(success=True)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting notification: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def register_push_subscription(
        self,
        request: RegisterPushSubscriptionRequest,
        ctx: RequestContext,
    ) -> RegisterPushSubscriptionResponse:
        """
        Handle register_push_subscription RPC call.

        Parameters
        ----------
        request : RegisterPushSubscriptionRequest
            The push subscription details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        RegisterPushSubscriptionResponse
            The subscription ID.

        """
        user_id = get_user_id_from_context(ctx)

        if not request.endpoint:
            raise ConnectError(Code.INVALID_ARGUMENT, "Endpoint is required")
        if not request.p256dh_key:
            raise ConnectError(Code.INVALID_ARGUMENT, "p256dh_key is required")
        if not request.auth_key:
            raise ConnectError(Code.INVALID_ARGUMENT, "auth_key is required")

        try:
            async for session in get_async_session():
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
            logger.error(f"Error registering push subscription: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def unregister_push_subscription(
        self,
        request: UnregisterPushSubscriptionRequest,
        ctx: RequestContext,
    ) -> UnregisterPushSubscriptionResponse:
        """
        Handle unregister_push_subscription RPC call.

        Parameters
        ----------
        request : UnregisterPushSubscriptionRequest
            The endpoint to unregister.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        UnregisterPushSubscriptionResponse
            Success flag.

        """
        user_id = get_user_id_from_context(ctx)

        if not request.endpoint:
            raise ConnectError(Code.INVALID_ARGUMENT, "Endpoint is required")

        try:
            async for session in get_async_session():
                ops = PushSubscriptionOperations(session)
                removed = await ops.unregister(user_id, request.endpoint)
                return UnregisterPushSubscriptionResponse(success=removed)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error unregistering push subscription: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_vapid_public_key(
        self,
        request: GetVapidPublicKeyRequest,
        ctx: RequestContext,
    ) -> GetVapidPublicKeyResponse:
        """
        Handle get_vapid_public_key RPC call.

        Returns the server's VAPID public key so the browser can subscribe
        to push notifications. Does not require authentication so the
        subscription flow can start before full context is loaded.

        Parameters
        ----------
        request : GetVapidPublicKeyRequest
            Empty request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetVapidPublicKeyResponse
            The base64url-encoded VAPID public key.

        """
        config = get_vapid_config()
        if not config:
            raise ConnectError(
                Code.FAILED_PRECONDITION,
                "Push notifications are not configured on this server",
            )
        return GetVapidPublicKeyResponse(public_key=config.public_key)

    async def stream_notifications(
        self,
        request: StreamNotificationsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamNotificationEvent]:
        """
        Handle stream_notifications server streaming RPC.

        Subscribes to the user's Valkey Pub/Sub channel and yields
        StreamNotificationEvent messages as they arrive. Sends periodic
        heartbeats to detect stale connections.

        The subscriber yields None on each poll timeout (1s), which we
        use to track heartbeat intervals. This eliminates the need for a
        separate heartbeat task and makes the entire loop cleanly
        cancellable -- no leaked tasks or connections.

        Parameters
        ----------
        request : StreamNotificationsRequest
            The streaming request with organization_id.
        ctx : RequestContext
            RPC request context.

        Yields
        ------
        StreamNotificationEvent
            Notification events or heartbeats.

        """
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

        try:
            async with aclosing(subscribe_user(user_id)) as subscriber:
                last_send = time.monotonic()

                async for payload in subscriber:
                    # Check if the client disconnected (set by middleware)
                    if disconnect and disconnect.is_set():
                        logger.info(
                            f"stream client disconnected, stopping for {user_id}",
                            component="notifications handler",
                        )
                        break

                    now = time.monotonic()

                    if payload is None:
                        # Poll timeout tick -- send heartbeat if interval elapsed
                        if now - last_send >= heartbeat_interval:
                            ts = Timestamp()
                            ts.FromDatetime(datetime.now(UTC))
                            yield StreamNotificationEvent(
                                event_type=StreamNotificationEvent.EVENT_TYPE_HEARTBEAT,
                                timestamp=ts,
                            )
                            last_send = now
                        continue

                    # File update event (from worker tasks)
                    if payload.get("_type") == "file_updated":
                        yield StreamNotificationEvent(
                            event_type=StreamNotificationEvent.EVENT_TYPE_FILE_UPDATED,
                            file_update=FileUpdatePayload(
                                file_id=payload.get("file_id", ""),
                                organization_id=payload.get("organization_id", ""),
                            ),
                        )
                        last_send = now
                        continue

                    # Real notification payload
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
                    )

                    if "created_at" in payload:
                        ts = Timestamp()
                        ts.FromDatetime(datetime.fromisoformat(payload["created_at"]))
                        proto_notification.created_at.CopyFrom(ts)

                    yield StreamNotificationEvent(
                        event_type=StreamNotificationEvent.EVENT_TYPE_NEW_NOTIFICATION,
                        notification=proto_notification,
                    )
                    last_send = now

        except (asyncio.CancelledError, GeneratorExit):
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
