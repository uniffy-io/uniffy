"""Custom field definitions on a project."""

import secrets
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
)
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.status_colors import assign_status_colors
from uniffy.domains.projects.statuses import (
    ensure_removed_statuses_unused,
    parse_task_status_semantics,
)

DEFAULT_CUSTOM_FIELD_SORT_ORDER = 999


class _ConfigUnset(Enum):
    VALUE = "unset"


class ProjectFieldOperations:
    """Every change requires manage on the parent project."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _require_project_manage(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> None:
        await ProjectOperations(self.session).get_for_manage(user_id, organization_id, project_id)

    async def _load(self, project_id: UUID, field_id: str) -> FieldDefinition:
        field = await self.session.scalar(
            select(FieldDefinition).where(
                FieldDefinition.id == field_id,
                FieldDefinition.project_id == project_id,
            )
        )
        if field is None:
            raise NotFoundError("Field", field_id)
        return field

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        *,
        name: str,
        field_type: ProjectFieldType | str,
        config: dict[str, Any] | None = None,
        is_required: bool = False,
        sort_order: int = DEFAULT_CUSTOM_FIELD_SORT_ORDER,
    ) -> FieldDefinition:
        await self._require_project_manage(user_id, organization_id, project_id)

        field = FieldDefinition(
            id=f"field_{secrets.token_hex(8)}",
            project_id=project_id,
            name=name,
            type=field_type,
            is_required=is_required,
            is_system=False,
            sort_order=sort_order,
            config=config or None,
        )
        self.session.add(field)
        await self.session.commit()
        await self.session.refresh(field)
        return field

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        field_id: str,
        *,
        name: str | None = None,
        is_required: bool | None = None,
        sort_order: int | None = None,
        config: dict[str, Any] | None | _ConfigUnset = _ConfigUnset.VALUE,
    ) -> FieldDefinition:
        """A status config must keep explicit semantics and every option live tasks still use."""
        await self._require_project_manage(user_id, organization_id, project_id)
        field = await self._load(project_id, field_id)

        if name is not None:
            field.name = name
        if is_required is not None:
            field.is_required = is_required
        if sort_order is not None:
            field.sort_order = sort_order
        if not isinstance(config, _ConfigUnset):
            if field.id == SystemProjectFieldId.STATUS:
                status_config = config or {}
                parse_task_status_semantics(status_config, require_explicit=True)
                await ensure_removed_statuses_unused(
                    self.session, project_id, field.config, status_config
                )
                config = assign_status_colors(status_config)
            field.config = config
            flag_modified(field, "config")

        field.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(field)
        return field

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        field_id: str,
    ) -> None:
        await self._require_project_manage(user_id, organization_id, project_id)
        field = await self._load(project_id, field_id)
        if field.is_system:
            raise ValidationError("field", "Cannot delete system field")
        await self.session.delete(field)
        await self.session.commit()
