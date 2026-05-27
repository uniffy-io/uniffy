"""Streaming export of audit events in CSV or NDJSON.

Reuses `ListEventsFilter`; streams in ~32KB chunks and rejects exports
larger than `MAX_EXPORT_ROWS` pre-flight.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.user import User
from uniffy.domains.audit.operations import (
    AuditOperations,
    ListEventsFilter,
)

MAX_EXPORT_ROWS = 1_000_000
ROW_BATCH = 1_000
CHUNK_FLUSH_BYTES = 32 * 1024

ExportFormat = Literal["csv", "ndjson"]

CSV_COLUMNS = (
    "timestamp_utc",
    "organization_id",
    "actor_user_id",
    "actor_email",
    "actor_org_role",
    "on_behalf_of_user_id",
    "on_behalf_of_email",
    "action",
    "resource_type",
    "resource_id",
    "ip_address",
    "user_agent",
    "details_json",
)


@dataclass(frozen=True)
class ExportFilter:
    filter: ListEventsFilter
    format: ExportFormat


class ExportOperations:
    """Server-streaming export of audit events; authorization mirrors `AuditOperations`."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._read_ops = AuditOperations(session)

    async def stream_export(
        self,
        actor_user_id: UUID,
        export: ExportFilter,
    ) -> AsyncIterator[bytes]:
        """Yield CSV / NDJSON chunks for rows matching the filter."""
        await self._read_ops.require_audit_view(
            actor_user_id, export.filter.organization_id
        )

        await self._enforce_row_cap(export.filter)

        if export.format == "csv":
            async for chunk in self._stream_csv(export.filter):
                yield chunk
        else:
            async for chunk in self._stream_ndjson(export.filter):
                yield chunk

    async def _enforce_row_cap(self, filters: ListEventsFilter) -> None:
        query = select(func.count()).select_from(AuditEvent).where(
            AuditEvent.organization_id == filters.organization_id
        )
        if filters.actor_user_id is not None:
            query = query.where(AuditEvent.actor_user_id == filters.actor_user_id)
        if filters.actions:
            query = query.where(AuditEvent.action.in_(filters.actions))
        if filters.resource_type is not None:
            query = query.where(AuditEvent.resource_type == filters.resource_type)
        if filters.resource_id is not None:
            query = query.where(AuditEvent.resource_id == filters.resource_id)
        if filters.from_time is not None:
            query = query.where(AuditEvent.created_at >= filters.from_time)
        if filters.to_time is not None:
            query = query.where(AuditEvent.created_at <= filters.to_time)

        total = (await self.session.execute(query)).scalar_one()
        if total > MAX_EXPORT_ROWS:
            raise ValidationError(
                "filter",
                f"Export would return {total} rows (cap {MAX_EXPORT_ROWS}). "
                "Narrow the filter and retry.",
            )

    async def _stream_csv(
        self,
        filters: ListEventsFilter,
    ) -> AsyncIterator[bytes]:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(CSV_COLUMNS)
        async for row, emails in self._stream_rows(filters):
            writer.writerow(_format_csv_row(row, emails))
            if buffer.tell() >= CHUNK_FLUSH_BYTES:
                yield buffer.getvalue().encode("utf-8")
                buffer.seek(0)
                buffer.truncate(0)

        if buffer.tell() > 0:
            yield buffer.getvalue().encode("utf-8")

    async def _stream_ndjson(
        self,
        filters: ListEventsFilter,
    ) -> AsyncIterator[bytes]:
        pending = bytearray()
        async for row, emails in self._stream_rows(filters):
            payload = _format_ndjson_row(row, emails)
            pending.extend(payload.encode("utf-8"))
            pending.append(0x0A)
            if len(pending) >= CHUNK_FLUSH_BYTES:
                yield bytes(pending)
                pending.clear()

        if pending:
            yield bytes(pending)

    async def _stream_rows(
        self,
        filters: ListEventsFilter,
    ) -> AsyncIterator[tuple[AuditEvent, dict[UUID, str]]]:
        """Iterate matching rows newest-first in batches of `ROW_BATCH`."""
        cursor: tuple[datetime, UUID] | None = None
        while True:
            query = (
                select(AuditEvent)
                .where(AuditEvent.organization_id == filters.organization_id)
                .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
                .limit(ROW_BATCH)
            )
            if filters.actor_user_id is not None:
                query = query.where(AuditEvent.actor_user_id == filters.actor_user_id)
            if filters.actions:
                query = query.where(AuditEvent.action.in_(filters.actions))
            if filters.resource_type is not None:
                query = query.where(AuditEvent.resource_type == filters.resource_type)
            if filters.resource_id is not None:
                query = query.where(AuditEvent.resource_id == filters.resource_id)
            if filters.from_time is not None:
                query = query.where(AuditEvent.created_at >= filters.from_time)
            if filters.to_time is not None:
                query = query.where(AuditEvent.created_at <= filters.to_time)
            if cursor is not None:
                cursor_created_at, cursor_id = cursor
                query = query.where(
                    (AuditEvent.created_at < cursor_created_at)
                    | (
                        (AuditEvent.created_at == cursor_created_at)
                        & (AuditEvent.id < cursor_id)
                    )
                )

            rows = list((await self.session.execute(query)).scalars().all())
            if not rows:
                return

            emails = await self._resolve_emails(rows)
            for row in rows:
                yield row, emails

            if len(rows) < ROW_BATCH:
                return
            tail = rows[-1]
            cursor = (tail.created_at, tail.id)

    async def _resolve_emails(
        self,
        rows: list[AuditEvent],
    ) -> dict[UUID, str]:
        user_ids: set[UUID] = set()
        for row in rows:
            if row.actor_user_id is not None:
                user_ids.add(row.actor_user_id)
            if row.on_behalf_of_user_id is not None:
                user_ids.add(row.on_behalf_of_user_id)
        if not user_ids:
            return {}

        result = await self.session.execute(
            select(User.id, User.email).where(User.id.in_(user_ids))
        )
        return {user_id: email for user_id, email in result.all()}


def _format_csv_row(
    event: AuditEvent,
    emails: dict[UUID, str],
) -> tuple[str, ...]:
    return (
        event.created_at.isoformat() if event.created_at else "",
        str(event.organization_id) if event.organization_id else "",
        str(event.actor_user_id) if event.actor_user_id else "",
        emails.get(event.actor_user_id, "") if event.actor_user_id else "",
        event.actor_org_role or "",
        str(event.on_behalf_of_user_id) if event.on_behalf_of_user_id else "",
        emails.get(event.on_behalf_of_user_id, "")
        if event.on_behalf_of_user_id
        else "",
        event.action,
        event.resource_type or "",
        str(event.resource_id) if event.resource_id else "",
        str(event.ip_address) if event.ip_address else "",
        event.user_agent or "",
        json.dumps(event.details or {}, separators=(",", ":")),
    )


def _format_ndjson_row(
    event: AuditEvent,
    emails: dict[UUID, str],
) -> str:
    return json.dumps(
        {
            "timestamp_utc": event.created_at.isoformat() if event.created_at else None,
            "organization_id": str(event.organization_id)
            if event.organization_id
            else None,
            "actor_user_id": str(event.actor_user_id) if event.actor_user_id else None,
            "actor_email": emails.get(event.actor_user_id)
            if event.actor_user_id
            else None,
            "actor_org_role": event.actor_org_role,
            "on_behalf_of_user_id": str(event.on_behalf_of_user_id)
            if event.on_behalf_of_user_id
            else None,
            "on_behalf_of_email": emails.get(event.on_behalf_of_user_id)
            if event.on_behalf_of_user_id
            else None,
            "action": event.action,
            "resource_type": event.resource_type,
            "resource_id": str(event.resource_id) if event.resource_id else None,
            "ip_address": str(event.ip_address) if event.ip_address else None,
            "user_agent": event.user_agent,
            "details": event.details or {},
        },
        separators=(",", ":"),
    )
