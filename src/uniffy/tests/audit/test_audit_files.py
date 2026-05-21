"""Destructive-action audit emissions for files + the upload feature flag.

``file.uploaded`` only emits when ``AUDIT_EVENTS_FILE_UPLOADED`` is
truthy in the environment. Storage volume hazard - default off.
"""

import os
from unittest.mock import patch

import pytest

from uniffy.domains.files.operations import _file_uploaded_audit_enabled


@pytest.mark.parametrize("env_value", ["1", "true", "True", "yes"])
def test_file_uploaded_audit_enabled_when_env_set_truthy(env_value: str) -> None:
    with patch.dict(os.environ, {"AUDIT_EVENTS_FILE_UPLOADED": env_value}):
        assert _file_uploaded_audit_enabled() is True


@pytest.mark.parametrize("env_value", ["0", "false", "no", "", "off"])
def test_file_uploaded_audit_disabled_by_default(env_value: str) -> None:
    with patch.dict(os.environ, {"AUDIT_EVENTS_FILE_UPLOADED": env_value}):
        assert _file_uploaded_audit_enabled() is False


def test_file_uploaded_audit_disabled_when_env_unset() -> None:
    env = dict(os.environ)
    env.pop("AUDIT_EVENTS_FILE_UPLOADED", None)
    with patch.dict(os.environ, env, clear=True):
        assert _file_uploaded_audit_enabled() is False
