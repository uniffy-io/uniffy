"""Static integrity of the Alembic revision chain.

These need no database, so they run on every push. They catch the failure
that only shows up at deploy time: two branches each adding a migration off
the same parent, which leaves two heads and makes `upgrade head` refuse to
run. Whether the migrations actually apply is a separate question, answered
by `tests/integration/internal/migrations/`.
"""

import re
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from uniffy.db.session import ALEMBIC_INI_PATH

VERSIONS_DIR = Path(ALEMBIC_INI_PATH).parent / "db" / "migrations" / "versions"

_FILENAME_RE = re.compile(r"^(\d+)_(\w+)\.py$")


@pytest.fixture(scope="module")
def script_directory() -> ScriptDirectory:
    config = Config(ALEMBIC_INI_PATH)
    config.attributes["configure_logger"] = False
    return ScriptDirectory.from_config(config)


def test_exactly_one_head(script_directory: ScriptDirectory) -> None:
    heads = script_directory.get_heads()
    assert len(heads) == 1, (
        f"{len(heads)} heads: {heads}. Two migrations share a down_revision, so "
        "`alembic upgrade head` will refuse to run. Rebase one onto the other."
    )


def test_revision_ids_are_unique(script_directory: ScriptDirectory) -> None:
    revisions = [script.revision for script in script_directory.walk_revisions()]
    duplicates = {r for r in revisions if revisions.count(r) > 1}
    assert not duplicates, f"duplicate revision ids: {sorted(duplicates)}"


def test_every_parent_resolves(script_directory: ScriptDirectory) -> None:
    known = {script.revision for script in script_directory.walk_revisions()}
    dangling = {
        script.revision: script.down_revision
        for script in script_directory.walk_revisions()
        if script.down_revision is not None and script.down_revision not in known
    }
    assert not dangling, f"down_revision points at a missing revision: {dangling}"


def test_the_chain_reaches_base_from_head(script_directory: ScriptDirectory) -> None:
    """Walking back from head must visit every revision on disk, once."""
    walked = [script.revision for script in script_directory.walk_revisions()]
    on_disk = {m.group(1) for name in VERSIONS_DIR.iterdir() if (m := _FILENAME_RE.match(name.name))}
    assert set(walked) == on_disk, (
        "revisions on disk and revisions reachable from head disagree; "
        f"unreachable: {sorted(on_disk - set(walked))}, "
        f"missing file: {sorted(set(walked) - on_disk)}"
    )


def test_filenames_carry_their_revision_id(script_directory: ScriptDirectory) -> None:
    """`071_agent_loaded_tool_groups.py` must be revision `071`.

    The numeric prefix is how a reviewer spots a collision in a diff, so it has
    to match what Alembic actually reads out of the file.
    """
    mismatched = []
    for script in script_directory.walk_revisions():
        filename = Path(script.path).name
        match = _FILENAME_RE.match(filename)
        if match is None:
            mismatched.append(f"{filename} (unexpected name shape)")
        elif match.group(1) != script.revision:
            mismatched.append(f"{filename} declares revision {script.revision!r}")
    assert not mismatched, f"filename and revision id disagree: {mismatched}"
