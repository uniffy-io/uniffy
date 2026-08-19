"""Staging detection gates upload privacy and link-in-place attaches."""

from uniffy.core.models.files.folder import Folder
from uniffy.core.types import generate_id
from uniffy.domains.files.attachments.operations import (
    ATTACHMENTS_FOLDER_NAME,
    ORG_ATTACHMENTS_FOLDER_NAME,
    is_attachment_staging_folder,
)


def _folder(**overrides) -> Folder:
    fields = {
        "organization_id": generate_id(),
        "owner_id": generate_id(),
        "name": ATTACHMENTS_FOLDER_NAME,
        "is_system": True,
        "is_org_attachments": False,
        "parent_id": None,
    }
    fields.update(overrides)
    return Folder(**fields)


def test_personal_attachments_folder_is_staging() -> None:
    assert is_attachment_staging_folder(_folder())


def test_org_attachments_folder_is_not_staging() -> None:
    assert not is_attachment_staging_folder(
        _folder(is_org_attachments=True, name=ORG_ATTACHMENTS_FOLDER_NAME)
    )
    # Even carrying the personal folder name, the org flag disqualifies it.
    assert not is_attachment_staging_folder(_folder(is_org_attachments=True))


def test_non_system_folder_is_not_staging() -> None:
    assert not is_attachment_staging_folder(_folder(is_system=False))


def test_nested_folder_is_not_staging() -> None:
    assert not is_attachment_staging_folder(_folder(parent_id=generate_id()))


def test_differently_named_folder_is_not_staging() -> None:
    assert not is_attachment_staging_folder(_folder(name="Recordings"))


def test_missing_folder_is_not_staging() -> None:
    assert not is_attachment_staging_folder(None)
