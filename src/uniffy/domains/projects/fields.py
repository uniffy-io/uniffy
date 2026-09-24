"""Custom field definitions on a project."""

import secrets
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.domains.projects.projects import ProjectOperations

DEFAULT_CUSTOM_FIELD_SORT_ORDER = 999


class FieldOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

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
        """Requires manage on the parent project."""
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        await project_ops._require_manage(user_id, organization_id, project)

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
