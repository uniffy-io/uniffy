"""Ephemeral TURN credentials per the TURN REST spec (STUNner/coturn compatible)."""

import base64
import hashlib
import hmac
import time
from dataclasses import dataclass
from uuid import UUID

from uniffy.domains.calls.config import TurnConfig


@dataclass(frozen=True)
class TurnCredentials:
    urls: tuple[str, ...]
    username: str
    credential: str


def mint_turn_credentials(user_id: UUID, config: TurnConfig) -> TurnCredentials:
    """One username/credential pair covers every URL (TURN REST spec).

    ICE servers are fixed at connect time, so the TTL must outlive the longest
    plausible call; reconnects mint fresh credentials via a new JoinCall.
    """
    expiry_unix = int(time.time()) + config.credential_ttl_seconds
    username = f"{expiry_unix}:{user_id}"
    digest = hmac.new(config.shared_secret.encode(), username.encode(), hashlib.sha1).digest()
    return TurnCredentials(
        urls=config.server_urls,
        username=username,
        credential=base64.b64encode(digest).decode(),
    )
