"""Generic per-org settings store keyed by ``(organization_id, namespace, key)``."""

from uniffy.domains.org_settings.operations import OrgSettingsOperations

__all__ = ["OrgSettingsOperations"]
