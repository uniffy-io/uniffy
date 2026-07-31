"""CLI entry point: `uv run python -m uniffy.scripts.demo_company`."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

from loguru import logger

from uniffy.core.search import init_meilisearch
from uniffy.core.valkey import (
    close_ops_client,
    close_pubsub,
    close_queue,
    init_ops_client,
    init_pubsub,
    init_queue,
)
from uniffy.db.session import init_db
from uniffy.scripts.demo_company.context import ResolutionError
from uniffy.scripts.demo_company.loader import ContentError
from uniffy.scripts.demo_company.seeder import DOMAINS, seed_demo_company


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m uniffy.scripts.demo_company",
        description="Seed an organization with a demo knowledge base: "
        "notes, files, rooms and calendar events.",
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
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()

    only = tuple(part.strip() for part in args.only.split(",") if part.strip())
    unknown = sorted(set(only) - set(DOMAINS))
    if unknown:
        raise SystemExit(f"Unknown --only value(s): {', '.join(unknown)}")

    anchor = datetime.fromisoformat(args.anchor_date) if args.anchor_date else None

    await init_db(skip_migrations=True)
    await init_meilisearch()
    await _init_valkey()

    try:
        await seed_demo_company(
            content_dir=args.content_dir,
            org_slug=args.org_slug,
            actor_email=args.actor_email,
            anchor_date=anchor,
            only=only,
            dry_run=args.dry_run,
        )
    finally:
        await _close_valkey()


async def _init_valkey() -> None:
    """Without these the seeded content lands in the database but no background
    job is queued and no notification is published.
    """
    for name, start in (
        ("core queue", lambda: init_queue("core")),
        ("egress queue", lambda: init_queue("egress")),
        ("pubsub", init_pubsub),
        ("ops client", init_ops_client),
    ):
        try:
            await start()
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Valkey {name} not available, seeding continues without it: {exc}")


async def _close_valkey() -> None:
    for close in (
        lambda: close_queue("core"),
        lambda: close_queue("egress"),
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
