"""Bounded operational observations of exact invoked versions."""

from base64 import b64decode, urlsafe_b64encode
from binascii import Error as Base64Error
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.domains.agents.access import is_org_admin, require_agents_builder


@dataclass(frozen=True)
class SkillMetricsPage:
    metrics: list[dict]
    next_cursor: str
    window_start: datetime
    window_end: datetime


_METRICS = text("""
WITH candidates AS (
    SELECT DISTINCT skill_id, skill_version_id, skill_version_number
    FROM agents_skill_invocations
    WHERE organization_id = :org AND created_at >= :start AND created_at < :end
      AND (CAST(:skill AS uuid) IS NULL OR skill_id = :skill)
      AND (CAST(:after_skill AS uuid) IS NULL OR
           (skill_id, skill_version_id) > (:after_skill, :after_version))
    ORDER BY skill_id, skill_version_id, skill_version_number
    LIMIT :limit
), observations AS (
    SELECT i.*, r.id AS log_id, r.duration_ms, r.input_tokens, r.output_tokens,
           r.cost, r.cost_currency
    FROM candidates c
    JOIN agents_skill_invocations i
      ON (i.skill_id, i.skill_version_id, i.skill_version_number) =
         (c.skill_id, c.skill_version_id, c.skill_version_number)
    LEFT JOIN agents_run_logs r
      ON r.id = i.run_log_id AND r.organization_id = i.organization_id
     AND r.user_id = i.user_id AND r.agent_id = i.agent_id
     AND r.session_id IS NOT DISTINCT FROM i.session_id
     AND r.channel_id IS NOT DISTINCT FROM i.channel_id
    WHERE i.organization_id = :org AND i.created_at >= :start AND i.created_at < :end
), costs AS (
    SELECT skill_id, skill_version_id, cost_currency AS currency,
           sum(cost)::text AS amount, count(*) AS run_count
    FROM observations WHERE cost IS NOT NULL AND cost_currency IS NOT NULL
    GROUP BY skill_id, skill_version_id, cost_currency
), cost_totals AS (
    SELECT skill_id, skill_version_id,
           jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount,
                                       'run_count', run_count) ORDER BY currency) AS costs
    FROM costs GROUP BY skill_id, skill_version_id
)
SELECT o.skill_id, o.skill_version_id, o.skill_version_number,
       coalesce(v.display_name, 'Deleted skill') AS display_name,
       count(*) AS invocation_count,
       count(*) FILTER (WHERE o.status = 'started') AS started_count,
       count(*) FILTER (WHERE o.status = 'completed') AS completed_count,
       count(*) FILTER (WHERE o.status = 'failed') AS failed_count,
       count(*) FILTER (WHERE o.status = 'rejected') AS rejected_count,
       count(*) FILTER (WHERE o.status = 'cancelled') AS cancelled_count,
       count(*) FILTER (WHERE o.tool_error_count > 0) AS tool_error_run_count,
       count(DISTINCT o.user_id) AS unique_users,
       count(o.log_id) AS run_log_count,
       coalesce(sum(o.duration_ms), 0)::bigint AS duration_ms,
       coalesce(sum(o.input_tokens), 0)::bigint AS input_tokens,
       coalesce(sum(o.output_tokens), 0)::bigint AS output_tokens,
       coalesce(ct.costs, '[]'::jsonb) AS costs
FROM observations o
LEFT JOIN agents_skills s ON s.id = o.skill_id
 AND (s.organization_id = :org OR s.organization_id IS NULL)
LEFT JOIN agents_skill_versions v ON v.skill_id = s.id AND v.id = o.skill_version_id
 AND v.version_number = o.skill_version_number
LEFT JOIN cost_totals ct ON ct.skill_id = o.skill_id AND ct.skill_version_id = o.skill_version_id
GROUP BY o.skill_id, o.skill_version_id, o.skill_version_number, v.display_name, ct.costs
ORDER BY o.skill_id, o.skill_version_id, o.skill_version_number
""")


class SkillMetricsReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def read(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID | None = None,
        window_days: int = 30,
        page_size: int = 200,
        cursor: str = "",
    ) -> SkillMetricsPage:
        if skill_id is None:
            if not await is_org_admin(self._session, user_id, organization_id):
                raise PermissionDeniedError("Requires organization admin privileges")
        else:
            await require_agents_builder(self._session, user_id, organization_id)
        if not 1 <= window_days <= 90:
            raise ValidationError("window_days", "Choose a window between 1 and 90 days")
        if not 1 <= page_size <= 500:
            raise ValidationError("page_size", "Choose a page size between 1 and 500")
        end = datetime.now(UTC)
        after_skill = after_version = None
        if cursor:
            if len(cursor) > 2048:
                raise ValidationError("cursor", "Invalid metrics cursor")
            try:
                value = loads(b64decode(cursor, altchars=b"-_", validate=True))
                if not isinstance(value, dict) or (
                    value["org"] != str(organization_id)
                    or value["skill"] != str(skill_id)
                    or value["days"] != window_days
                ):
                    raise ValueError
                end = datetime.fromisoformat(value["end"])
                if end.tzinfo is None or end > datetime.now(UTC):
                    raise ValueError
                after_skill, after_version = UUID(value["after_skill"]), UUID(value["after_version"])
            except ValueError, TypeError, KeyError, Base64Error, JSONDecodeError:
                raise ValidationError("cursor", "Invalid metrics cursor") from None
        start = end - timedelta(days=window_days)
        rows = (
            (
                await self._session.execute(
                    _METRICS,
                    {
                        "org": organization_id,
                        "skill": skill_id,
                        "start": start,
                        "end": end,
                        "after_skill": after_skill,
                        "after_version": after_version,
                        "limit": page_size + 1,
                    },
                )
            )
            .mappings()
            .all()
        )
        metrics = [dict(row) for row in rows[:page_size]]
        next_cursor = ""
        if len(rows) > page_size:
            last = metrics[-1]
            next_cursor = urlsafe_b64encode(
                dumps_bytes({
                    "org": str(organization_id),
                    "skill": str(skill_id),
                    "days": window_days,
                    "end": end.isoformat(),
                    "after_skill": str(last["skill_id"]),
                    "after_version": str(last["skill_version_id"]),
                })
            ).decode()
        for metric in metrics:
            metric["tool_error_rate"] = metric["tool_error_run_count"] / metric["invocation_count"]
            metric["skill_id"] = str(metric["skill_id"])
            metric["skill_version_id"] = str(metric["skill_version_id"])
        return SkillMetricsPage(metrics, next_cursor, start, end)
