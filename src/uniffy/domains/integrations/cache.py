"""Integrations Valkey helpers: org connection metadata + invalidation pubsub.

The metadata entry holds non-secret routing fields only; decrypted
credentials live exclusively in the in-process client LRU.
"""

import json
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.core.valkey.cache import CACHE_MISS, cache_delete, cache_get, cache_set
from uniffy.core.valkey.ops import _get_ops_client

logger = logger.bind(component="integrations.cache")

_ORG_META_TTL_SECONDS = 300


def _org_meta_key(organization_id: UUID) -> str:
    return f"integrations:org:{organization_id}"


def connection_invalidate_channel(connection_id: UUID) -> str:
    return f"integration_connections:invalidate:{connection_id}"


def _serialize_meta(row: IntegrationConnection) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "provider": row.provider,
        "name": row.name,
        "allow_writes": row.allow_writes,
        "is_valid": row.is_valid,
        "is_enabled": row.is_enabled,
    }


async def get_org_connections_meta(
    session: AsyncSession,
    organization_id: UUID,
) -> list[dict[str, Any]]:
    """Non-secret connection metadata for one org, Valkey-first with PG seed."""
    cached = await cache_get(_org_meta_key(organization_id))
    if cached is not CACHE_MISS and isinstance(cached, dict):
        connections = cached.get("connections")
        if isinstance(connections, list):
            return connections

    result = await session.execute(
        select(IntegrationConnection).where(IntegrationConnection.organization_id == organization_id)
    )
    meta = [_serialize_meta(row) for row in result.scalars().all()]
    await cache_set(
        _org_meta_key(organization_id),
        {"connections": meta},
        ttl=_ORG_META_TTL_SECONDS,
    )
    return meta


async def invalidate_org_connections_meta(organization_id: UUID) -> None:
    await cache_delete(_org_meta_key(organization_id))


async def publish_connection_invalidation(connection_id: UUID) -> None:
    """Cross-pod signal that drops this connection's cached http client.

    Call after any mutation to the row (add / update / validate / toggle /
    remove / auto-demote); every pod's subscriber drops its LRU entry.
    """
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.publish(
            connection_invalidate_channel(connection_id),
            json.dumps({"connection_id": str(connection_id)}),
        )
    except Exception:
        logger.warning(f"Integration connection invalidate publish failed for {connection_id}")
