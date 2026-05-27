"""Seed mock data so the dashboard widgets render with content on first load.

Run with: ``uv run python -m uniffy.db.seed_dashboard``.
"""

import asyncio
import random
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, generate_id
from uniffy.db.session import init_db, open_session


def _rand_past(max_days: int = 14) -> datetime:
    return datetime.now(UTC) - timedelta(
        days=random.randint(0, max_days),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )


def _today_at(hour: int, minute: int = 0) -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _slugify(text: str) -> str:
    return text.lower().replace(" ", "-").replace(".", "")[:500]


NOTE_DATA = [
    (
        "Q2 Product Roadmap",
        "## Goals\n\nShip the unified workspace by end of Q2.\n\n"
        "- Notes domain\n- Files domain\n- Calendar integration\n"
        "- Agent engine MVP\n\n## Milestones\n\n"
        "1. Beta launch: May 15\n2. Public launch: June 30",
    ),
    (
        "Architecture Decision Records",
        "## ADR-001: Use ConnectRPC\n\n**Status:** Accepted\n\n"
        "**Context:** We need a strongly-typed API layer.\n\n"
        "**Decision:** Adopt ConnectRPC with Protocol Buffers.\n\n"
        "**Consequences:** Better type safety, code generation.",
    ),
    (
        "Weekly Standup Notes",
        "## April 14, 2026\n\n"
        "**Done:** Notification panel redesign, folder uploads\n"
        "**Doing:** Dashboard overhaul, trash page\n"
        "**Blocked:** Waiting on S3 bucket config for prod",
    ),
    (
        "Meeting Notes: Design Review",
        "## Attendees\n\n- Sarah, James, Alex\n\n## Discussion\n\n"
        "- Dashboard widget layout approved\n"
        "- Calendar view needs mobile optimization\n"
        "- File preview cards look great\n\n## Action Items\n\n"
        "- [ ] James: Update Figma with final palette\n"
        "- [ ] Alex: Benchmark search latency",
    ),
    (
        "API Documentation",
        "## Authentication\n\nAll endpoints require a Bearer token.\n\n"
        "## Endpoints\n\n### POST /auth/login\n\n"
        "Returns access and refresh tokens.\n\n"
        "### GET /users/me\n\nReturns the current user profile.",
    ),
    (
        "Sprint 24 Retrospective",
        "## What went well\n\n- Shipped notifications on time\n"
        "- Zero regressions in file uploads\n"
        "- Team velocity up 15%\n\n## What to improve\n\n"
        "- E2E test coverage for calendar\n"
        "- Better error messages in agents domain",
    ),
    (
        "Onboarding Checklist",
        "## New Member Setup\n\n"
        "- [ ] Create account and join organization\n"
        "- [ ] Set up 2FA\n"
        "- [ ] Join #general and #engineering channels\n"
        "- [ ] Review coding standards doc\n"
        "- [ ] Complete first PR",
    ),
    (
        "Research: Real-time Collaboration",
        "## Options\n\n1. **Yjs** - CRDT-based, mature\n"
        "2. **Automerge** - Rust core, newer\n"
        "3. **Custom OT** - Full control, high effort\n\n"
        "## Recommendation\n\nGo with Yjs. Mature ecosystem.",
    ),
]

FILE_DATA = [
    ("Q2-Budget-Report.pdf", "application/pdf", 2_450_000),
    ("team-photo-offsite.jpg", "image/jpeg", 3_200_000),
    ("architecture-diagram.png", "image/png", 890_000),
    ("deployment-guide.md", "text/markdown", 15_000),
    ("sprint-velocity.csv", "text/csv", 8_500),
    ("product-demo-recording.mp4", "video/mp4", 145_000_000),
    ("brand-guidelines.pdf", "application/pdf", 5_600_000),
    ("api-schema.json", "application/json", 42_000),
    (
        "user-research-findings.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        1_200_000,
    ),
    (
        "quarterly-metrics.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        780_000,
    ),
]

FOLDER_DATA = [
    "Documents",
    "Images",
    "Reports",
    "Design Assets",
]

PROJECT_DATA = [
    ("Uniffy Platform", "UAI", "#3b82f6", "Core platform development"),
    ("Marketing Site", "MKT", "#10b981", "Public website and landing pages"),
    ("Mobile App", "MOB", "#8b5cf6", "React Native mobile application"),
]

TASK_DATA = [
    ("Implement file preview cards", "status_done", "priority_high", "task", -3),
    ("Fix notification badge count", "status_done", "priority_medium", "bug", -5),
    ("Add calendar week view", "status_in_progress", "priority_high", "feature", 2),
    ("Optimize search indexing", "status_in_progress", "priority_medium", "task", 4),
    ("Write E2E tests for auth flow", "status_todo", "priority_medium", "task", 7),
    ("Design settings page mobile layout", "status_todo", "priority_low", "task", 10),
    ("Migrate to ConnectRPC v2", "status_todo", "priority_high", "feature", 14),
    ("Update user avatar upload", "status_in_progress", "priority_medium", "task", 1),
    ("Fix timezone handling in calendar", "status_todo", "priority_high", "bug", 0),
    ("Add bulk file download as ZIP", "status_done", "priority_medium", "feature", -1),
    ("Review PR: dashboard widgets", "status_in_progress", "priority_high", "task", 0),
    ("Setup CI/CD pipeline for mobile", "status_todo", "priority_low", "task", 21),
]

CATEGORY_DATA = [
    ("Meeting", "#3B82F6", None),
    ("Focus Time", "#10B981", None),
    ("Social", "#F59E0B", None),
    ("Review", "#8B5CF6", None),
    ("External", "#F43F5E", None),
]

EVENT_DATA = [
    ("Team Standup", 0, 9, 0, 9, 30, False, "Meeting", "Daily sync with the engineering team"),
    ("1:1 with Sarah", 0, 10, 0, 10, 30, False, "Meeting", "Weekly check-in"),
    (
        "Deep Work: Search Optimization",
        0,
        14,
        0,
        16,
        0,
        False,
        "Focus Time",
        "Uninterrupted coding block for search",
    ),
    ("Design Review", 1, 11, 0, 12, 0, False, "Review", "Review dashboard redesign mockups"),
    ("Sprint Planning", 1, 14, 0, 15, 30, False, "Meeting", "Plan Sprint 25 scope and assignments"),
    ("Lunch with Marketing", 2, 12, 0, 13, 0, False, "Social", "Cross-team lunch at the office"),
    ("Code Review Session", 2, 15, 0, 16, 0, False, "Review", "Review open PRs before release"),
    ("Product Demo", 3, 16, 0, 17, 0, False, "External", "Demo new features to stakeholders"),
    ("Company All-Hands", 4, 10, 0, 11, 0, False, "Meeting", "Monthly company update"),
    ("Hackathon Kickoff", 5, 9, 0, 9, 0, True, "Social", "Spring 2026 hackathon"),
]


async def seed_dashboard() -> None:
    """Seed the database with mock data for dashboard widgets."""
    await init_db(skip_migrations=True)

    async with open_session() as session:
        result = await session.execute(select(Organization).limit(1))
        org = result.scalar_one_or_none()
        if not org:
            logger.error("No organization found. Run the main seed first.")
            return

        result = await session.execute(select(User).where(User.is_active.is_(True)).limit(10))
        users = list(result.scalars().all())
        if not users:
            logger.error("No users found. Run the main seed first.")
            return

        primary_user = users[0]
        logger.info(
            "Seeding dashboard data for org '{}', primary user '{}'",
            org.name,
            primary_user.full_name or primary_user.username,
        )

        now = datetime.now(UTC)
        bookmark_urns: list[str] = []

        note_ids = []
        for title, content in NOTE_DATA:
            note_id = generate_id()
            note_ids.append(note_id)
            owner = random.choice(users)
            created = _rand_past(14)
            note = Note(
                id=note_id,
                organization_id=org.id,
                owner_id=owner.id,
                access_mode=AccessMode.OPEN_TO_ORG,
                title=title,
                content=content,
                slug=_slugify(title),
                created_at=created,
                updated_at=created + timedelta(hours=random.randint(1, 48)),
            )
            session.add(note)
            if random.random() < 0.4:
                bookmark_urns.append(f"urn:uniffy:content:NOTE:{note_id}")

        await session.flush()
        logger.info("Created {} notes", len(NOTE_DATA))

        folder_ids = []
        for name in FOLDER_DATA:
            folder_id = generate_id()
            folder_ids.append(folder_id)
            folder = Folder(
                id=folder_id,
                organization_id=org.id,
                owner_id=primary_user.id,
                access_mode=AccessMode.OWNER_ONLY,
                name=name,
                created_at=_rand_past(30),
                updated_at=now,
            )
            session.add(folder)

        await session.flush()
        logger.info("Created {} folders", len(FOLDER_DATA))

        file_ids = []
        for filename, mime, size in FILE_DATA:
            file_id = generate_id()
            file_ids.append(file_id)
            owner = random.choice(users)
            created = _rand_past(14)
            f = File(
                id=file_id,
                organization_id=org.id,
                owner_id=owner.id,
                access_mode=AccessMode.OPEN_TO_ORG,
                filename=filename,
                original_filename=filename,
                mime_type=mime,
                size_bytes=size,
                storage_key=f"mock/{org.id}/{file_id}/{filename}",
                storage_bucket="uniffy-files",
                folder_id=random.choice(folder_ids) if random.random() < 0.6 else None,
                extraction_status="SKIPPED",
                created_at=created,
                updated_at=created + timedelta(hours=random.randint(0, 24)),
            )
            session.add(f)
            if random.random() < 0.3:
                bookmark_urns.append(f"urn:uniffy:content:FILE:{file_id}")

        await session.flush()
        logger.info("Created {} files", len(FILE_DATA))

        category_map: dict[str, Category] = {}
        for name, color, icon in CATEGORY_DATA:
            cat = Category(
                id=generate_id(),
                organization_id=org.id,
                name=name,
                color=color,
                icon=icon,
                is_default=(name == "Meeting"),
            )
            session.add(cat)
            category_map[name] = cat

        await session.flush()
        logger.info("Created {} calendar categories", len(CATEGORY_DATA))

        calendar = Calendar(
            id=generate_id(),
            organization_id=org.id,
            owner_id=primary_user.id,
            name="My Calendar",
            color="#3B82F6",
            is_default=True,
            calendar_type="PERSONAL",
            access_mode=AccessMode.OPEN_TO_ORG,
        )
        session.add(calendar)
        await session.flush()
        logger.info("Created calendar for primary user")

        event_ids = []
        for title, day_offset, sh, sm, eh, em, all_day, cat_name, desc in EVENT_DATA:
            event_id = generate_id()
            event_ids.append(event_id)
            base_date = now + timedelta(days=day_offset)
            start = base_date.replace(hour=sh, minute=sm, second=0, microsecond=0)
            end = base_date.replace(hour=eh, minute=em, second=0, microsecond=0)
            if all_day:
                end = start + timedelta(days=1)

            cat = category_map.get(cat_name)
            event = CalendarEvent(
                id=event_id,
                organization_id=org.id,
                organizer_id=primary_user.id,
                calendar_id=calendar.id,
                category_id=cat.id if cat else None,
                title=title,
                description=desc,
                start_time=start,
                end_time=end,
                is_all_day=all_day,
                access_mode=AccessMode.OPEN_TO_ORG,
                reminders=[15],
                created_at=now - timedelta(days=7),
                updated_at=now - timedelta(days=1),
            )
            session.add(event)

        await session.flush()
        logger.info("Created {} calendar events", len(EVENT_DATA))

        project_objs: list[Project] = []
        for name, slug, color, desc in PROJECT_DATA:
            project = Project(
                id=generate_id(),
                organization_id=org.id,
                owner_id=primary_user.id,
                access_mode=AccessMode.OPEN_TO_ORG,
                name=name,
                description=desc,
                slug=slug,
                color=color,
                task_counter=0,
                created_at=now - timedelta(days=60),
                updated_at=now - timedelta(days=1),
            )
            session.add(project)
            project_objs.append(project)

        await session.flush()
        logger.info("Created {} projects", len(PROJECT_DATA))

        task_counter: dict[str, int] = {}
        for title, status, priority, task_type, due_offset in TASK_DATA:
            project = random.choice(project_objs)
            slug = project.slug
            task_counter[slug] = task_counter.get(slug, 0) + 1

            due_date = None
            if due_offset >= 0:
                due_date = (now + timedelta(days=due_offset)).strftime("%Y-%m-%d")
            completed_at = _rand_past(3) if status == "status_done" else None
            created = _rand_past(14)

            assignees = [str(primary_user.id)]
            if len(users) > 1 and random.random() < 0.3:
                assignees.append(str(random.choice(users[1:]).id))

            task = Task(
                id=generate_id(),
                project_id=project.id,
                organization_id=org.id,
                owner_id=primary_user.id,
                title=title,
                status=status,
                priority=priority,
                task_type=task_type,
                number=task_counter[slug],
                assignee_ids=assignees,
                due_date=due_date,
                completed_at=completed_at,
                sort_order=task_counter[slug],
                created_at=created,
                updated_at=created + timedelta(hours=random.randint(1, 72)),
            )
            session.add(task)

        for project in project_objs:
            project.task_counter = task_counter.get(project.slug, 0)

        await session.flush()
        logger.info("Created {} tasks", len(TASK_DATA))

        bookmarks_created = 0
        for urn in bookmark_urns:
            existing = await session.execute(
                select(Bookmark).where(
                    Bookmark.user_id == primary_user.id,
                    Bookmark.urn == urn,
                )
            )
            if existing.scalar_one_or_none():
                continue
            bm = Bookmark(
                id=generate_id(),
                user_id=primary_user.id,
                organization_id=org.id,
                urn=urn,
                created_at=_rand_past(7),
            )
            session.add(bm)
            bookmarks_created += 1

        await session.flush()
        logger.info("Created {} bookmarks", bookmarks_created)

        await session.commit()
        logger.info("Dashboard seed complete.")


if __name__ == "__main__":
    asyncio.run(seed_dashboard())
