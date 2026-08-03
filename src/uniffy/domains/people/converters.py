"""Person payload assembly and proto mapping.

The payload dict is the cacheable form; it is viewer-independent because a
profile carries no per-viewer redaction - one cached payload serves everyone.
"""

import json
from datetime import UTC, datetime, time
from datetime import date as date_type
from typing import Any

from uniffy_proto.people.v1 import people_pb2 as pb

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters import datetime_to_timestamp, org_role_to_proto
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.domains.people.access import ViewerRelation
from uniffy.domains.people.policy import ResolvedProfilePolicy

_SOURCE_KIND_TO_PROTO = {
    IdentitySourceKind.LOCAL: pb.IDENTITY_SOURCE_KIND_LOCAL,
    IdentitySourceKind.SCIM: pb.IDENTITY_SOURCE_KIND_SCIM,
    IdentitySourceKind.LDAP: pb.IDENTITY_SOURCE_KIND_LDAP,
    IdentitySourceKind.OIDC: pb.IDENTITY_SOURCE_KIND_OIDC,
}
SOURCE_KIND_FROM_PROTO = {proto: kind for kind, proto in _SOURCE_KIND_TO_PROTO.items()}

# An unset optional field is LEFT UNSET, never set to "" - the client tells
# "not set" from "empty" via proto3 presence.
_OPTIONAL_SCALARS = (
    "email",
    "work_phone",
    "mobile_phone",
    "office_location",
    "timezone",
    "pronouns",
    "bio",
    "birthday",
)


def team_node_to_proto(node: dict[str, Any]) -> pb.TeamNode:
    message = pb.TeamNode(
        group_id=node["group_id"],
        name=node["name"],
    )
    if node.get("description"):
        message.description = node["description"]
    if node.get("parent_group_id"):
        message.parent_group_id = node["parent_group_id"]
    if node.get("lead_user_id"):
        message.lead_user_id = node["lead_user_id"]
    return message


def _chart_node_to_proto(node: dict[str, Any]) -> pb.OrgChartNode:
    message = pb.OrgChartNode(
        user_id=node["user_id"],
        display_name=node["display_name"],
        descendant_count=node["descendant_count"],
    )
    if node.get("avatar_url"):
        message.avatar_url = node["avatar_url"]
    if node.get("job_title"):
        message.job_title = node["job_title"]
    if node.get("department"):
        message.department = node["department"]
    if node.get("manager_user_id"):
        message.manager_user_id = node["manager_user_id"]
    message.teams.extend(_team_ref(team) for team in node.get("teams", []))
    return message


def chart_payload_to_proto(payload: dict[str, Any], *, enabled: bool) -> pb.GetOrgChartResponse:
    if not enabled:
        return pb.GetOrgChartResponse(enabled=False)
    return pb.GetOrgChartResponse(
        nodes=[_chart_node_to_proto(node) for node in payload["nodes"]],
        root_user_ids=payload["root_user_ids"],
        teams=[team_node_to_proto(team) for team in payload["teams"]],
        truncated=payload["truncated"],
        enabled=True,
    )


def identity_source_to_proto(source: IdentitySource) -> pb.IdentitySource:
    """The secret is never on this message; it lives encrypted in org_settings."""
    message = pb.IdentitySource(
        id=str(source.id),
        kind=_SOURCE_KIND_TO_PROTO[source.kind],
        name=source.name,
        is_active=source.is_active,
        config_json=json.dumps(source.config or {}),
        created_at=datetime_to_timestamp(source.created_at),
    )
    if source.last_sync_at:
        message.last_sync_at.CopyFrom(datetime_to_timestamp(source.last_sync_at))
    if source.last_sync_status:
        message.last_sync_status = source.last_sync_status
    if source.last_sync_error:
        message.last_sync_error = source.last_sync_error
    return message


def policy_to_proto(policy: ResolvedProfilePolicy) -> pb.ProfilePolicy:
    return pb.ProfilePolicy(
        directory_enabled=policy.directory_enabled,
        org_chart_enabled=policy.org_chart_enabled,
    )


def build_person_payload(
    member: OrganizationMember,
    user: User,
    profile: PeopleProfile | None,
    *,
    teams: list[dict],
    direct_report_count: int,
) -> dict[str, Any]:
    return {
        "user_id": str(user.id),
        "display_name": user.full_name or user.username,
        "username": user.username,
        "avatar_url": get_avatar_url(user.id, user.avatar_key),
        "has_avatar": user.avatar_key is not None,
        "org_role": member.role.value,
        "is_active": member.is_active,
        "email": user.email,
        "job_title": profile.job_title if profile else None,
        "department": profile.department if profile else None,
        "work_phone": profile.work_phone if profile else None,
        "mobile_phone": profile.mobile_phone if profile else None,
        "office_location": profile.office_location if profile else None,
        "timezone": profile.timezone if profile else None,
        "pronouns": user.pronouns,
        "bio": profile.bio if profile else None,
        "start_date": (
            profile.start_date.isoformat() if profile and profile.start_date else None
        ),
        "birthday": profile.birthday if profile else None,
        "links": (profile.links or []) if profile else [],
        "manager_user_id": (
            str(profile.manager_user_id) if profile and profile.manager_user_id else None
        ),
        "teams": teams,
        "direct_report_count": direct_report_count,
        "managed_fields": (profile.managed_fields or []) if profile else [],
    }


def _team_ref(team: dict) -> pb.TeamRef:
    ref = pb.TeamRef(group_id=team["group_id"], name=team["name"])
    if team.get("lead_user_id"):
        ref.lead_user_id = team["lead_user_id"]
    return ref


def profile_to_proto(
    payload: dict[str, Any],
    *,
    relation: ViewerRelation,
) -> pb.PersonProfile:
    person = pb.PersonProfile(
        user_id=payload["user_id"],
        display_name=payload["display_name"],
        username=payload["username"],
        has_avatar=payload["has_avatar"],
        org_role=org_role_to_proto(OrganizationRole(payload["org_role"])),
        is_active=payload["is_active"],
        direct_report_count=payload["direct_report_count"],
        is_self=relation is ViewerRelation.SELF,
        can_edit=relation in (ViewerRelation.SELF, ViewerRelation.ORG_ADMIN),
    )
    if payload["avatar_url"]:
        person.avatar_url = payload["avatar_url"]
    if payload["job_title"] is not None:
        person.job_title = payload["job_title"]
    if payload["department"] is not None:
        person.department = payload["department"]
    if payload["manager_user_id"] is not None:
        person.manager_user_id = payload["manager_user_id"]
    person.teams.extend(_team_ref(team) for team in payload["teams"])

    for field in _OPTIONAL_SCALARS:
        value = payload.get(field)
        if value:
            setattr(person, field, value)
    if payload["start_date"]:
        start = datetime.combine(
            date_type.fromisoformat(payload["start_date"]), time.min, tzinfo=UTC
        )
        person.start_date.CopyFrom(datetime_to_timestamp(start))
    person.links.extend(
        pb.ProfileLink(label=link.get("label", ""), url=link.get("url", ""))
        for link in payload["links"]
        if isinstance(link, dict)
    )
    person.managed_fields.extend(payload["managed_fields"])
    return person
