"""Mail subsystem models.

Per-org mail configuration lives in the generic ``org_settings`` table
(``uniffy.core.models.settings.OrgSetting``) under ``namespace="mail"``.
This package owns the global suppression list only.
"""

from uniffy.core.models.mail.suppression import EmailSuppression, EmailSuppressionReason

__all__ = ["EmailSuppression", "EmailSuppressionReason"]
