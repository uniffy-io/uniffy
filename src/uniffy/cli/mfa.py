"""Break-glass MFA reset for self-hosted deployments.

Gated by ``ENABLE_BREAK_GLASS_CLI=1`` so it is absent from cloud containers by default.
The operator running the command MUST identify themselves via ``--operator``
(or ``UNIFFY_BREAK_GLASS_OPERATOR``); the value is recorded in the audit row
so a reset is never anonymous.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime

from loguru import logger
from sqlalchemy import delete, select, update

from uniffy.cli import MFA_RESET_FLAG
from uniffy.core.audit.actions import Action
from uniffy.core.audit.writer import write_audit_event
from uniffy.core.auth.revocation import mark_sessions_revoked, mark_token_version_revoked
from uniffy.core.auth.sessions import stage_revoke_user_sessions
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_recovery_code import UserRecoveryCode
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.infrastructure.database.session import open_session

ENV_GATE = "ENABLE_BREAK_GLASS_CLI"
OPERATOR_ENV = "UNIFFY_BREAK_GLASS_OPERATOR"


def run() -> None:
    if os.environ.get(ENV_GATE, "").strip() != "1":  # noqa: PLR2004
        print(
            f"break-glass disabled: set {ENV_GATE}=1 to enable this command",
            file=sys.stderr,
        )
        sys.exit(2)

    parser = argparse.ArgumentParser(
        prog=f"python -m uniffy {MFA_RESET_FLAG}",
        description=(
            "Disable MFA on a single user as a self-hosted operator. "
            "Writes an unattributed audit row tagged 'break_glass'."
        ),
    )
    parser.add_argument(
        "--user-email",
        required=True,
        help="Target user's email address (exact match).",
    )
    parser.add_argument(
        "--reason",
        required=True,
        help="Free-text justification recorded in the audit row.",
    )
    parser.add_argument(
        "--operator",
        default=os.environ.get(OPERATOR_ENV, ""),
        help=(
            "Identifier of the operator running the command (email, username, "
            "or ticket id). Required; defaults to "
            f"${OPERATOR_ENV} when set."
        ),
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt (for non-interactive use).",
    )
    args = parser.parse_args(_consume_mode_arg(sys.argv[1:]))

    operator = (args.operator or "").strip()
    if not operator:
        print(
            f"--operator is required (or set ${OPERATOR_ENV}); refusing to write "
            "an unattributed break-glass audit row.",
            file=sys.stderr,
        )
        sys.exit(2)

    if not args.yes:
        prompt = (
            f"About to disable MFA on {args.user_email!r} as operator "
            f"{operator!r}. Reason: {args.reason!r}. Continue? [y/N]: "
        )
        confirm = input(prompt).strip().lower()
        if confirm not in {"y", "yes"}:
            print("Aborted.")
            sys.exit(1)

    asyncio.run(_reset(args.user_email, args.reason, operator=operator))


async def _reset(email: str, reason: str, *, operator: str) -> None:
    from uniffy.core.auth.emails import normalize_email

    normalized = normalize_email(email)
    async with open_session() as session:
        user = (
            await session.execute(select(User).where(User.email == normalized))
        ).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email!r}", file=sys.stderr)
            sys.exit(3)

        await session.execute(delete(UserRecoveryCode).where(UserRecoveryCode.user_id == user.id))
        await session.execute(delete(UserMfa).where(UserMfa.user_id == user.id))
        new_version = (user.token_version or 1) + 1
        await session.execute(
            update(User).where(User.id == user.id).values(token_version=new_version)
        )
        revoked_session_ids = await stage_revoke_user_sessions(session, user.id)

        await write_audit_event(
            session,
            organization_id=None,
            actor_user_id=None,
            action=Action.AUTH_MFA_BREAK_GLASS_RESET,
            resource_type=AuditResourceType.USER,
            resource_id=user.id,
            details={
                "kind": "break_glass",
                "target_user_id": str(user.id),
                "target_email": user.email,
                "operator": operator,
                "reason": reason.strip(),
                "ran_at": datetime.now(UTC).isoformat(),
                "revoked_session_count": len(revoked_session_ids),
            },
        )
        await session.commit()
        await mark_token_version_revoked(user.id, new_version)
        await mark_sessions_revoked(revoked_session_ids)
        await CallsLifecycle(open_session).evict_user(
            session,
            user.id,
            reason=CallEvictionReason.SESSION_REVOKED,
        )

    logger.info(
        "mfa.break_glass: reset {email} by operator {operator}",
        email=email,
        operator=operator,
    )
    print(f"MFA disabled on {email} by operator {operator}. Audit row written.")


def _consume_mode_arg(argv: list[str]) -> list[str]:
    return [a for a in argv if a != MFA_RESET_FLAG]
