"""Generic per-org settings store.

Every per-org configuration (mail today; branding, feature flags,
billing prefs, ingest webhook secrets, ...) lives in the single
``org_settings`` table under a domain-specific ``namespace``. This
package owns the CRUD seam plus the ``ReEncryptingConsumer``
registration so DEK rotation re-encrypts every ``is_secret=true`` row
regardless of which domain wrote it.
"""

from uniffy.domains.org_settings.operations import OrgSettingsOperations

__all__ = ["OrgSettingsOperations"]
