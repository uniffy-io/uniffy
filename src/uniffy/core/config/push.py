"""VAPID key configuration for Web Push.

Keys are auto-generated on initial DB seed and stored in ``deployment_settings``
under ``namespace='push'`` (the private key encrypted via ``DeploymentCipher``).
Manual generation: ``uv run -m uniffy.scripts.generate_vapid``.
"""

from dataclasses import dataclass

from loguru import logger

logger = logger.bind(component="config.push")

PUSH_SETTINGS_NAMESPACE = "push"
VAPID_PRIVATE_KEY = "vapid_private_key"
VAPID_PUBLIC_KEY = "vapid_public_key"
VAPID_CONTACT_EMAIL_KEY = "vapid_contact_email"


@dataclass(frozen=True)
class VapidConfig:
    """VAPID credentials for Web Push. Keys are base64url; ``contact_email`` is a mailto target."""

    private_key: str
    public_key: str
    contact_email: str


_vapid_config: VapidConfig | None = None


def get_vapid_config() -> VapidConfig | None:
    """Return the cached VAPID config, or ``None`` when push is disabled."""
    return _vapid_config


async def load_vapid_config() -> None:
    """Load and cache VAPID settings from ``deployment_settings``; idempotent."""
    global _vapid_config

    if _vapid_config is not None:
        return

    try:
        from uniffy.core.config.settings import DeploymentSettingsOperations
        from uniffy.infrastructure.database.session import open_session

        async with open_session() as session:
            ops = DeploymentSettingsOperations(session)
            rows = await ops.get_namespace(PUSH_SETTINGS_NAMESPACE)
            public_row = rows.get(VAPID_PUBLIC_KEY)
            contact_row = rows.get(VAPID_CONTACT_EMAIL_KEY)
            private_key = await ops.get_secret(PUSH_SETTINGS_NAMESPACE, VAPID_PRIVATE_KEY)

            if public_row is None or contact_row is None or not private_key:
                logger.warning(
                    "VAPID settings not found in deployment_settings -- "
                    "push notifications disabled. "
                    "Run initial seed to generate VAPID keys."
                )
                return

            _vapid_config = VapidConfig(
                private_key=private_key,
                public_key=str(public_row.value),
                contact_email=str(contact_row.value),
            )
            logger.info("VAPID config loaded from deployment_settings")
    except Exception:
        logger.opt(exception=True).warning(
            "Failed to load VAPID config from database | push notifications disabled"
        )
