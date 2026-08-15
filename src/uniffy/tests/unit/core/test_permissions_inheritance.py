"""Unit tests for the live org-default permission inheritance model.

Covers :func:`resolve_effective_policy` and
:meth:`ContentMembersOperations._validate_access_mode`. Integration
tests for the SQL filter and realtime / reindex side effects live with
the broader domain tests.
"""

import pytest

from uniffy.core.auth.permissions.defaults import resolve_effective_policy
from uniffy.core.content.members import ContentMembersOperations
from uniffy.core.errors import ValidationError
from uniffy.core.types import AccessMode, ContentRole


class TestResolveEffectivePolicy:
    """Truth table for the resolver. Pure function, no DB."""

    def test_null_row_uses_org_default(self) -> None:
        mode, baseline = resolve_effective_policy(
            None,
            None,
            AccessMode.OPEN_TO_ORG,
            ContentRole.EDITOR,
        )
        assert mode == AccessMode.OPEN_TO_ORG
        assert baseline == ContentRole.EDITOR

    def test_null_row_no_default_falls_back_to_owner_only(self) -> None:
        mode, baseline = resolve_effective_policy(None, None, None, None)
        assert mode == AccessMode.OWNER_ONLY
        assert baseline is None

    def test_explicit_override_wins_over_default(self) -> None:
        mode, baseline = resolve_effective_policy(
            AccessMode.OWNER_ONLY,
            None,
            AccessMode.OPEN_TO_ORG,
            ContentRole.EDITOR,
        )
        assert mode == AccessMode.OWNER_ONLY
        assert baseline is None

    def test_explicit_open_to_org_with_explicit_baseline(self) -> None:
        mode, baseline = resolve_effective_policy(
            AccessMode.OPEN_TO_ORG,
            ContentRole.EDITOR,
            AccessMode.OWNER_ONLY,
            None,
        )
        assert mode == AccessMode.OPEN_TO_ORG
        assert baseline == ContentRole.EDITOR

    def test_explicit_open_to_org_with_null_baseline_inherits_org_default(self) -> None:
        mode, baseline = resolve_effective_policy(
            AccessMode.OPEN_TO_ORG,
            None,
            None,
            ContentRole.VIEWER,
        )
        assert mode == AccessMode.OPEN_TO_ORG
        assert baseline == ContentRole.VIEWER

    def test_explicit_open_to_org_with_null_baseline_no_default_falls_back_to_viewer(self) -> None:
        mode, baseline = resolve_effective_policy(
            AccessMode.OPEN_TO_ORG,
            None,
            None,
            None,
        )
        assert mode == AccessMode.OPEN_TO_ORG
        assert baseline == ContentRole.VIEWER

    def test_explicit_explicit_members_clears_baseline(self) -> None:
        mode, baseline = resolve_effective_policy(
            AccessMode.EXPLICIT_MEMBERS,
            ContentRole.EDITOR,  # baseline is meaningless for non-OPEN_TO_ORG
            None,
            None,
        )
        assert mode == AccessMode.EXPLICIT_MEMBERS
        assert baseline is None


class TestValidateAccessMode:
    """Validator accepts inherit-shape inputs, rejects malformed pairs."""

    def _ops(self) -> ContentMembersOperations:
        # Validator is a pure method; bypass __init__ to skip the
        # session requirement.
        return ContentMembersOperations.__new__(ContentMembersOperations)

    def test_null_mode_null_baseline_is_valid_inherit_shape(self) -> None:
        self._ops()._validate_access_mode(None, None)

    def test_null_mode_with_baseline_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._ops()._validate_access_mode(None, ContentRole.VIEWER)

    def test_open_to_org_with_null_baseline_is_valid(self) -> None:
        # NULL baseline = "inherit org default baseline".
        self._ops()._validate_access_mode(AccessMode.OPEN_TO_ORG, None)

    def test_open_to_org_with_editor_is_valid(self) -> None:
        self._ops()._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.EDITOR)

    def test_open_to_org_with_owner_baseline_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._ops()._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.OWNER)

    def test_open_to_org_with_blocked_baseline_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._ops()._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.BLOCKED)

    def test_owner_only_with_baseline_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._ops()._validate_access_mode(AccessMode.OWNER_ONLY, ContentRole.VIEWER)

    def test_explicit_members_with_baseline_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._ops()._validate_access_mode(
                AccessMode.EXPLICIT_MEMBERS,
                ContentRole.VIEWER,
            )
