"""VAPID key configuration for Web Push.

Keys are auto-generated on initial DB seed and stored encrypted in
``application_settings``. Manual generation: ``uv run -m uniffy.scripts.generate_vapid``.
"""

from dataclasses import dataclass

from loguru import logger


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
    """Load and cache VAPID settings from ``application_settings``; idempotent."""
    global _vapid_config

    if _vapid_config is not None:
        return

    try:
        from sqlalchemy import select

        from uniffy.core.crypto import app_decrypt
        from uniffy.core.models.app_settings.application_setting import (
            ApplicationSetting,
        )
        from uniffy.db.session import open_session

        async with open_session() as session:
            result = await session.execute(
                select(ApplicationSetting).where(
                    ApplicationSetting.key.in_([
                        "vapid_private_key",
                        "vapid_public_key",
                        "vapid_contact_email",
                    ])
                )
            )
            rows = {row.key: row for row in result.scalars().all()}

            if len(rows) < 3:
                logger.warning(
                    "VAPID settings not found in database -- "
                    "push notifications disabled. "
                    "Run initial seed to generate VAPID keys."
                )
                return

            private_key_row = rows["vapid_private_key"]
            private_key = (
                app_decrypt(private_key_row.value)
                if private_key_row.is_encrypted
                else private_key_row.value
            )

            _vapid_config = VapidConfig(
                private_key=private_key,
                public_key=rows["vapid_public_key"].value,
                contact_email=rows["vapid_contact_email"].value,
            )
            logger.info("VAPID config loaded from application_settings table")
    except Exception:
        logger.opt(exception=True).warning(
            "Failed to load VAPID config from database -- push notifications disabled"
        )
