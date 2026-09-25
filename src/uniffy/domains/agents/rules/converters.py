"""Rule response projections."""

from uniffy_proto.agents.v1 import rules_pb as pb

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.rule import AgentRule, RuleSource, RuleStatus
from uniffy.core.models.agents.rule_version import AgentRuleVersion


def rule_to_proto(rule: AgentRule, *, include_content: bool = True) -> pb.RuleInfo:
    return pb.RuleInfo(
        id=str(rule.id),
        organization_id=str(rule.organization_id) if rule.organization_id else None,
        source=pb.RuleSource.BUNDLED
        if rule.source == RuleSource.BUNDLED
        else pb.RuleSource.ORGANIZATION,
        name=rule.name,
        display_name=rule.display_name,
        description=rule.description,
        content=rule.content if include_content else "",
        status=pb.RuleStatus.ACTIVE if rule.status == RuleStatus.ACTIVE else pb.RuleStatus.RETIRED,
        latest_version_number=rule.latest_version_number,
        active_version_id=str(rule.active_version_id) if rule.active_version_id else "",
        active_version_pinned=rule.active_version_pinned,
        created_at=datetime_to_timestamp(rule.created_at),
        updated_at=datetime_to_timestamp(rule.updated_at),
    )


def version_to_proto(version: AgentRuleVersion) -> pb.RuleVersion:
    return pb.RuleVersion(
        id=str(version.id),
        rule_id=str(version.rule_id),
        version_number=version.version_number,
        name=version.name,
        display_name=version.display_name,
        description=version.description,
        content=version.content,
        author_id=str(version.author_id) if version.author_id else None,
        change_summary=version.change_summary,
        parent_version_id=str(version.parent_version_id) if version.parent_version_id else None,
        created_at=datetime_to_timestamp(version.created_at),
    )
