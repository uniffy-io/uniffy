"""Task activity and notification side effects."""

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition, SystemProjectFieldId
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.projects.watchers import WatcherOperations


class TaskNotifications:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def resolve_field_option_labels(
        self,
        project_id: UUID,
        status_id: str,
        priority_id: str,
    ) -> dict[str, str]:
        stmt = select(FieldDefinition.id, FieldDefinition.config).where(
            FieldDefinition.project_id == project_id,
            FieldDefinition.id.in_([
                SystemProjectFieldId.STATUS,
                SystemProjectFieldId.PRIORITY,
            ]),
        )
        result = await self.session.execute(stmt)
        resolved: dict[str, str] = {}
        for row in result.all():
            options = (row.config or {}).get("options", [])
            target_id = status_id if row.id == SystemProjectFieldId.STATUS else priority_id
            prefix = "status" if row.id == SystemProjectFieldId.STATUS else "priority"
            for opt in options:
                if opt.get("id") == target_id:
                    resolved[f"{prefix}_label"] = opt.get("label", "")
                    resolved[f"{prefix}_color"] = opt.get("color", "")
                    break
        return resolved

    async def expand_assignees_to_users(
        self, organization_id: UUID, assignee_ids: list[UUID]
    ) -> list[UUID]:
        """Expand any group ids among assignees into active member user ids.

        Assignees can be users or groups (the picker allows both), but only active members of
        the task's organization can hold a watcher row or receive a notification.
        """
        if not assignee_ids:
            return []

        group_rows = await self.session.execute(
            select(Group.id).where(
                and_(Group.id.in_(assignee_ids), Group.organization_id == organization_id)
            )
        )
        group_ids = {row[0] for row in group_rows.all()}

        resolved: set[UUID] = {uid for uid in assignee_ids if uid not in group_ids}

        if group_ids:
            member_rows = await self.session.execute(
                select(GroupMember.user_id).where(
                    and_(
                        GroupMember.group_id.in_(group_ids),
                        GroupMember.is_active.is_(True),
                    )
                )
            )
            resolved.update(row[0] for row in member_rows.all())
        if not resolved:
            return []

        members = await self.session.execute(
            select(OrganizationMember.user_id).where(
                and_(
                    OrganizationMember.user_id.in_(resolved),
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active.is_(True),
                )
            )
        )
        return [row[0] for row in members.all()]

    async def emit_assignment_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_assignee_ids: list[str] | None,
        new_assignee_ids: list[str] | None,
    ) -> None:
        old_set = set(old_assignee_ids or [])
        new_set = set(new_assignee_ids or [])
        added = new_set - old_set

        if not added:
            return

        recipient_ids = await self.expand_assignees_to_users(
            task.organization_id, [UUID(uid) for uid in added]
        )
        recipient_ids = [uid for uid in recipient_ids if uid != actor_id]

        if not recipient_ids:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TASK_ASSIGNED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Assigned you to: {task.title}",
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=recipient_ids,
            )
        )

    async def emit_mention_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_references: list[str] | None,
        new_references: list[str] | None,
    ) -> None:
        old_mentioned = extract_mentioned_user_ids(old_references)
        new_mentioned = extract_mentioned_user_ids(new_references)
        newly_mentioned = new_mentioned - old_mentioned
        newly_mentioned.discard(actor_id)

        source_urn = build_content_urn(ContentType.TASK, task.id)

        if newly_mentioned:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=task.organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned you in: {task.title}",
                    source_urn=source_urn,
                    target_user_ids=list(newly_mentioned),
                )
            )

        already_mentioned_teams = set(extract_mentioned_team_ids(old_references))
        newly_mentioned_teams = [
            tid
            for tid in extract_mentioned_team_ids(new_references)
            if tid not in already_mentioned_teams
        ]
        if not newly_mentioned_teams:
            return

        notified = {actor_id} | newly_mentioned
        expansions = await expand_team_mentions(
            self.session, task.organization_id, newly_mentioned_teams
        )
        for expansion in expansions:
            targets = [uid for uid in expansion.member_ids if uid not in notified]
            if not targets:
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=task.organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned {expansion.name} in: {task.title}",
                    source_urn=source_urn,
                    target_user_ids=targets,
                    metadata={
                        "team_id": str(expansion.team_id),
                        "team_name": expansion.name,
                    },
                )
            )
            notified.update(targets)

    async def emit_watcher_notifications(
        self,
        task: Task,
        actor_id: UUID,
        change_description: str,
    ) -> None:
        watcher_ops = WatcherOperations(self.session)
        watcher_ids = await watcher_ops.get_watcher_user_ids(task.id)
        watcher_ids = [w for w in watcher_ids if w != actor_id]

        if not watcher_ids:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_EDITED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Task updated: {task.title}",
                body=change_description,
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=watcher_ids,
            )
        )

    async def log_activity(
        self,
        task_id: UUID,
        actor_id: UUID,
        action: str,
        field_id: str | None = None,
        previous_value: str | None = None,
        new_value: str | None = None,
    ) -> TaskActivity:
        activity = TaskActivity(
            task_id=task_id,
            actor_id=actor_id,
            action=action,
            field_id=field_id,
            previous_value=previous_value,
            new_value=new_value,
        )
        self.session.add(activity)
        await self.session.flush()
        return activity
