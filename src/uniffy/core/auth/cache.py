"""Permission cache helpers for high-traffic permission resolution paths.

Every cached entry carries a ``user:{user_id}`` tag so a single user-scoped
invalidation drops everything that depends on that user. Role entries also
carry ``content:{ct}:{cid}`` so a role mutation on one piece of content can
wipe every user's cached role for that content - needed for ``BLOCKED`` grants
and group-targeted grants where the affected users aren't enumerable cheaply.
"""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from uniffy.core.types import ContentRole, ContentType, DomainType
from uniffy.core.valkey.cache import (
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
    cache_invalidate_many,
)

_ORG_ADMIN_TTL = 600
_DOMAIN_ADMIN_TTL = 600
_ROLE_TTL = 300


def _org_admin_key(organization_id: UUID, user_id: UUID) -> str:
    return f"perm:org_admin:{organization_id}:{user_id}"


def _domain_admin_key(
    organization_id: UUID,
    user_id: UUID,
    domain: DomainType,
) -> str:
    return f"perm:domain_admin:{organization_id}:{user_id}:{domain.value}"


def _role_key(
    organization_id: UUID,
    user_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> str:
    return f"perm:role:{organization_id}:{user_id}:{content_type.value}:{content_id}"


def _user_tag(user_id: UUID) -> str:
    return f"user:{user_id}"


def _content_tag(content_type: ContentType, content_id: UUID) -> str:
    return f"content:{content_type.value}:{content_id}"


def _defaults_tag(organization_id: UUID, content_type: ContentType) -> str:
    return f"defaults:{organization_id}:{content_type.value}"


async def get_or_load_org_admin(
    organization_id: UUID,
    user_id: UUID,
    loader: Callable[[], Awaitable[bool]],
) -> bool:
    async def _load() -> dict[str, Any] | None:
        return {"is_admin": await loader()}

    cached = await cache_get_or_set_locked(
        _org_admin_key(organization_id, user_id),
        _load,
        ttl=_ORG_ADMIN_TTL,
        tags=[_user_tag(user_id)],
    )
    return bool(cached and cached.get("is_admin"))


async def get_or_load_domain_admin(
    organization_id: UUID,
    user_id: UUID,
    domain: DomainType,
    loader: Callable[[], Awaitable[bool]],
) -> bool:
    async def _load() -> dict[str, Any] | None:
        return {"is_admin": await loader()}

    cached = await cache_get_or_set_locked(
        _domain_admin_key(organization_id, user_id, domain),
        _load,
        ttl=_DOMAIN_ADMIN_TTL,
        tags=[_user_tag(user_id)],
    )
    return bool(cached and cached.get("is_admin"))


async def get_or_load_effective_role(
    organization_id: UUID,
    user_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    loader: Callable[[], Awaitable[ContentRole | None]],
) -> ContentRole | None:
    """Cached effective-role; ``None`` (no access) is cached via the ``_SENTINEL`` path."""

    async def _load() -> dict[str, Any] | None:
        role = await loader()
        return {"role": role.value} if role is not None else None

    cached = await cache_get_or_set_locked(
        _role_key(organization_id, user_id, content_type, content_id),
        _load,
        ttl=_ROLE_TTL,
        tags=[
            _user_tag(user_id),
            _content_tag(content_type, content_id),
            _defaults_tag(organization_id, content_type),
        ],
    )
    if cached is None:
        return None
    raw = cached.get("role")
    return ContentRole(raw) if raw is not None else None


async def invalidate_role_for_user(
    organization_id: UUID,
    user_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> None:
    await cache_invalidate_many(
        _role_key(organization_id, user_id, content_type, content_id),
    )


async def invalidate_user(user_id: UUID) -> None:
    """Drop every cached perm entry tied to a user (membership / group changes)."""
    await cache_invalidate_by_tag(_user_tag(user_id))


async def invalidate_content(
    content_type: ContentType,
    content_id: UUID,
) -> None:
    """Drop every cached role for a piece of content (access-mode / BLOCKED / group grants)."""
    await cache_invalidate_by_tag(_content_tag(content_type, content_id))


async def invalidate_org_defaults(
    organization_id: UUID,
    content_type: ContentType,
) -> None:
    """Drop every cached role entry inheriting from the (org, ct) default.

    Rows with an explicit override survive in PG, but the cache is wiped
    wholesale because role entries do not record which rows were inheriting at
    compute time.
    """
    await cache_invalidate_by_tag(_defaults_tag(organization_id, content_type))


async def invalidate_domain_admin(
    organization_id: UUID,
    user_id: UUID,
    domain: DomainType,
) -> None:
    await cache_invalidate_many(
        _domain_admin_key(organization_id, user_id, domain),
    )
