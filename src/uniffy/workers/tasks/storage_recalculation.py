"""Nightly storage-usage recalculation to correct drift in quota counters."""

from typing import Any

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.login.organization import Organization
from uniffy.db import open_session
from uniffy.domains.files.quota_operations import QuotaOperations

logger = logger.bind(component="tasks.storage_recalculation")


async def recalculate_all_storage_usage(ctx: dict[str, Any]) -> dict[str, Any]:
    """Recalculate per-user storage usage from the `files` table for every org."""
    logger.info("Starting storage usage recalculation for all organizations")
    total_orgs = 0
    total_users = 0
    total_corrections = 0

    try:
        async with open_session() as session:
            result = await session.execute(select(Organization.id))
            org_ids = [row[0] for row in result.all()]

            for org_id in org_ids:
                try:
                    ops = QuotaOperations(session)
                    usage_records = await ops.recalculate_org_usage(org_id)
                    total_orgs += 1
                    total_users += len(usage_records)
                except Exception:
                    logger.opt(exception=True).warning(
                        "Failed to recalculate usage for organization",
                        organization_id=str(org_id)
                    )

    except Exception:
        logger.exception("Storage usage recalculation failed")

    logger.info(
        "Storage usage recalculation complete",
        organizations=total_orgs,
        users=total_users,
        corrections=total_corrections,
    )

    return {
        "status": "complete",
        "organizations": total_orgs,
        "users": total_users,
    }
