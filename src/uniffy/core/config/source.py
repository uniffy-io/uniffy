"""Which tier of the deployment settings chain produced a resolved value."""

from __future__ import annotations

from enum import StrEnum


class SettingSource(StrEnum):
    DEPLOYMENT = "deployment"
    ENV = "env"
    DEFAULT = "default"
