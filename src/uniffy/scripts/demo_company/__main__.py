"""CLI entry point: `uv run python -m uniffy.scripts.demo_company`."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

from loguru import logger
from sqlalchemy import select

from uniffy.core.jobs import QueueName
from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.domains.chat.limits import (
    CHANNEL_CREATE,
    MEMBER_ADD,
    REACTION_ADD,
    SEND,
)
from uniffy.infrastructure.database.session import init_db, open_session
from uniffy.infrastructure.search import MeiliSearchEngine
from uniffy.infrastructure.storage import S3Storage
from uniffy.infrastructure.valkey.ops import close_ops_client, init_ops_client
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.infrastructure.valkey.queue import close_queue, init_queue
from uniffy.scripts.demo_company.context import ResolutionError
from uniffy.scripts.demo_company.loader import DEFAULT_PERSON_PASSWORD, ContentError
from uniffy.scripts.demo_company.seeder import DOMAINS, DemoDomain, seed_demo_company

SENTINEL_NAMESPACE = "seed"
SENTINEL_KEY = "demo_company"
BOOTSTRAP_TIMEOUT_SECONDS = 600
SEED_CHAT_RATE_LIMIT = 1_000_000

# Production is never seedable. Staging is, behind --allow-non-development,
# because the content ships real logins into a deployment other people reach.
SEEDABLE_ENVIRONMENTS = frozenset({"development", "staging"})


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m uniffy.scripts.demo_company",
        description="Seed an organization with a demo knowledge base: users, "
        "agents, notes, files, rooms, calendar events, projects, chat and bookmarks.",
    )
    parser.add_argument(
        "--content-dir",
        type=Path,
        help="Content directory to seed from (defaults to the bundled demo company)",
    )
    parser.add_argument("--org-slug", help="Target organization (defaults to the oldest one)")
    parser.add_argument(
        "--actor-email",
        help="Owner of the seeded rows (defaults to the organization owner)",
    )
    parser.add_argument(
        "--anchor-date",
        help="YYYY-MM-DD inside the week events are laid out on (defaults to this week)",
    )
    parser.add_argument(
        "--only",
        default=",".join(DOMAINS),
        help=f"Comma-separated subset of {','.join(DOMAINS)}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be created without writing anything",
    )
    parser.add_argument(
        "--password",
        help="Password for every login this run creates, replacing the one the "
        "content declares. Required outside ENVIRONMENT=development. Existing "
        "users keep the password they already have",
    )
    parser.add_argument(
        "--allow-non-development",
        action="store_true",
        help=f"Seed a deployment whose ENVIRONMENT is not 'development'. "
        f"Accepted on {', '.join(sorted(SEEDABLE_ENVIRONMENTS))} only, and "
        f"--password comes with it",
    )
    parser.add_argument(
        "--fresh-only",
        action="store_true",
        help="Stack boot mode: wait for the backend bootstrap, run the full "
        "seed once per database, and record a sentinel so the next start "
        "exits immediately",
    )
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()

    environment = os.getenv("ENVIRONMENT", "production").strip().lower()
    _check_environment(environment, args)
    _lift_chat_rate_limits()

    requested_domains = tuple(part.strip() for part in args.only.split(",") if part.strip())
    unknown = sorted(set(requested_domains) - set(DOMAINS))
    if unknown:
        raise SystemExit(f"Unknown --only value(s): {', '.join(unknown)}")
    only = tuple(DemoDomain(domain) for domain in requested_domains)

    anchor = datetime.fromisoformat(args.anchor_date) if args.anchor_date else None

    await init_db(skip_migrations=True)

    if args.fresh_only:
        await _wait_for_bootstrap()
        if await _sentinel_present():
            logger.info("Demo seed sentinel present, nothing to do")
            return

    search = WorkspaceSearch(MeiliSearchEngine())
    await search.startup()
    search_indexer = SearchIndexer(search)
    await _init_valkey()
    storage = S3Storage()
    await storage.startup()

    try:
        await seed_demo_company(
            storage=storage,
            search=search,
            search_indexer=search_indexer,
            content_dir=args.content_dir,
            org_slug=args.org_slug,
            actor_email=args.actor_email,
            anchor_date=anchor,
            only=only,
            dry_run=args.dry_run,
            password=args.password,
        )
        if args.fresh_only and not args.dry_run:
            await _write_sentinel()
    finally:
        await storage.shutdown()
        await search.shutdown()
        await _close_valkey()


def _check_environment(environment: str, args: argparse.Namespace) -> None:
    """Guard the two ways this run reaches people who did not ask for demo data.

    The content declares logins, so seeding a deployment others can reach hands
    out accounts. Production is refused outright and staging asks for both an
    explicit opt-in and a password that is not the one in the repository.
    """
    if environment == "development":  # noqa: PLR2004
        return

    if environment not in SEEDABLE_ENVIRONMENTS:
        raise SystemExit(
            f"Demo seeding refuses ENVIRONMENT={environment!r}; it runs on "
            f"{', '.join(sorted(SEEDABLE_ENVIRONMENTS))} only"
        )

    if not args.allow_non_development:
        raise SystemExit(
            f"ENVIRONMENT={environment!r} needs --allow-non-development. This seeds "
            f"real, active, email-verified logins into a live deployment"
        )

    if not args.password and not args.dry_run:
        raise SystemExit(
            f"--password is required on {environment}. Without it every seeded "
            f"persona gets {DEFAULT_PERSON_PASSWORD!r} from the content defaults"
        )

    logger.warning(f"Seeding demo content and demo logins into a live {environment} deployment")


def _lift_chat_rate_limits() -> None:
    """Years of company chat land in seconds, which is the exact burst the
    per-user chat limits exist to stop.

    The limits read the environment on every call, so raising them here binds
    the change to this process and leaves the running backend untouched. The
    environment gate above has already refused production by this point.
    """
    for limit in (SEND, CHANNEL_CREATE, MEMBER_ADD, REACTION_ADD):
        os.environ[limit.env_name] = str(SEED_CHAT_RATE_LIMIT)


async def _wait_for_bootstrap() -> None:
    """The backend owns migrations and the initial seed; an org row means both ran."""
    from uniffy.core.models.login.organization import Organization

    deadline = time.monotonic() + BOOTSTRAP_TIMEOUT_SECONDS
    while True:
        reason = "no organization yet"
        try:
            async with open_session() as session:
                row = (await session.execute(select(Organization.id).limit(1))).scalars().first()
            if row is not None:
                return
        except Exception as exc:  # noqa: BLE001
            reason = str(exc)

        if time.monotonic() > deadline:
            raise SystemExit(f"Backend bootstrap never finished: {reason}")
        logger.info(f"Waiting for backend bootstrap: {reason}")
        await asyncio.sleep(5)


async def _sentinel_present() -> bool:
    from uniffy.core.config.settings import DeploymentSettingsOperations

    async with open_session() as session:
        namespace = await DeploymentSettingsOperations(session).get_namespace(SENTINEL_NAMESPACE)
    return SENTINEL_KEY in namespace


async def _write_sentinel() -> None:
    from uniffy.core.config.settings import DeploymentSettingsOperations

    async with open_session() as session:
        await DeploymentSettingsOperations(session).set(
            namespace=SENTINEL_NAMESPACE,
            key=SENTINEL_KEY,
            value={"completed_at": datetime.now(UTC).isoformat()},
        )
        await session.commit()
    logger.info("Recorded the demo seed sentinel; later starts skip the run")


async def _init_valkey() -> None:
    """Without these the seeded content lands in the database but no background
    job is queued and no notification is published.
    """
    for name, start in (
        *((f"{queue} queue", partial(init_queue, queue)) for queue in QueueName),
        ("pubsub", init_pubsub),
        ("ops client", init_ops_client),
    ):
        try:
            await start()
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Valkey {name} not available, seeding continues without it: {exc}")


async def _close_valkey() -> None:
    for close in (
        *(partial(close_queue, queue) for queue in QueueName),
        close_pubsub,
        close_ops_client,
    ):
        try:
            await close()
        except Exception:  # noqa: BLE001
            logger.opt(exception=True).warning("Valkey shutdown failed")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except (ContentError, ResolutionError) as exc:
        logger.error(str(exc))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Demo seeding failed: {exc}")
        sys.exit(1)
