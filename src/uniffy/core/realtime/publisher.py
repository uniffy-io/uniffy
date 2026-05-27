"""Outbound fanout for realtime Yjs updates, permission changes, and token
revokes over Valkey pubsub.

Doc-update payloads carry ``origin_replica`` and ``source_conn_id`` so subscribers
can drop echoes of their own writes.
"""

import base64
import time
from uuid import UUID

from uniffy.core.realtime.identity import replica_id
from uniffy.core.types import ContentType
from uniffy.core.valkey.pubsub import publish_to_channel


def doc_channel(content_type: ContentType, content_id: UUID) -> str:
    return f"realtime:doc:{content_type.value}:{content_id}"


def perm_channel(content_type: ContentType, content_id: UUID) -> str:
    return f"realtime:perm:{content_type.value}:{content_id}"


def defaults_channel(organization_id: UUID, content_type: ContentType) -> str:
    return f"realtime:defaults:{organization_id}:{content_type.value}"


def token_revoke_channel(user_id: UUID) -> str:
    return f"auth:revoke:{user_id}"


async def publish_doc_update(
    content_type: ContentType,
    content_id: UUID,
    update: bytes,
    *,
    source_conn_id: int,
) -> None:
    """Broadcast a Yjs update blob to peers across replicas."""
    await publish_to_channel(
        doc_channel(content_type, content_id),
        {
            "origin_replica": replica_id(),
            "source_conn_id": source_conn_id,
            "update": base64.b64encode(update).decode("ascii"),
            "published_at": time.time(),
        },
    )


async def publish_perm_change(
    content_type: ContentType,
    content_id: UUID,
    user_id: UUID | None,
    new_role: str | None,
) -> None:
    """Fan out a permission change. ``user_id=None`` triggers content-wide re-authorize."""
    await publish_to_channel(
        perm_channel(content_type, content_id),
        {
            "origin_replica": replica_id(),
            "user_id": str(user_id) if user_id is not None else None,
            "new_role": new_role,
            "published_at": time.time(),
        },
    )


async def publish_defaults_changed(
    organization_id: UUID,
    content_type: ContentType,
) -> None:
    """Fan out an org-default policy change; replicas re-authorize matching sessions."""
    await publish_to_channel(
        defaults_channel(organization_id, content_type),
        {
            "origin_replica": replica_id(),
            "organization_id": str(organization_id),
            "content_type": content_type.value,
            "published_at": time.time(),
        },
    )


async def publish_token_revoke(user_id: UUID, new_version: int) -> None:
    """Fan out a ``token_version`` bump (logout-all-devices)."""
    await publish_to_channel(
        token_revoke_channel(user_id),
        {
            "origin_replica": replica_id(),
            "token_version": new_version,
            "published_at": time.time(),
        },
    )
