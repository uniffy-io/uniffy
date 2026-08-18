"""Viewer relation matrix, plus the guard that people gating never becomes a
content bypass.

A profile is member-record data governed by org role. It must never enter
`PermissionChecker.effective_role`, `ContentAccessQuery.build_accessible_filter`,
the Meili permission filter, or the manage-override registry.
"""

import ast
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import uniffy.domains.people as people_package
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.scalar import ScalarAuthorizationFacts
from uniffy.core.content.members import _manage_overrides
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.people.access import ViewerRelation, relation_for
from uniffy.domains.people.converters import profile_to_proto

PEOPLE_DIR = Path(people_package.__file__).parent

# Calling any of these from the people domain would route member-record gating
# through the content path. Matched over the AST, so the prose in access.py's
# own docstring explaining the rule does not trip it.
FORBIDDEN_NAMES = frozenset({
    "PermissionChecker",
    "effective_role",
    "build_accessible_filter",
    "register_manage_override",
    "ContentAccessQuery",
})
FORBIDDEN_IMPORT_ROOTS = ("uniffy.core.auth.permissions", "uniffy.core.content.members")


def _content_path_references(tree: ast.AST) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module.startswith(FORBIDDEN_IMPORT_ROOTS):
                found.add(node.module)
        elif isinstance(node, ast.Import):
            found.update(
                alias.name for alias in node.names if alias.name.startswith(FORBIDDEN_IMPORT_ROOTS)
            )
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
            found.add(node.attr)
    return found


def _admin_facts() -> ScalarAuthorizationFacts:
    return ScalarAuthorizationFacts(
        is_active_user=True,
        is_system_admin=False,
        organization_role=OrganizationRole.ADMIN,
        support_session_id=None,
        support_scope=None,
        default_access_mode=None,
        default_baseline_role=None,
        blocked=False,
        granted_role=None,
    )


def _payload(**overrides):
    payload = {
        "user_id": str(generate_id()),
        "display_name": "Jane Doe",
        "username": "jane",
        "avatar_url": None,
        "has_avatar": False,
        "org_role": "MEMBER",
        "is_active": True,
        "email": "jane@example.com",
        "job_title": "VP Engineering",
        "department": "Engineering",
        "work_phone": "+123",
        "mobile_phone": "+456",
        "office_location": "Sofia",
        "timezone": "Europe/Sofia",
        "pronouns": "they/them",
        "bio": "Builds things.",
        "start_date": None,
        "birthday": "04-12",
        "links": [],
        "manager_user_id": None,
        "teams": [],
        "direct_report_count": 0,
        "managed_fields": [],
    }
    payload.update(overrides)
    return payload


class TestViewerRelation:
    def test_self_wins_over_admin(self) -> None:
        user_id = generate_id()
        assert relation_for(user_id, user_id, is_admin=True) is ViewerRelation.SELF

    def test_self_without_admin(self) -> None:
        user_id = generate_id()
        assert relation_for(user_id, user_id, is_admin=False) is ViewerRelation.SELF

    def test_admin_viewing_another_member(self) -> None:
        relation = relation_for(generate_id(), generate_id(), is_admin=True)
        assert relation is ViewerRelation.ORG_ADMIN

    def test_member_viewing_another_member(self) -> None:
        relation = relation_for(generate_id(), generate_id(), is_admin=False)
        assert relation is ViewerRelation.MEMBER


class TestEditAffordances:
    def test_self_can_edit(self) -> None:
        person = profile_to_proto(_payload(), relation=ViewerRelation.SELF)
        assert person.is_self
        assert person.can_edit

    def test_org_admin_can_edit_but_is_not_self(self) -> None:
        person = profile_to_proto(_payload(), relation=ViewerRelation.ORG_ADMIN)
        assert not person.is_self
        assert person.can_edit

    def test_member_cannot_edit(self) -> None:
        person = profile_to_proto(_payload(), relation=ViewerRelation.MEMBER)
        assert not person.is_self
        assert not person.can_edit

    def test_every_relation_reads_every_field(self) -> None:
        """The visibility tiers were cut; a filled field is org-readable."""
        relations = (ViewerRelation.SELF, ViewerRelation.ORG_ADMIN, ViewerRelation.MEMBER)
        rendered = [profile_to_proto(_payload(), relation=relation) for relation in relations]
        for person in rendered:
            assert person.email == "jane@example.com"
            assert person.mobile_phone == "+456"
            assert person.birthday == "04-12"
            assert person.bio == "Builds things."
            assert person.job_title == "VP Engineering"

    def test_absent_field_stays_unset_rather_than_empty(self) -> None:
        person = profile_to_proto(_payload(mobile_phone=None), relation=ViewerRelation.SELF)
        assert not person.HasField("mobile_phone")


class TestNoContentBypass:
    async def test_org_admin_gets_no_content_bypass(self) -> None:
        """An org admin editing a profile must not reach that member's content."""
        admin_id = generate_id()
        org_id = generate_id()
        checker = PermissionChecker(MagicMock())

        # The people surface calls this admin ORG_ADMIN for edit affordances.
        assert relation_for(admin_id, generate_id(), is_admin=True) is ViewerRelation.ORG_ADMIN

        with patch(
            "uniffy.core.auth.permissions.checker.load_scalar_authorization_facts",
            AsyncMock(return_value=_admin_facts()),
        ):
            role = await checker.effective_role(
                user_id=admin_id,
                organization_id=org_id,
                content_type=ContentType.NOTE,
                content_id=generate_id(),
                owner_id=generate_id(),
                access_mode=AccessMode.OWNER_ONLY,
                baseline_role=None,
            )
        assert role is None

    async def test_org_admin_gets_no_bypass_on_explicit_members(self) -> None:
        checker = PermissionChecker(MagicMock())
        with patch(
            "uniffy.core.auth.permissions.checker.load_scalar_authorization_facts",
            AsyncMock(return_value=_admin_facts()),
        ):
            role = await checker.effective_role(
                user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=generate_id(),
                owner_id=generate_id(),
                access_mode=AccessMode.EXPLICIT_MEMBERS,
                baseline_role=ContentRole.EDITOR,
            )
        assert role is None

    def test_people_registers_no_manage_override(self) -> None:
        assert ContentType.USER not in _manage_overrides

    def test_people_domain_never_reaches_for_the_content_path(self) -> None:
        offenders = {}
        for path in sorted(PEOPLE_DIR.rglob("*.py")):
            found = _content_path_references(ast.parse(path.read_text()))
            if found:
                offenders[path.name] = sorted(found)
        assert offenders == {}

    def test_the_guard_would_catch_a_real_reference(self) -> None:
        """A guard that cannot fail is not a guard."""
        tree = ast.parse("from uniffy.core.auth.permissions.checker import PermissionChecker")
        assert _content_path_references(tree)
