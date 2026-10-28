"""Deployment bootstrap seeds accounts and push keys only from a configured password."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.config import settings as config_settings
from uniffy.core.config.push import (
    PUSH_SETTINGS_NAMESPACE,
    VAPID_CONTACT_EMAIL_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_PUBLIC_KEY,
)
from uniffy.core.models.login.organization_member import OrganizationMemberSource
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.core.types import generate_id
from uniffy.domains.organizations import operations as organization_operations
from uniffy.domains.platform import bootstrap
from uniffy.infrastructure.database import session as database_session

_CONTACT = "ops@example.com"


def _session(existing_org_id: object | None = None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing_org_id
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    return session


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("INITIAL_PLATFORM_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("DEFAULT_ORG_NAME", "Default")
    monkeypatch.setenv("DEFAULT_ORG_SLUG", "default")
    monkeypatch.setattr(
        "uniffy.core.auth.passwords.crypto.hash_password",
        MagicMock(return_value="hashed"),
    )
    return monkeypatch


def _install(
    monkeypatch: pytest.MonkeyPatch, session: MagicMock
) -> tuple[MagicMock, MagicMock, AsyncMock]:
    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield session

    monkeypatch.setattr(database_session, "open_session", open_session)

    operations = MagicMock()
    operations.create = AsyncMock(return_value=MagicMock(name="Default", slug="default"))
    constructor = MagicMock(return_value=operations)
    monkeypatch.setattr(organization_operations, "OrganizationOperations", constructor)

    seed_vapid = AsyncMock()
    monkeypatch.setattr(bootstrap, "seed_vapid_keys", seed_vapid)
    return constructor, operations, seed_vapid


async def test_configured_password_seeds_the_owner_and_the_default_organization(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("INITIAL_ADMIN_PASSWORD", "password")
    session = _session()
    constructor, operations, seed_vapid = _install(environment, session)

    search_indexer = MagicMock(spec=SearchIndexer)
    await bootstrap._bootstrap_deployment_locked(search_indexer)

    admin = session.add.call_args_list[0].args[0]
    assert isinstance(admin, User)
    assert admin.is_system_admin is True
    assert admin.email_verified is True
    constructor.assert_called_once_with(session)
    operations.create.assert_awaited_once_with(
        name="Default",
        slug="default",
        owner_user_id=admin.id,
        plan="enterprise",
        search_indexer=search_indexer,
        owner_source=OrganizationMemberSource.BOOTSTRAP,
    )
    seed_vapid.assert_awaited_once_with(session, "admin@example.com")
    session.commit.assert_awaited_once()


@pytest.mark.parametrize("password", [None, "", "   "], ids=["unset", "empty", "blank"])
async def test_missing_password_leaves_the_deployment_and_its_push_keys_to_setup(
    environment: pytest.MonkeyPatch,
    password: str | None,
) -> None:
    if password is None:
        environment.delenv("INITIAL_ADMIN_PASSWORD", raising=False)
    else:
        environment.setenv("INITIAL_ADMIN_PASSWORD", password)
    session = _session()
    constructor, operations, seed_vapid = _install(environment, session)

    await bootstrap._bootstrap_deployment_locked(MagicMock(spec=SearchIndexer))

    session.add.assert_not_called()
    constructor.assert_not_called()
    operations.create.assert_not_awaited()
    seed_vapid.assert_not_awaited()
    session.commit.assert_not_awaited()


async def test_initialized_deployment_seeds_nothing(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("INITIAL_ADMIN_PASSWORD", "password")
    session = _session(existing_org_id=generate_id())
    constructor, _operations, seed_vapid = _install(environment, session)

    await bootstrap._bootstrap_deployment_locked(MagicMock(spec=SearchIndexer))

    session.add.assert_not_called()
    constructor.assert_not_called()
    seed_vapid.assert_not_awaited()
    session.commit.assert_not_awaited()


async def test_failed_push_seeding_rolls_back_and_raises(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("INITIAL_ADMIN_PASSWORD", "password")
    session = _session()
    _constructor, _operations, seed_vapid = _install(environment, session)
    seed_vapid.side_effect = RuntimeError("cipher unavailable")

    with pytest.raises(RuntimeError):
        await bootstrap._bootstrap_deployment_locked(MagicMock(spec=SearchIndexer))

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


def _settings(monkeypatch: pytest.MonkeyPatch, existing: dict[str, object]) -> MagicMock:
    settings = MagicMock()
    settings.get_namespace = AsyncMock(return_value=existing)
    settings.set = AsyncMock()
    monkeypatch.setattr(
        config_settings, "DeploymentSettingsOperations", MagicMock(return_value=settings)
    )
    return settings


async def test_push_seeding_keeps_an_existing_keypair(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, {VAPID_PUBLIC_KEY: MagicMock()})

    await bootstrap.seed_vapid_keys(_session(), _CONTACT)

    settings.get_namespace.assert_awaited_once_with(PUSH_SETTINGS_NAMESPACE)
    settings.set.assert_not_awaited()


async def test_push_seeding_stores_a_keypair_and_the_contact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(monkeypatch, {})

    await bootstrap.seed_vapid_keys(_session(), _CONTACT)

    written = {call.kwargs["key"]: call.kwargs for call in settings.set.await_args_list}
    assert set(written) == {VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_CONTACT_EMAIL_KEY}
    assert written[VAPID_PRIVATE_KEY]["is_secret"] is True
    assert written[VAPID_CONTACT_EMAIL_KEY]["value"] == f"mailto:{_CONTACT}"
