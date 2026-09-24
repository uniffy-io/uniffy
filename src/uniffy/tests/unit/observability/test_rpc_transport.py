import gzip
from unittest.mock import AsyncMock, MagicMock

import pytest
from connectrpc.code import Code
from connectrpc.request import RequestContext
from connectrpc.server import DEFAULT_READ_MAX_BYTES
from fastapi.testclient import TestClient
from google.protobuf.message import Message
from uniffy_proto.agents.v1.agents_pb2 import UploadAgentAvatarRequest, UploadAgentAvatarResponse
from uniffy_proto.auth.v1.auth_pb2 import LoginRequest
from uniffy_proto.cal.v1.calendar_pb2 import (
    ApplyCalendarImportRequest,
    ApplyCalendarImportResponse,
    PreviewCalendarImportRequest,
    PreviewCalendarImportResponse,
)
from uniffy_proto.files.v1.files_pb2 import UploadChunkRequest, UploadChunkResponse
from uniffy_proto.users.v1.users_pb2 import UploadAvatarRequest, UploadAvatarResponse

from uniffy.core.auth.principal import current_principal
from uniffy.core.auth.tokens import create_access_token
from uniffy.core.avatars import MAX_AVATAR_BYTES
from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import generate_id
from uniffy.domains.agents.agents.service import AgentsServiceImpl
from uniffy.domains.files.service import FilesServiceImpl
from uniffy.domains.files.uploads import SMALL_CHUNK_SIZE, XLARGE_CHUNK_SIZE
from uniffy.domains.scheduling.calendar.ical.parse import MAX_IMPORT_BYTES
from uniffy.domains.scheduling.calendar.service import CalendarServiceImpl
from uniffy.domains.users.service import UsersServiceImpl
from uniffy.factory import FILES_RPC_READ_MAX_BYTES, _create_api_dispatcher
from uniffy.transport.rpc import strict_request_codecs


def _rpc_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("JWT_SECRET_KEY", "rpc-transport-test-secret-at-least-32-bytes")
    monkeypatch.setattr(
        "uniffy.domains.auth.interceptors.is_access_token_revoked",
        AsyncMock(return_value=False),
    )
    monkeypatch.setattr(
        "uniffy.domains.auth.interceptors.is_session_revoked",
        AsyncMock(return_value=False),
    )
    search = WorkspaceSearch(MagicMock(spec=SearchEngine))
    dispatcher = _create_api_dispatcher(MagicMock(spec=ObjectStorage), search, SearchIndexer(search))
    return TestClient(
        dispatcher,
        headers={
            "authorization": f"Bearer {create_access_token(generate_id())}",
            "connect-protocol-version": "1",
        },
    )


def test_private_rpc_authenticates_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    body = b"{private-parser-detail"
    response = _rpc_client(monkeypatch).post(
        "/files.v1.FilesService/UploadChunk",
        content=body,
        headers={"authorization": "", "content-type": "application/json"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == Code.UNAUTHENTICATED.name.lower()
    assert body.decode() not in response.text


@pytest.mark.parametrize("body", [b"{private-parser-detail", b'{"unknown_field": 1}'])
@pytest.mark.parametrize("content_type", ["application/json", "application/json; charset=utf-8"])
def test_public_rpc_rejects_invalid_json_without_parser_details(
    monkeypatch: pytest.MonkeyPatch, body: bytes, content_type: str
) -> None:
    response = _rpc_client(monkeypatch).post(
        "/auth.v1.AuthService/Login",
        content=body,
        headers={"authorization": "", "content-type": content_type},
    )

    assert response.status_code == 400
    assert response.json() == {"code": "invalid_argument", "message": "Malformed request body"}


@pytest.mark.parametrize("compressed", [False, True])
def test_regular_rpc_rejects_oversized_messages(
    monkeypatch: pytest.MonkeyPatch, compressed: bool
) -> None:
    request = LoginRequest(password="x" * (DEFAULT_READ_MAX_BYTES + 1))
    codec = strict_request_codecs()[0]
    body = codec.encode(request)
    headers = {"content-type": "application/proto"}
    if compressed:
        body = gzip.compress(body)
        headers["content-encoding"] = "gzip"

    response = _rpc_client(monkeypatch).post(
        "/auth.v1.AuthService/Login", content=body, headers=headers
    )

    assert response.status_code == 429
    assert response.json()["code"] == Code.RESOURCE_EXHAUSTED.name.lower()


@pytest.mark.parametrize(
    ("codec_name", "chunk_size"), [("proto", SMALL_CHUNK_SIZE), ("json", XLARGE_CHUNK_SIZE)]
)
def test_upload_chunk_preserves_supported_payload_sizes(
    monkeypatch: pytest.MonkeyPatch, codec_name: str, chunk_size: int
) -> None:
    received: list[int] = []
    accepted_header = "true"

    async def receive_chunk(
        self: FilesServiceImpl, request: UploadChunkRequest, ctx: RequestContext
    ) -> UploadChunkResponse:
        assert current_principal().user_id
        received.append(len(request.data))
        ctx.response_headers.add("x-upload-accepted", accepted_header)
        return UploadChunkResponse(chunk_number=request.chunk_number)

    monkeypatch.setattr(FilesServiceImpl, "upload_chunk", receive_chunk)
    client = _rpc_client(monkeypatch)
    codec = next(codec for codec in strict_request_codecs() if codec.name() == codec_name)
    request = UploadChunkRequest(
        upload_id=str(generate_id()), chunk_number=1, data=b"x" * chunk_size
    )
    response = client.post(
        "/files.v1.FilesService/UploadChunk",
        content=codec.encode(request),
        headers={"content-type": f"application/{codec_name}"},
    )

    assert response.status_code == 200
    assert received == [chunk_size]
    assert response.headers["x-upload-accepted"] == accepted_header
    assert codec.decode(response.content, UploadChunkResponse).chunk_number == 1


def test_upload_rpc_still_rejects_oversized_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _rpc_client(monkeypatch).post(
        "/files.v1.FilesService/UploadChunk",
        content=b"x" * (FILES_RPC_READ_MAX_BYTES + 1),
        headers={"content-type": "application/proto"},
    )

    assert response.status_code == 429
    assert response.json()["code"] == Code.RESOURCE_EXHAUSTED.name.lower()


@pytest.mark.parametrize("codec_name", ["proto", "json"])
@pytest.mark.parametrize(
    ("service_type", "handler_name", "path", "request_type", "response_type", "field", "size"),
    [
        (
            UsersServiceImpl,
            "upload_avatar",
            "/users.v1.UsersService/UploadAvatar",
            UploadAvatarRequest,
            UploadAvatarResponse,
            "image_data",
            MAX_AVATAR_BYTES,
        ),
        (
            AgentsServiceImpl,
            "upload_agent_avatar",
            "/agents.v1.AgentsService/UploadAgentAvatar",
            UploadAgentAvatarRequest,
            UploadAgentAvatarResponse,
            "image_data",
            MAX_AVATAR_BYTES,
        ),
        (
            CalendarServiceImpl,
            "preview_calendar_import",
            "/cal.v1.CalendarService/PreviewCalendarImport",
            PreviewCalendarImportRequest,
            PreviewCalendarImportResponse,
            "content",
            MAX_IMPORT_BYTES,
        ),
        (
            CalendarServiceImpl,
            "apply_calendar_import",
            "/cal.v1.CalendarService/ApplyCalendarImport",
            ApplyCalendarImportRequest,
            ApplyCalendarImportResponse,
            "content",
            MAX_IMPORT_BYTES,
        ),
    ],
)
def test_avatar_and_calendar_rpcs_admit_supported_payloads(
    monkeypatch: pytest.MonkeyPatch,
    codec_name: str,
    service_type: type,
    handler_name: str,
    path: str,
    request_type: type[Message],
    response_type: type[Message],
    field: str,
    size: int,
) -> None:
    received: list[int] = []

    async def receive_payload(self: object, request: Message, ctx: RequestContext) -> Message:
        assert current_principal().user_id
        received.append(len(getattr(request, field)))
        return response_type()

    monkeypatch.setattr(service_type, handler_name, receive_payload)
    codec = next(codec for codec in strict_request_codecs() if codec.name() == codec_name)
    request = request_type(**{field: b"x" * size})
    response = _rpc_client(monkeypatch).post(
        path,
        content=codec.encode(request),
        headers={"content-type": f"application/{codec_name}"},
    )

    assert response.status_code == 200
    assert received == [size]
