"""Model + provider resolution with the org default tier.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime.model_resolver import (
    resolve_model,
    resolve_provider_and_model,
)


def _provider(*model_ids):
    return NS(
        name="anthropic",
        get_available_models=AsyncMock(
            return_value=[NS(id=m, context_window=200_000) for m in model_ids]
        ),
    )


def _result(value):
    res = MagicMock()
    res.scalar_one_or_none = MagicMock(return_value=value)
    return res


class TestResolveModel:
    async def test_org_default_used_after_fallbacks(self) -> None:
        model = await resolve_model(
            session_model_override=None,
            agent_primary_model="missing-primary",
            agent_fallback_models=["missing-fallback"],
            provider=_provider("default-model"),
            org_default_model="default-model",
        )
        assert model == "default-model"

    async def test_no_silent_catalog_pick(self) -> None:
        # The provider offers a model, but nothing the agent or org selected is
        # available, so resolution must error rather than silently pick one.
        with pytest.raises(ValidationError):
            await resolve_model(
                session_model_override=None,
                agent_primary_model="missing",
                agent_fallback_models=[],
                provider=_provider("something-else"),
                org_default_model=None,
            )

    async def test_primary_wins_over_org_default(self) -> None:
        model = await resolve_model(
            session_model_override=None,
            agent_primary_model="primary",
            agent_fallback_models=[],
            provider=_provider("primary", "default-model"),
            org_default_model="default-model",
        )
        assert model == "primary"


def _provider_ops(provider, pk, *, model_lookup=True):
    return NS(
        get_provider_for_key=AsyncMock(return_value=(provider, pk)),
        get_key_and_provider_for_model=AsyncMock(
            return_value=(provider, pk) if model_lookup else None
        ),
    )


_SETTINGS_PATCH = "uniffy.domains.agents.runtime.model_resolver.get_runtime_settings"


class TestResolveProviderAndModel:
    async def test_name_only_agent_uses_org_default(self) -> None:
        key_id = generate_id()
        pk = NS(id=key_id)
        provider = _provider("org-default-model")
        provider_ops = _provider_ops(provider, pk)
        agent = NS(
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=[],
        )
        settings = NS(
            default_provider_key_id=key_id,
            default_chat_model="org-default-model",
        )
        with patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)):
            prov, resolved_key, model = await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )
        assert model == "org-default-model"
        assert resolved_key == key_id
        provider_ops.get_provider_for_key.assert_awaited_once()

    async def test_no_agent_and_no_org_default_errors(self) -> None:
        provider_ops = _provider_ops(_provider("whatever"), NS(id=generate_id()))
        agent = NS(
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=[],
        )
        settings = NS(default_provider_key_id=None, default_chat_model=None)
        with (
            patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)),
            pytest.raises(ValidationError),
        ):
            await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )

    async def test_configured_agent_skips_org_read(self) -> None:
        pk = NS(id=generate_id())
        provider = _provider("agent-primary")
        provider_ops = _provider_ops(provider, pk)
        agent = NS(
            primary_provider_key_id=pk.id,
            primary_model="agent-primary",
            fallback_models=[],
        )
        settings_mock = AsyncMock()
        with patch(_SETTINGS_PATCH, settings_mock):
            _, _, model = await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )
        assert model == "agent-primary"
        settings_mock.assert_not_awaited()

    async def test_agent_fallbacks_outrank_org_default(self) -> None:
        pk = NS(id=generate_id())
        provider = _provider("fallback-model")
        provider_ops = _provider_ops(provider, pk)
        agent = NS(
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=["fallback-model"],
        )
        settings_mock = AsyncMock()
        with patch(_SETTINGS_PATCH, settings_mock):
            _, _, model = await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )
        assert model == "fallback-model"
        settings_mock.assert_not_awaited()

    async def test_key_only_agent_consults_org_default_model(self) -> None:
        # A key with no model resolves against the org default chat model,
        # naturally restricted to what the key's provider serves.
        pk = NS(id=generate_id())
        provider = _provider("org-default-model")
        provider_ops = _provider_ops(provider, pk)
        agent = NS(
            primary_provider_key_id=pk.id,
            primary_model="",
            fallback_models=[],
        )
        settings = NS(
            default_provider_key_id=generate_id(),
            default_chat_model="org-default-model",
        )
        with patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)):
            _, resolved_key, model = await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )
        assert model == "org-default-model"
        # The agent's own key is used, never repointed to the org default key.
        assert resolved_key == pk.id

    async def test_stale_org_default_key_raises_friendly_error(self) -> None:
        provider_ops = NS(
            get_provider_for_key=AsyncMock(
                side_effect=NotFoundError("ProviderKey", "gone")
            ),
            get_key_and_provider_for_model=AsyncMock(return_value=None),
        )
        agent = NS(
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=[],
        )
        settings = NS(
            default_provider_key_id=generate_id(),
            default_chat_model="org-default-model",
        )
        with (
            patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)),
            pytest.raises(ValidationError, match="default provider key"),
        ):
            await resolve_provider_and_model(
                MagicMock(),
                provider_ops,
                organization_id=generate_id(),
                agent=agent,
            )


class TestCompactionWorkerNameOnlyAgent:
    async def test_worker_compacts_via_org_default(self) -> None:
        from uniffy.workers.tasks import agent_compaction

        org_id = generate_id()
        key_id = generate_id()
        session_id = generate_id()
        agent_id = generate_id()
        agent_session_row = NS(
            id=session_id,
            agent_id=agent_id,
            organization_id=org_id,
            user_id=generate_id(),
            model_override=None,
        )
        agent_row = NS(
            id=agent_id,
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=[],
        )

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_result(agent_session_row), _result(agent_row)]
        )

        @asynccontextmanager
        async def fake_open_session():
            yield db

        provider = _provider("org-default-model")
        provider_ops = _provider_ops(provider, NS(id=key_id), model_lookup=False)
        session_ops = MagicMock()
        session_ops.compact_session_if_needed = AsyncMock(
            return_value=NS(
                performed=True,
                messages_compacted=3,
                tokens_before=100,
                tokens_after=40,
            )
        )
        settings = NS(
            default_provider_key_id=key_id,
            default_chat_model="org-default-model",
        )

        with (
            patch.object(
                agent_compaction, "_acquire_lock", AsyncMock(return_value=True)
            ),
            patch.object(agent_compaction, "_release_lock", AsyncMock()),
            patch.object(agent_compaction, "open_session", fake_open_session),
            patch.object(
                agent_compaction, "SessionOperations", return_value=session_ops
            ),
            patch.object(
                agent_compaction, "ProviderOperations", return_value=provider_ops
            ),
            patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)),
        ):
            result = await agent_compaction.compact_session({}, str(session_id))

        assert result["status"] == "success"
        kwargs = session_ops.compact_session_if_needed.await_args.kwargs
        assert kwargs["model"] == "org-default-model"

    async def test_worker_reports_error_without_any_default(self) -> None:
        from uniffy.workers.tasks import agent_compaction

        session_id = generate_id()
        agent_session_row = NS(
            id=session_id,
            agent_id=generate_id(),
            organization_id=generate_id(),
            user_id=generate_id(),
            model_override=None,
        )
        agent_row = NS(
            id=agent_session_row.agent_id,
            primary_provider_key_id=None,
            primary_model="",
            fallback_models=[],
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_result(agent_session_row), _result(agent_row)]
        )

        @asynccontextmanager
        async def fake_open_session():
            yield db

        settings = NS(default_provider_key_id=None, default_chat_model=None)
        with (
            patch.object(
                agent_compaction, "_acquire_lock", AsyncMock(return_value=True)
            ),
            patch.object(agent_compaction, "_release_lock", AsyncMock()),
            patch.object(agent_compaction, "open_session", fake_open_session),
            patch(_SETTINGS_PATCH, AsyncMock(return_value=settings)),
        ):
            result = await agent_compaction.compact_session({}, str(session_id))
        assert result["status"] == "error"
