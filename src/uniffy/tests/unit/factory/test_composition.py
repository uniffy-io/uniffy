from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.types import ASGIApp, Message, Scope

from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.core.streaming.disconnect import StreamDisconnectMiddleware
from uniffy.core.streaming.middleware import StreamRevokeWatchMiddleware
from uniffy.domains.platform.config.service import SystemConfigServiceImpl
from uniffy.factory import ConnectRPCDispatcher, _create_api_dispatcher


def _dispatcher() -> ConnectRPCDispatcher:
    search = WorkspaceSearch(MagicMock(spec=SearchEngine))
    return _create_api_dispatcher(
        MagicMock(spec=ObjectStorage),
        search,
        SearchIndexer(search),
    )


def _unwrap_streaming(app: ASGIApp) -> ASGIApp:
    while isinstance(app, (StreamDisconnectMiddleware, StreamRevokeWatchMiddleware)):
        app = app.app
    return app


def test_constructed_bindings_are_unique_and_match_generated_endpoints() -> None:
    dispatcher = _dispatcher()
    prefixes = [prefix for prefix, _ in dispatcher.services]

    assert len(prefixes) == len(set(prefixes))
    for prefix, application in dispatcher.services:
        application = _unwrap_streaming(application)
        if not hasattr(application, "_endpoints"):
            continue
        endpoints = application._endpoints(application._service)
        assert endpoints
        assert all(path.startswith(f"{prefix}/") for path in endpoints)


def test_streaming_and_platform_bindings_keep_their_required_shape() -> None:
    services = dict(_dispatcher().services)

    runtime = services["/agents.v1.RuntimeService"]
    assert isinstance(runtime, StreamDisconnectMiddleware)
    assert isinstance(runtime.app, StreamRevokeWatchMiddleware)

    system_config = _unwrap_streaming(services["/superadmin.v1.SystemConfigService"])
    assert isinstance(system_config._service, SystemConfigServiceImpl)


def test_duplicate_prefix_is_rejected_at_composition_time() -> None:
    dispatcher = ConnectRPCDispatcher()
    application = AsyncMock()
    dispatcher.add_service("/notes.v1.NotesService", application)

    with pytest.raises(ValueError, match="Duplicate service prefix"):
        dispatcher.add_service("/notes.v1.NotesService", application)


async def test_dispatcher_matches_a_complete_path_segment() -> None:
    dispatcher = ConnectRPCDispatcher()
    application = AsyncMock()
    dispatcher.add_service("/files", application)
    messages: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    scope: Scope = {
        "type": "http",
        "path": "/files.v1.FilesService/ListFiles",
        "root_path": "",
    }
    await dispatcher(scope, receive, send)

    application.assert_not_called()
    assert messages[0]["status"] == 404
