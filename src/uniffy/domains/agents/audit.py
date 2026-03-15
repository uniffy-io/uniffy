"""Audit logging helper for agent-domain configuration changes."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession


async def create_audit_log(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    action: str,
    resource_type: str,
    resource_id: UUID,
    details: dict | None = None,
) -> None:
    """Record an audit log entry for an agent-domain action.

    Adds the entry to the session without committing. The caller's
    next commit will persist it. If the main operation rolls back,
    the audit entry rolls back too (correct behavior).

    Failures are logged but never raised.

    Parameters
    ----------
    session : AsyncSession
        Database session (shared with the calling operation).
    organization_id : UUID
        Organization context.
    user_id : UUID
        User who performed the action.
    action : str
        Dot-separated action name (e.g. "agent.update").
    resource_type : str
        Type of resource affected (e.g. "agent", "provider_key", "skill").
    resource_id : UUID
        ID of the affected resource.
    details : dict | None
        Optional change details for JSONB storage.

    """
    try:
        # Lazy import to avoid circular dependency through the models package
        from uniffy.core.models.agents.audit_log import AgentAuditLog

        entry = AgentAuditLog(
            organization_id=organization_id,
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
        )
        session.add(entry)
    except Exception:
        logger.warning(
            "Failed to create audit log entry",
            action=action,
            resource_type=resource_type,
            exc_info=True,
        )
