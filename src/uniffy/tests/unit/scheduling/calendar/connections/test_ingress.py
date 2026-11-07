"""Provider notifications: handshakes answered, junk refused, nothing revealed."""

from unittest.mock import AsyncMock, patch

from starlette.requests import Request

from uniffy.core.json_codec import dumps_bytes
from uniffy.domains.scheduling.calendar.connections import ingress


def _request(path: str, *, query: str = "", headers=None, body: bytes = b"") -> Request:
    sent = {"type": "http.request", "body": body, "more_body": False}

    async def receive() -> dict:
        return sent

    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "query_string": query.encode(),
        "headers": [(k.encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    return Request(scope, receive)


async def test_graph_validation_echoes_the_token_as_plain_text() -> None:
    response = await ingress.receive_microsoft(
        _request("/api/calendar/push/microsoft", query="validationToken=abc%20123")
    )
    assert response.status_code == 200
    assert response.body == b"abc 123"
    assert response.media_type == "text/plain"


async def test_graph_validation_token_is_capped() -> None:
    response = await ingress.receive_microsoft(
        _request("/api/calendar/push/microsoft", query="validationToken=" + "x" * 5000)
    )
    assert len(response.body) == 2048


async def test_graph_notifications_wake_by_subscription_and_flag_lifecycle() -> None:
    body = dumps_bytes({
        "value": [
            {"subscriptionId": "sub-1", "clientState": "secret", "changeType": "updated"},
            {"subscriptionId": "sub-2", "clientState": "secret", "lifecycleEvent": "missed"},
            {
                "subscriptionId": "sub-3",
                "clientState": "secret",
                "lifecycleEvent": "reauthorizationRequired",
            },
            {
                "subscriptionId": "sub-4",
                "clientState": "secret",
                "lifecycleEvent": "subscriptionRemoved",
            },
            {"subscriptionId": "", "clientState": "secret"},
        ]
    })
    with (
        patch.object(ingress, "_wake", AsyncMock(return_value=True)) as wake,
        patch.object(ingress, "_forget_channel", AsyncMock()) as forget,
    ):
        response = await ingress.receive_microsoft(
            _request("/api/calendar/push/microsoft", body=body)
        )
    assert response.status_code == 202
    calls = {call.args[0]: call.kwargs for call in wake.await_args_list}
    assert calls["sub-1"] == {"rescan": False, "renew": False}
    assert calls["sub-2"]["rescan"] is True
    assert calls["sub-3"]["renew"] is True
    assert "sub-4" not in calls
    forget.assert_awaited_once_with("sub-4", "secret")


async def test_an_oversized_graph_body_is_refused_unread() -> None:
    request = _request(
        "/api/calendar/push/microsoft", headers={"content-length": str(2 * 1024 * 1024)}
    )
    with patch.object(ingress, "_wake", AsyncMock()) as wake:
        response = await ingress.receive_microsoft(request)
    assert response.status_code == 413
    wake.assert_not_awaited()


async def test_google_sync_handshake_wakes_nothing_and_answers_204() -> None:
    with patch.object(ingress, "_wake", AsyncMock()) as wake:
        response = await ingress.receive_google(
            _request(
                "/api/calendar/push/google",
                headers={
                    "x-goog-channel-id": "chan",
                    "x-goog-channel-token": "secret",
                    "x-goog-resource-state": "sync",
                },
            )
        )
    assert response.status_code == 204
    wake.assert_not_awaited()


async def test_google_change_wakes_with_the_channel_secret() -> None:
    with patch.object(ingress, "_wake", AsyncMock(return_value=False)) as wake:
        response = await ingress.receive_google(
            _request(
                "/api/calendar/push/google",
                headers={
                    "x-goog-channel-id": "chan",
                    "x-goog-channel-token": "secret",
                    "x-goog-resource-state": "exists",
                },
            )
        )
    assert response.status_code == 204
    assert wake.await_args.args[:2] == ("chan", "secret")
