"""Seed mock notifications for UI testing.

Run with: uv run python -m uniffy.db.seed_notifications
"""

import asyncio
import random
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.types import NotificationType, generate_id
from uniffy.db.session import init_db, open_session

NOTIFICATION_TEMPLATES: list[dict] = [
    {
        "type": NotificationType.CONTENT_SHARED,
        "title": "{actor} shared a note with you",
        "body": "You have been given access to [[[Weekly Standup Notes|urn:uniffy:content:NOTE:{ref_id}]]]",  # noqa: E501
    },
    {
        "type": NotificationType.CONTENT_SHARED,
        "title": "{actor} shared a file with you",
        "body": "You now have access to [[[Q2 Budget Report.pdf|urn:uniffy:content:FILE:{ref_id}]]]",
    },
    {
        "type": NotificationType.CONTENT_MENTIONED,
        "title": "{actor} mentioned you in a note",
        "body": 'You were mentioned in [[[Architecture Decision Records|urn:uniffy:content:NOTE:{ref_id}]]]: "...we should ask {recipient} to review the API design..."',  # noqa: E501
    },
    {
        "type": NotificationType.CONTENT_MENTIONED,
        "title": "{actor} mentioned you in a comment",
        "body": 'In [[[Sprint Retrospective|urn:uniffy:content:NOTE:{ref_id}]]]: "{recipient} can you follow up on the deployment issue?"',  # noqa: E501
    },
    {
        "type": NotificationType.CONTENT_EDITED,
        "title": "{actor} edited a shared note",
        "body": "[[[API Documentation|urn:uniffy:content:NOTE:{ref_id}]]] was updated with new endpoint specifications",  # noqa: E501
    },
    {
        "type": NotificationType.CALENDAR_REMINDER,
        "title": "Upcoming: Team Sync in 15 minutes",
        "body": "[[[Team Sync|urn:uniffy:content:CALENDAR_EVENT:{ref_id}]]] starts at {event_time}. Location: Conference Room B",  # noqa: E501
    },
    {
        "type": NotificationType.CALENDAR_REMINDER,
        "title": "Upcoming: 1:1 with {actor} in 30 minutes",
        "body": "[[[1:1 Meeting|urn:uniffy:content:CALENDAR_EVENT:{ref_id}]]] starts soon. Agenda: quarterly goals review",  # noqa: E501
    },
    {
        "type": NotificationType.CALENDAR_INVITE,
        "title": "{actor} invited you to Design Review",
        "body": "You have been invited to [[[Design Review - Dashboard Overhaul|urn:uniffy:content:CALENDAR_EVENT:{ref_id}]]] on {event_date}",  # noqa: E501
    },
    {
        "type": NotificationType.CALENDAR_INVITE,
        "title": "{actor} invited you to Sprint Planning",
        "body": "New event: [[[Sprint 24 Planning|urn:uniffy:content:CALENDAR_EVENT:{ref_id}]]] scheduled for {event_date}",  # noqa: E501
    },
    {
        "type": NotificationType.CALENDAR_RESPONSE,
        "title": "{actor} accepted your event invitation",
        "body": "{actor} will attend [[[Product Demo|urn:uniffy:content:CALENDAR_EVENT:{ref_id}]]]",
    },
    {
        "type": NotificationType.PERMISSION_GRANTED,
        "title": "You have been granted Editor access",
        "body": "You now have Editor permissions on [[[Project Roadmap 2026|urn:uniffy:content:NOTE:{ref_id}]]]",  # noqa: E501
    },
    {
        "type": NotificationType.PERMISSION_REVOKED,
        "title": "Access to a file has been revoked",
        "body": "Your access to [[[Confidential HR Report.xlsx|urn:uniffy:content:FILE:{ref_id}]]] has been removed",  # noqa: E501
    },
    {
        "type": NotificationType.TASK_ASSIGNED,
        "title": "{actor} assigned you a task",
        "body": "New task: [[[Implement notification filtering|urn:uniffy:content:TASK:{ref_id}]]] in the Notifications Overhaul project",  # noqa: E501
    },
    {
        "type": NotificationType.TASK_ASSIGNED,
        "title": "{actor} assigned you a task",
        "body": "New task: [[[Review storage quota PR|urn:uniffy:content:TASK:{ref_id}]]] - needs review by end of day",  # noqa: E501
    },
    {
        "type": NotificationType.TASK_ASSIGNED,
        "title": "{actor} assigned you a task",
        "body": "New task: [[[Update dashboard widgets|urn:uniffy:content:TASK:{ref_id}]]] in the Dashboard Overhaul project",  # noqa: E501
    },
    {
        "type": NotificationType.TASK_DUE_SOON,
        "title": "Task due tomorrow: Fix sidebar toggle",
        "body": "[[[Fix sidebar toggle behavior|urn:uniffy:content:TASK:{ref_id}]]] is due tomorrow. Current status: In Progress",  # noqa: E501
    },
    {
        "type": NotificationType.TASK_DUE_SOON,
        "title": "Task due today: Deploy staging",
        "body": "[[[Deploy to staging environment|urn:uniffy:content:TASK:{ref_id}]]] is due today",
    },
    {
        "type": NotificationType.TASK_OVERDUE,
        "title": "Overdue: Write unit tests for quota operations",
        "body": "[[[Write unit tests for quota operations|urn:uniffy:content:TASK:{ref_id}]]] was due 2 days ago",  # noqa: E501
    },
    {
        "type": NotificationType.CHAT_MENTION,
        "title": "{actor} mentioned you in #engineering",
        "body": '"Hey {recipient}, can you check the CI pipeline? The build is failing on the notifications branch."',  # noqa: E501
    },
    {
        "type": NotificationType.CHAT_DM,
        "title": "{actor} sent you a direct message",
        "body": '"Quick question about the dashboard layout - are we keeping the 4-column grid or switching to 3?"',  # noqa: E501
    },
    {
        "type": NotificationType.CHAT_CHANNEL_INVITE,
        "title": "{actor} added you to #design-system",
        "body": "You have been added to the #design-system channel. 12 members, 43 unread messages",
    },
    {
        "type": NotificationType.CHAT_THREAD_REPLY,
        "title": "{actor} replied to your thread",
        "body": 'In #engineering: "{actor}: I agree, we should use the same sidebar pattern for all domains."',  # noqa: E501
    },
    {
        "type": NotificationType.SYSTEM_ANNOUNCEMENT,
        "title": "Scheduled maintenance tonight at 2:00 AM UTC",
        "body": "The platform will undergo maintenance for approximately 30 minutes. All changes will be saved automatically.",  # noqa: E501
    },
    {
        "type": NotificationType.SYSTEM_ANNOUNCEMENT,
        "title": "New feature: Recursive folder upload",
        "body": "You can now upload entire folders with their directory structure preserved. Drag and drop a folder onto the Files page to try it out.",  # noqa: E501
    },
]


def _random_past_time(max_days_ago: int = 30) -> datetime:
    seconds_ago = random.randint(60, max_days_ago * 24 * 60 * 60)
    return datetime.now(UTC) - timedelta(seconds=seconds_ago)


def _format_event_time() -> str:
    hour = random.choice([9, 10, 11, 13, 14, 15, 16])
    minute = random.choice([0, 15, 30, 45])
    return f"{hour}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


def _format_event_date() -> str:
    days_ahead = random.randint(1, 14)
    future = datetime.now(UTC) + timedelta(days=days_ahead)
    return future.strftime("%A, %B %d")


async def seed_notifications() -> None:
    """Insert mock notifications into the database."""
    await init_db(skip_migrations=True)

    async with open_session() as session:
        result = await session.execute(select(Organization).limit(1))
        org = result.scalar_one_or_none()
        if not org:
            logger.error("No organization found. Run the main seed first.")
            return

        result = await session.execute(select(User).where(User.is_active.is_(True)).limit(10))
        users = result.scalars().all()
        if len(users) < 2:
            logger.error("Need at least 2 users. Run the main seed first.")
            return

        logger.info(
            "Seeding notifications for org '{}' with {} users",
            org.name,
            len(users),
        )

        notifications_created = 0

        for recipient in users:
            other_users = [u for u in users if u.id != recipient.id]
            if not other_users:
                continue

            count = random.randint(15, 30)
            templates = random.sample(
                NOTIFICATION_TEMPLATES,
                min(count, len(NOTIFICATION_TEMPLATES)),
            )
            if count > len(templates):
                templates += random.choices(NOTIFICATION_TEMPLATES, k=count - len(templates))

            for template in templates:
                actor = random.choice(other_users)
                ref_id = str(generate_id())
                created_at = _random_past_time(max_days_ago=30)
                is_read = random.random() < 0.4
                read_at = created_at + timedelta(minutes=random.randint(5, 600)) if is_read else None

                actor_name = actor.full_name or actor.username
                recipient_name = (
                    recipient.full_name.split(" ")[0] if recipient.full_name else recipient.username
                )

                title = template["title"].format(
                    actor=actor_name,
                    recipient=recipient_name,
                )
                body = template["body"].format(
                    actor=actor_name,
                    recipient=recipient_name,
                    ref_id=ref_id,
                    event_time=_format_event_time(),
                    event_date=_format_event_date(),
                )

                source_urn = None
                if "urn:uniffy:content:" in body:
                    start = body.index("urn:uniffy:content:")
                    end = body.index("]]]", start)
                    source_urn = body[start:end]

                has_actor = template["type"] not in (
                    NotificationType.SYSTEM_ANNOUNCEMENT,
                    NotificationType.TASK_DUE_SOON,
                    NotificationType.TASK_OVERDUE,
                    NotificationType.CALENDAR_REMINDER,
                )

                notification = Notification(
                    id=generate_id(),
                    organization_id=org.id,
                    user_id=recipient.id,
                    notification_type=template["type"],
                    title=title,
                    body=body,
                    source_urn=source_urn,
                    actor_id=actor.id if has_actor else None,
                    is_read=is_read,
                    read_at=read_at,
                    created_at=created_at,
                )
                session.add(notification)
                notifications_created += 1

        await session.commit()
        logger.info("Created {} mock notifications", notifications_created)


if __name__ == "__main__":
    asyncio.run(seed_notifications())
