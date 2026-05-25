"""Mail admin RPCs: per-organization SMTP configuration + test send.

Per-org mail config rows live in ``org_settings`` under
``namespace='mail'``; this domain is a thin wrapper that handles
admin gating, encryption of the SMTP password, cache invalidation on
write, and test-send dispatch through ``MailSender``.
"""

from uniffy.domains.mail.operations import OrgMailOperations
from uniffy.domains.mail.service import OrgMailServiceImpl

__all__ = ["OrgMailOperations", "OrgMailServiceImpl"]
