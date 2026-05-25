"""CRUD on the generic ``org_settings`` KV table.

Domain wrappers (e.g. ``OrgMailOperations``) call into this class with
a fixed ``namespace`` plus per-key validators. Secrets are encrypted
through ``OrgCipher`` on write and never round-trip through the public
read path -- ``get_namespace`` returns the ``OrgSetting`` row as-is
(``value_encrypted`` is the ciphertext) and callers explicitly opt
into decryption via ``get_secret``.

A single ``ReEncryptingConsumer`` is registered at module import for
``WHERE is_secret = true``; every future encrypted setting rotates
with the per-org DEK with zero additional plumbing.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import OrgCipher, ReEncryptingConsumer, register_consumer
from uniffy.core.models.settings.org_setting import OrgSetting


class OrgSettingsOperations:
    """Per-namespace key-value store backed by ``org_settings``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._cipher = OrgCipher(session)

    async def get_namespace(
        self,
        organization_id: UUID,
        namespace: str,
    ) -> dict[str, OrgSetting]:
        """Return ``{key: OrgSetting}`` for one (org, namespace) pair.

        Ciphertext is left in ``row.value_encrypted`` -- callers that
        need the plaintext must call ``get_secret`` explicitly.
        """
        rows = (
            await self._session.execute(
                select(OrgSetting).where(
                    OrgSetting.organization_id == organization_id,
                    OrgSetting.namespace == namespace,
                )
            )
        ).scalars().all()
        return {row.key: row for row in rows}

    async def get_secret(
        self,
        organization_id: UUID,
        namespace: str,
        key: str,
    ) -> str | None:
        """Return the decrypted plaintext for one secret row or ``None``."""
        row = (
            await self._session.execute(
                select(OrgSetting).where(
                    OrgSetting.organization_id == organization_id,
                    OrgSetting.namespace == namespace,
                    OrgSetting.key == key,
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.is_secret or row.value_encrypted is None:
            return None
        return await self._cipher.decrypt(organization_id, row.value_encrypted)

    async def set(
        self,
        *,
        organization_id: UUID,
        namespace: str,
        key: str,
        value: Any,
        is_secret: bool = False,
        updated_by_user_id: UUID | None = None,
    ) -> None:
        """Upsert one row. Secrets are encrypted via ``OrgCipher``.

        For ``is_secret=False`` rows the JSON-able ``value`` is stored
        in the plaintext ``value`` JSONB column. For secrets the value
        must be a string; it is encrypted and stored in
        ``value_encrypted`` (the ``value`` column is left NULL to
        satisfy the CHECK constraint).
        """
        plain: Any | None = None
        ciphertext: str | None = None
        if is_secret:
            if not isinstance(value, str):
                raise TypeError(
                    f"Secret org_setting {namespace}.{key} must be a string; "
                    f"got {type(value).__name__}"
                )
            ciphertext = await self._cipher.encrypt(organization_id, value)
        else:
            plain = value

        stmt = (
            pg_insert(OrgSetting)
            .values(
                organization_id=organization_id,
                namespace=namespace,
                key=key,
                value=plain,
                value_encrypted=ciphertext,
                is_secret=is_secret,
                updated_by_user_id=updated_by_user_id,
            )
            .on_conflict_do_update(
                index_elements=["organization_id", "namespace", "key"],
                set_={
                    "value": plain,
                    "value_encrypted": ciphertext,
                    "is_secret": is_secret,
                    "updated_by_user_id": updated_by_user_id,
                },
            )
        )
        await self._session.execute(stmt)

    async def delete_key(
        self,
        *,
        organization_id: UUID,
        namespace: str,
        key: str,
    ) -> bool:
        """Drop one row. Returns True when a row was deleted."""
        result = await self._session.execute(
            delete(OrgSetting).where(
                OrgSetting.organization_id == organization_id,
                OrgSetting.namespace == namespace,
                OrgSetting.key == key,
            )
        )
        return (result.rowcount or 0) > 0

    async def delete_namespace(
        self,
        *,
        organization_id: UUID,
        namespace: str,
    ) -> int:
        """Drop every row for one (org, namespace) pair. Returns count."""
        result = await self._session.execute(
            delete(OrgSetting).where(
                OrgSetting.organization_id == organization_id,
                OrgSetting.namespace == namespace,
            )
        )
        return int(result.rowcount or 0)


async def _list_secret_rows_for_org(
    session: AsyncSession,
    organization_id: UUID,
) -> AsyncIterator[OrgSetting]:
    """Yield every ``is_secret=true`` row for one org; used by rotation."""
    result = await session.execute(
        select(OrgSetting).where(
            OrgSetting.organization_id == organization_id,
            OrgSetting.is_secret == True,  # noqa: E712
        )
    )
    for row in result.scalars():
        yield row


def _org_setting_get_ciphertext(row: OrgSetting) -> str:
    assert row.value_encrypted is not None
    return row.value_encrypted


def _org_setting_set_ciphertext(row: OrgSetting, ciphertext: str) -> None:
    row.value_encrypted = ciphertext


register_consumer(
    ReEncryptingConsumer(
        name="org_settings",
        table_name="org_settings",
        list_rows=_list_secret_rows_for_org,
        get_ciphertext=_org_setting_get_ciphertext,
        set_ciphertext=_org_setting_set_ciphertext,
    )
)
