"""VAPID key configuration for Web Push notifications.

Keys are auto-generated during initial DB seed and stored encrypted
in ``application_settings``.

Generate keys manually:

    uv run -m uniffy.scripts.generate_vapid
"""

from dataclasses import dataclass

from loguru import logger


@dataclass(frozen=True)
class VapidConfig:
    """VAPID credentials for Web Push.

    Attributes
    ----------
    private_key : str
        Base64url-encoded VAPID private key.
    public_key : str
        Base64url-encoded VAPID public key.
    contact_email : str
        Contact email for VAPID claims (mailto: URI).

    """

    private_key: str
    public_key: str
    contact_email: str


_vapid_config: VapidConfig | None = None


def get_vapid_config() -> VapidConfig | None:
    """Return the cached VAPID configuration.

    Call ``load_vapid_config()`` during application startup before
    using this function.  If no configuration has been loaded, returns
    ``None`` (push notifications disabled).

    Returns
    -------
    VapidConfig | None
        The VAPID configuration, or None if not yet loaded / unavailable.

    """
    return _vapid_config


async def load_vapid_config() -> None:
    """Load VAPID configuration from the database.

    Reads ``vapid_private_key``, ``vapid_public_key``, and
    ``vapid_contact_email`` from the ``application_settings`` table
    (seeded during first run).

    The result is cached in module-level ``_vapid_config`` so that the
    synchronous ``get_vapid_config()`` can return it without I/O.

    This function is safe to call multiple times; it will not reload
    once a config is cached.
    """
    global _vapid_config

    if _vapid_config is not None:
        return

    try:
        from sqlalchemy import select

        from uniffy.core.crypto import decrypt_value
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
                decrypt_value(private_key_row.value)
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
