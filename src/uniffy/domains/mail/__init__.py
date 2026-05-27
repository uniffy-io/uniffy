"""Mail admin RPCs: per-org SMTP config + test send."""

from uniffy.domains.mail.operations import OrgMailOperations
from uniffy.domains.mail.service import OrgMailServiceImpl
from uniffy.domains.mail.system_operations import SystemMailOperations
from uniffy.domains.mail.system_service import SystemMailServiceImpl

__all__ = [
    "OrgMailOperations",
    "OrgMailServiceImpl",
    "SystemMailOperations",
    "SystemMailServiceImpl",
]
