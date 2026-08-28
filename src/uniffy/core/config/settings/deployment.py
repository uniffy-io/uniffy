"""Deployment-scoped encrypted settings storage."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import (
    DeploymentCipher,
    DeploymentReEncryptingConsumer,
    register_deployment_consumer,
)
from uniffy.core.models.settings.deployment_setting import DeploymentSetting


class DeploymentSettingsOperations:
    """Deployment-wide per-namespace key-value store."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._cipher = DeploymentCipher(session)

    async def get_namespace(self, namespace: str) -> dict[str, DeploymentSetting]:
        """Returns {key: row} with ciphertext intact; plaintext requires get_secret."""
        rows = (
            (
                await self._session.execute(
                    select(DeploymentSetting).where(DeploymentSetting.namespace == namespace)
                )
            )
            .scalars()
            .all()
        )
        return {row.key: row for row in rows}

    async def get_secret(self, namespace: str, key: str) -> str | None:
        """Decrypted plaintext for one secret row, or None."""
        row = (
            await self._session.execute(
                select(DeploymentSetting).where(
                    DeploymentSetting.namespace == namespace,
                    DeploymentSetting.key == key,
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.is_secret or row.value_encrypted is None:
            return None
        return await self._cipher.decrypt(row.value_encrypted)

    async def set(
        self,
        *,
        namespace: str,
        key: str,
        value: Any,
        is_secret: bool = False,
        updated_by_user_id: UUID | None = None,
    ) -> None:
        """Upsert one row; secrets encrypted into value_encrypted, plain JSON into value."""
        plain: Any | None = None
        ciphertext: str | None = None
        if is_secret:
            if not isinstance(value, str):
                raise TypeError(
                    f"Secret deployment_setting {namespace}.{key} must be a string; "
                    f"got {type(value).__name__}"
                )
            ciphertext = await self._cipher.encrypt(value)
        else:
            plain = value

        stmt = (
            pg_insert(DeploymentSetting)
            .values(
                namespace=namespace,
                key=key,
                value=plain,
                value_encrypted=ciphertext,
                is_secret=is_secret,
                updated_by_user_id=updated_by_user_id,
            )
            .on_conflict_do_update(
                index_elements=["namespace", "key"],
                set_={
                    "value": plain,
                    "value_encrypted": ciphertext,
                    "is_secret": is_secret,
                    "updated_by_user_id": updated_by_user_id,
                },
            )
        )
        await self._session.execute(stmt)

    async def delete_key(self, *, namespace: str, key: str) -> bool:
        result = await self._session.execute(
            delete(DeploymentSetting).where(
                DeploymentSetting.namespace == namespace,
                DeploymentSetting.key == key,
            )
        )
        return (result.rowcount or 0) > 0

    async def delete_namespace(self, namespace: str) -> int:
        result = await self._session.execute(
            delete(DeploymentSetting).where(DeploymentSetting.namespace == namespace)
        )
        return int(result.rowcount or 0)


async def _list_deployment_secret_rows(
    session: AsyncSession,
) -> AsyncIterator[DeploymentSetting]:
    # Used by deployment-DEK rotation.
    result = await session.execute(
        select(DeploymentSetting).where(
            DeploymentSetting.is_secret == True  # noqa: E712
        )
    )
    for row in result.scalars():
        yield row


def _deployment_setting_get_ciphertext(row: DeploymentSetting) -> str:
    assert row.value_encrypted is not None
    return row.value_encrypted


def _deployment_setting_set_ciphertext(row: DeploymentSetting, ciphertext: str) -> None:
    row.value_encrypted = ciphertext


register_deployment_consumer(
    DeploymentReEncryptingConsumer(
        name="deployment_settings",
        table_name="deployment_settings",
        list_rows=_list_deployment_secret_rows,
        get_ciphertext=_deployment_setting_get_ciphertext,
        set_ciphertext=_deployment_setting_set_ciphertext,
    )
)
