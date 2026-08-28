"""Tests for the per-org agent runtime settings loader and cache."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime.settings.operations import (
    DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
    DEFAULT_DISPLAY_CURRENCY,
    DEFAULT_SEND_DEADLINE_SECONDS,
    get_runtime_settings,
    invalidate_runtime_settings_cache,
)


def _session_returning(blob: dict | None) -> MagicMock:
    """Fake AsyncSession whose execute() yields one org_settings 'runtime' row."""
    rows = [SimpleNamespace(key="runtime", value=blob)] if blob is not None else []
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=rows)
    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars)

    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


async def test_missing_row_falls_back_to_module_defaults() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = generate_id()
        session = _session_returning(None)

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS
        assert resolved.failover_enabled is True
        assert resolved.resume_enabled is True
        assert (
            resolved.circuit_breaker_failure_threshold == DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD
        )
        assert resolved.circuit_breaker_recovery_seconds == DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS
        assert resolved.display_currency == DEFAULT_DISPLAY_CURRENCY
        assert resolved.default_provider_key_id is None
        assert resolved.default_chat_model is None

    await run()


async def test_blob_overrides_defaults_only_for_set_keys() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = generate_id()
        session = _session_returning({
            "send_deadline_seconds": 15,
            "failover_enabled": False,
            "resume_enabled": False,
            "circuit_breaker_failure_threshold": 2,
            "circuit_breaker_recovery_seconds": 5,
            "display_currency": "EUR",
        })

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == 15
        assert resolved.failover_enabled is False
        assert resolved.resume_enabled is False
        assert resolved.circuit_breaker_failure_threshold == 2
        assert resolved.circuit_breaker_recovery_seconds == 5
        assert resolved.display_currency == "EUR"

    await run()


async def test_null_deadline_falls_back_to_module_default() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = generate_id()
        session = _session_returning({"send_deadline_seconds": None})

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS

    await run()


async def test_failed_db_call_returns_defaults_without_raising() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = generate_id()
        session = MagicMock()
        session.execute = AsyncMock(side_effect=RuntimeError("db down"))

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS

    await run()


def _admin_ops(*, admin_raises=False, store: dict | None = None):
    from types import SimpleNamespace as NS
    from unittest.mock import patch

    from uniffy.core.errors import PermissionDeniedError
    from uniffy.domains.agents.runtime.settings.operations import RuntimeSettingsOperations

    ops = RuntimeSettingsOperations.__new__(RuntimeSettingsOperations)
    ops._session = MagicMock()
    ops._session.commit = AsyncMock()
    ops._org_ops = NS(
        require_org_admin=AsyncMock(
            side_effect=PermissionDeniedError("admin") if admin_raises else None
        ),
        require_org_member=AsyncMock(),
    )
    ops._settings = MagicMock()

    # Simulate the database-side JSONB merge with a plain dict store.
    blob = store if store is not None else {}

    async def fake_merge(**kwargs):
        blob.update(kwargs["patch"])

    async def fake_get_namespace(org_id, namespace):
        if not blob:
            return {}
        return {"runtime": NS(key="runtime", value=dict(blob))}

    ops._settings.merge_json = AsyncMock(side_effect=fake_merge)
    ops._settings.get_namespace = AsyncMock(side_effect=fake_get_namespace)
    return ops, patch


def _update_kwargs(**overrides):
    kwargs = dict(
        user_id=generate_id(),
        organization_id=generate_id(),
        send_deadline_seconds=42,
        failover_enabled=True,
        resume_enabled=True,
        circuit_breaker_failure_threshold=5,
        circuit_breaker_recovery_seconds=60,
        personal_memory_bridge_enabled=True,
        default_provider_key_id="",
        default_chat_model="",
        image_max_resolution="",
        image_max_quality="",
    )
    kwargs.update(overrides)
    return kwargs


async def test_admin_get_requires_org_admin() -> None:
    from uniffy.core.errors import PermissionDeniedError

    ops, _ = _admin_ops(admin_raises=True)

    async def run() -> None:
        try:
            await ops.get(user_id=generate_id(), organization_id=generate_id())
        except PermissionDeniedError:
            return
        raise AssertionError("expected PermissionDeniedError")

    await run()


async def test_admin_update_round_trips_every_field() -> None:
    ops, patch = _admin_ops()

    async def run() -> None:
        with patch(
            "uniffy.domains.agents.runtime.settings.operations.write_audit_event",
            AsyncMock(),
        ):
            resolved, configured = await ops.update(
                **_update_kwargs(
                    failover_enabled=False,
                    resume_enabled=False,
                    circuit_breaker_failure_threshold=9,
                    circuit_breaker_recovery_seconds=99,
                    personal_memory_bridge_enabled=False,
                    default_chat_model="claude-sonnet-4-6",
                    image_max_resolution="2K",
                    image_max_quality="high",
                )
            )
        assert configured is True
        assert resolved.send_deadline_seconds == 42
        assert resolved.failover_enabled is False
        assert resolved.resume_enabled is False
        assert resolved.circuit_breaker_failure_threshold == 9
        assert resolved.circuit_breaker_recovery_seconds == 99
        assert resolved.personal_memory_bridge_enabled is False
        assert resolved.default_chat_model == "claude-sonnet-4-6"
        assert resolved.image_max_resolution == "2K"
        assert resolved.image_max_quality == "high"

    await run()


async def test_admin_update_preserves_unmanaged_keys() -> None:
    store = {"display_currency": "EUR", "failover_enabled": True}
    ops, patch = _admin_ops(store=store)

    async def run() -> None:
        with patch(
            "uniffy.domains.agents.runtime.settings.operations.write_audit_event",
            AsyncMock(),
        ):
            resolved, _ = await ops.update(**_update_kwargs())
        # display_currency is not managed by this surface; the patch must not
        # carry it and the merged blob must still have it.
        patch_arg = ops._settings.merge_json.await_args.kwargs["patch"]
        assert "display_currency" not in patch_arg
        assert store["display_currency"] == "EUR"
        assert resolved.display_currency == "EUR"

    await run()


def _key_row(**overrides):
    defaults = dict(
        id=generate_id(),
        provider="anthropic",
        is_enabled=True,
        is_valid=True,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _ops_with_key(key):
    ops, patch = _admin_ops()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=key)
    ops._session.execute = AsyncMock(return_value=result)
    return ops, patch


async def _expect_update_rejected(ops, **overrides) -> None:
    from uniffy.core.errors import ValidationError

    async def run() -> None:
        try:
            await ops.update(**_update_kwargs(**overrides))
        except ValidationError:
            return
        raise AssertionError("expected ValidationError")

    await run()


async def test_default_key_must_be_enabled_and_valid() -> None:
    key = _key_row(is_enabled=False)
    ops, _ = _ops_with_key(key)
    await _expect_update_rejected(ops, default_provider_key_id=str(key.id))


async def test_default_model_must_match_key_provider() -> None:
    from unittest.mock import patch

    key = _key_row(provider="anthropic")
    ops, _ = _ops_with_key(key)
    with patch(
        "uniffy.domains.agents.runtime.settings.operations.provider_for_model",
        MagicMock(return_value="openai"),
    ):
        await _expect_update_rejected(
            ops,
            default_provider_key_id=str(key.id),
            default_chat_model="gpt-5.4",
        )


async def test_coherent_default_key_and_model_accepted() -> None:
    from unittest.mock import patch

    key = _key_row(provider="anthropic")
    ops, _ = _ops_with_key(key)

    async def run() -> None:
        with (
            patch(
                "uniffy.domains.agents.runtime.settings.operations.write_audit_event",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.agents.runtime.settings.operations.provider_for_model",
                MagicMock(return_value="anthropic"),
            ),
        ):
            resolved, _ = await ops.update(
                **_update_kwargs(
                    default_provider_key_id=str(key.id),
                    default_chat_model="claude-sonnet-4-6",
                )
            )
        assert resolved.default_provider_key_id == key.id
        assert resolved.default_chat_model == "claude-sonnet-4-6"

    await run()


def test_from_blob_survives_malformed_values() -> None:
    from uniffy.domains.agents.runtime.settings.operations import _from_blob

    parsed = _from_blob({
        "send_deadline_seconds": "not-a-number",
        "circuit_breaker_failure_threshold": None,
        "circuit_breaker_recovery_seconds": -5,
    })
    assert parsed.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS
    assert parsed.circuit_breaker_failure_threshold == DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    assert parsed.circuit_breaker_recovery_seconds == DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS


def test_from_blob_parses_key_id_and_model() -> None:
    from uniffy.domains.agents.runtime.settings.operations import _from_blob

    key_id = generate_id()
    parsed = _from_blob({
        "default_provider_key_id": str(key_id),
        "default_chat_model": "  claude-sonnet-4-6  ",
    })
    assert parsed.default_provider_key_id == key_id
    assert parsed.default_chat_model == "claude-sonnet-4-6"


def test_from_blob_bad_key_id_is_none() -> None:
    from uniffy.domains.agents.runtime.settings.operations import _from_blob

    parsed = _from_blob({"default_provider_key_id": "not-a-uuid"})
    assert parsed.default_provider_key_id is None


async def test_bridge_disabled_when_flag_false() -> None:
    from types import SimpleNamespace as NS
    from unittest.mock import patch

    from uniffy.core.models.agents.memory import MemoryScope
    from uniffy.domains.agents.memories.scope import MemoryScopeRef
    from uniffy.domains.agents.runtime.operations import RuntimeOperations

    ops = object.__new__(RuntimeOperations)
    ops._session = MagicMock()

    async def run() -> None:
        with patch(
            "uniffy.domains.agents.runtime.operations.get_runtime_settings",
            AsyncMock(return_value=NS(personal_memory_bridge_enabled=False)),
        ):
            result = await ops._resolve_memory_bridge(
                scope_ref=MemoryScopeRef(MemoryScope.CHANNEL, generate_id()),
                user_id=generate_id(),
                organization_id=generate_id(),
            )
        assert result is None

    await run()
