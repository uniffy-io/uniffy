"""Mail admin RPCs: per-org SMTP config + test send."""

from uniffy.domains.mail.operations import OrgMailOperations
from uniffy.domains.mail.service import OrgMailServiceImpl
from uniffy.domains.mail.system.operations import SystemMailOperations
from uniffy.domains.mail.system.service import SystemMailServiceImpl

__all__ = [
    "OrgMailOperations",
    "OrgMailServiceImpl",
    "SystemMailOperations",
    "SystemMailServiceImpl",
]
