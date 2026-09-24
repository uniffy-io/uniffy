"""LiveKit JWT minting and webhook verification.

Tokens are HS256 JWTs signed with LIVEKIT_API_SECRET (independent of the app's
JWT_SECRET_KEY). Grants ride in the `video` claim per the LiveKit token spec.
"""

import base64
import hashlib
import time
import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import jwt

from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.webhooks import WebhookVerificationError
from uniffy.domains.calls.config import LiveKitConfig

# Bounds how long an evicted participant can keep reconnecting before the join
# webhook kicks them again; clients refresh well before it expires.
USER_TOKEN_TTL_SECONDS = 30 * 60
ADMIN_TOKEN_TTL_SECONDS = 5 * 60
# Tolerates client/server clock skew on nbf/exp validation.
CLOCK_SKEW_LEEWAY_SECONDS = 5 * 60

PUBLISH_SOURCES = ["camera", "microphone", "screen_share", "screen_share_audio"]


@dataclass(frozen=True)
class MintedToken:
    token: str
    jti: str
    expires_at: int


def livekit_room_name(organization_id: UUID, call_id: UUID) -> str:
    """Org-prefixed so a spoofed room claim cannot cross tenants inside the SFU."""
    return f"org_{organization_id}:call_{call_id}"


def participant_identity(user_id: UUID, device_id: str) -> str:
    return f"{user_id}:{device_id}"


def parse_room_call_id(name: str) -> UUID | None:
    try:
        organization, call = name.split(":call_")
        if not organization.startswith("org_"):
            return None
        organization_id = UUID(organization.removeprefix("org_"))
        call_id = UUID(call)
    except ValueError, TypeError:
        return None
    return call_id if name == livekit_room_name(organization_id, call_id) else None


class LiveKitTokenMinter:
    def __init__(self, config: LiveKitConfig) -> None:
        self._config = config

    def mint_user_token(
        self,
        *,
        organization_id: UUID,
        call_id: UUID,
        user_id: UUID,
        device_id: str,
        display_name: str,
        device_label: str | None = None,
        can_publish: bool = True,
    ) -> MintedToken:
        now = int(time.time())
        token_jti = str(uuid.uuid4())
        expires_at = now + USER_TOKEN_TTL_SECONDS
        metadata = {
            "user_id": str(user_id),
            "org_id": str(organization_id),
            "device_id": device_id,
            "device_label": device_label or "",
            "jti": token_jti,
        }
        claims: dict[str, Any] = {
            "iss": self._config.api_key,
            "sub": participant_identity(user_id, device_id),
            "name": display_name,
            "nbf": now - CLOCK_SKEW_LEEWAY_SECONDS,
            "exp": expires_at,
            "jti": token_jti,
            "metadata": dumps_str(metadata),
            "video": {
                "room": livekit_room_name(organization_id, call_id),
                "roomJoin": True,
                "canSubscribe": True,
                "canPublish": can_publish,
                "canPublishSources": PUBLISH_SOURCES if can_publish else [],
            },
        }
        token = jwt.encode(claims, self._config.api_secret, algorithm="HS256")
        return MintedToken(token=token, jti=token_jti, expires_at=expires_at)

    def mint_admin_token(self, *, room: str | None = None) -> str:
        """Short-lived backend-to-LiveKit token for Twirp admin calls."""
        now = int(time.time())
        video: dict[str, Any] = {"roomAdmin": True, "roomList": True, "roomCreate": True}
        if room is not None:
            video["room"] = room
        claims: dict[str, Any] = {
            "iss": self._config.api_key,
            "sub": self._config.api_key,
            "nbf": now - CLOCK_SKEW_LEEWAY_SECONDS,
            "exp": now + ADMIN_TOKEN_TTL_SECONDS,
            "video": video,
        }
        return jwt.encode(claims, self._config.api_secret, algorithm="HS256")

    def verify_webhook(self, body: bytes, auth_header: str) -> dict[str, Any]:
        """Verify a LiveKit webhook and return the parsed event.

        LiveKit signs webhooks with an HS256 JWT in the Authorization header
        whose `sha256` claim is the base64 SHA-256 of the raw body - both the
        signature and the body hash must hold before the payload is trusted.
        """
        if not auth_header:
            raise WebhookVerificationError("missing Authorization header")
        token = auth_header.removeprefix("Bearer ").strip()
        try:
            claims = jwt.decode(
                token,
                self._config.api_secret,
                algorithms=["HS256"],
                leeway=CLOCK_SKEW_LEEWAY_SECONDS,
                # exp is required: a token without one would be replayable forever.
                options={"verify_aud": False, "require": ["exp"]},
                issuer=self._config.api_key,
            )
        except jwt.PyJWTError as exc:
            raise WebhookVerificationError(f"invalid webhook token: {exc}") from exc

        claimed_hash = claims.get("sha256", "")
        body_hash = base64.b64encode(hashlib.sha256(body).digest()).decode()
        if not claimed_hash or claimed_hash != body_hash:
            raise WebhookVerificationError("webhook body hash mismatch")

        try:
            return loads(body)
        except ValueError as exc:
            raise WebhookVerificationError("webhook body is not valid JSON") from exc
