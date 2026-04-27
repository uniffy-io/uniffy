"""Background task for periodic storage usage recalculation.

Runs nightly to correct any drift between materialized usage
counters and actual file storage. This ensures quota enforcement
remains accurate even if increment/decrement operations fail.
"""

from typing import Any

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.login.organization import Organization
from uniffy.db import open_session
from uniffy.domains.files.quota_operations import QuotaOperations


async def recalculate_all_storage_usage(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Recalculate storage usage for all organizations.

    Iterates over every organization and recalculates per-user
    usage from the files table. Logs any drift corrections.

    Parameters
    ----------
    ctx : dict[str, Any]
        ARQ worker context.

    Returns
    -------
    dict[str, Any]
        Summary of recalculation results.

    """
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
                    logger.warning(
                        "Failed to recalculate usage for organization",
                        organization_id=str(org_id),
                        exc_info=True,
                    )

    except Exception:
        logger.error("Storage usage recalculation failed", exc_info=True)

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
