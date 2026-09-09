from itertools import combinations

import pytest

from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills.resolution import (
    SkillInvocationError,
    SkillSummary,
    _validate_requirements,
    describe_compatibility,
)


@pytest.mark.parametrize("surfaces", [(), (SkillSurface.CHAT,), (SkillSurface.SESSION,)])
def test_diagnostics_agree_with_invocation_requirements(surfaces):
    skill = SkillSummary(
        id=generate_id(),
        version_id=generate_id(),
        version_number=2,
        name="report",
        display_name="Report",
        description="",
        requires_tools=("notes.read_note", "search.query"),
        supported_surfaces=surfaces,
    )
    tools = (*skill.requires_tools, "notes.create_note")
    for count in range(len(tools) + 1):
        for enabled in combinations(tools, count):
            available = frozenset(enabled)
            diagnostic = describe_compatibility(skill.id, skill, available, retired=True)
            assert diagnostic.version_id == skill.version_id
            assert diagnostic.retired
            for surface in SkillSurface:
                unavailable = surface in diagnostic.unsupported_surfaces or bool(
                    diagnostic.missing_tools
                )
                if unavailable:
                    with pytest.raises(SkillInvocationError):
                        _validate_requirements(skill, surface, available)
                else:
                    _validate_requirements(skill, surface, available)


def test_missing_snapshot_has_no_fabricated_version_or_requirements():
    skill_id = generate_id()
    diagnostic = describe_compatibility(skill_id, None, frozenset())
    assert diagnostic.unavailable
    assert diagnostic.skill_id == skill_id
    assert diagnostic.version_id is None
    assert diagnostic.version_number == 0
    assert diagnostic.missing_tools == ()
