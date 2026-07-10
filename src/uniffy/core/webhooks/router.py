"""Inbound webhook endpoint with pluggable per-provider verification.

One route serves every provider at /internal/webhooks/{provider}. A provider
registers a verifier (authenticates the raw body BEFORE it is trusted) and a
processor. The endpoint is not proxied by the edge - callers reach the backend
directly on the internal network, and signature verification is the actual
auth; network placement is defense in depth, not the gate.
"""

from typing import Any, Protocol

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

logger = logger.bind(component="core.webhooks")


class WebhookVerificationError(Exception):
    pass


class WebhookProvider(Protocol):
    def verify(self, body: bytes, auth_header: str) -> dict[str, Any]:
        """Authenticate the raw body and return the parsed event; raise
        WebhookVerificationError on any signature/hash mismatch."""
        ...

    async def process(self, event: dict[str, Any]) -> None: ...


_providers: dict[str, WebhookProvider] = {}


def register_webhook_provider(name: str, provider: WebhookProvider) -> None:
    _providers[name] = provider


webhooks_router = APIRouter(prefix="/internal/webhooks")


@webhooks_router.post("/{provider}")
async def receive_webhook(provider: str, request: Request) -> dict[str, bool]:
    handler = _providers.get(provider)
    if handler is None:
        raise HTTPException(status_code=404, detail="Unknown webhook provider")

    body = await request.body()
    auth_header = request.headers.get("authorization", "")
    try:
        event = handler.verify(body, auth_header)
    except WebhookVerificationError as exc:
        logger.warning(f"Webhook signature rejected for provider={provider}: {exc}")
        raise HTTPException(status_code=401, detail="Webhook verification failed") from exc

    try:
        await handler.process(event)
    except Exception:
        # 5xx makes the provider redeliver; processing must stay idempotent.
        logger.exception(f"Webhook processing failed for provider={provider}")
        raise HTTPException(status_code=500, detail="Webhook processing failed") from None

    return {"ok": True}
