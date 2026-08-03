"""Normalized directory records shared by every provider plane (pull, push, JIT)."""

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Any

from uniffy.core.models.login.group import GroupKind


@dataclass(frozen=True)
class DirectoryUser:
    """One user record normalized from any backend; field set follows SCIM core + AD enterprise."""

    external_id: str
    user_name: str
    email: str | None = None  # AD users can lack `mail`; matching then uses external_id only
    active: bool = True
    display_name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    office_location: str | None = None
    timezone: str | None = None
    work_phone: str | None = None
    mobile_phone: str | None = None
    manager_external_id: str | None = None
    manager_external_dn: str | None = None
    external_dn: str | None = None
    group_external_ids: tuple[str, ...] = ()
    raw: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DirectoryGroup:
    external_id: str
    display_name: str
    kind: GroupKind = GroupKind.ACCESS
    parent_external_id: str | None = None
    lead_external_id: str | None = None
    member_external_ids: tuple[str, ...] = ()
    external_dn: str | None = None
    raw: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceCapabilities:
    """What a source KIND can do; consumed by the RPCs and the admin UI, so
    behaviour differences live here instead of in scattered kind-switches."""

    supports_pull_users: bool = False  # LDAP/AD: we enumerate their directory
    supports_pull_groups: bool = False
    supports_manager: bool = False
    supports_push: bool = False  # SCIM: the IdP calls our endpoint per resource
    supports_jit_login: bool = False  # OIDC: records arrive one at a time, at login
    supports_login: bool = False  # the source can act as an SSO login backend later


@dataclass
class ReconcileReport:
    """Counts for one sync run; lands in the audit event and the logs."""

    users_created: int = 0
    users_updated: int = 0
    users_skipped: int = 0
    users_deprovisioned: int = 0
    deprovision_skipped: int = 0
    groups_created: int = 0
    groups_updated: int = 0
    groups_renamed: int = 0
    memberships_added: int = 0
    memberships_removed: int = 0
    unresolved_managers: int = 0
    skipped_global_changes: int = 0
    aborted: bool = False
    elapsed_seconds: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
