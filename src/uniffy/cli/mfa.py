"""Break-glass MFA reset for self-hosted deployments.

Gated by ``ENABLE_BREAK_GLASS_CLI=1`` so it is absent from cloud containers by default.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime

from loguru import logger
from sqlalchemy import delete, select, update

from uniffy.core.audit.actions import Action
from uniffy.core.audit.writer import write_audit_event
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_recovery_code import UserRecoveryCode
from uniffy.db.session import open_session

ENV_GATE = "ENABLE_BREAK_GLASS_CLI"


def run() -> None:
    if os.environ.get(ENV_GATE, "").strip() != "1":
        print(
            f"break-glass disabled: set {ENV_GATE}=1 to enable this command",
            file=sys.stderr,
        )
        sys.exit(2)

    parser = argparse.ArgumentParser(
        prog="python -m uniffy --mfa-reset",
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
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt (for non-interactive use).",
    )
    args = parser.parse_args(_consume_mode_arg(sys.argv[1:]))

    if not args.yes:
        prompt = (
            f"About to disable MFA on {args.user_email!r}. Reason: {args.reason!r}. "
            "Continue? [y/N]: "
        )
        confirm = input(prompt).strip().lower()
        if confirm not in {"y", "yes"}:
            print("Aborted.")
            sys.exit(1)

    asyncio.run(_reset(args.user_email, args.reason))


async def _reset(email: str, reason: str) -> None:
    async with open_session() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email!r}", file=sys.stderr)
            sys.exit(3)

        await session.execute(
            delete(UserRecoveryCode).where(UserRecoveryCode.user_id == user.id)
        )
        await session.execute(
            delete(UserMfa).where(UserMfa.user_id == user.id)
        )
        new_version = (user.token_version or 1) + 1
        await session.execute(
            update(User).where(User.id == user.id).values(token_version=new_version)
        )

        await write_audit_event(
            session,
            organization_id=None,
            actor_user_id=None,
            action=Action.AUTH_MFA_BREAK_GLASS_RESET,
            resource_type="USER",
            resource_id=user.id,
            details={
                "kind": "break_glass",
                "target_user_id": str(user.id),
                "target_email": user.email,
                "reason": reason.strip(),
                "ran_at": datetime.now(UTC).isoformat(),
            },
        )
        await session.commit()

    logger.info("mfa.break_glass: reset {email}", email=email)
    print(f"MFA disabled on {email}. Audit row written.")


def _consume_mode_arg(argv: list[str]) -> list[str]:
    return [a for a in argv if a != "--mfa-reset"]
