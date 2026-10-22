"""The workspace deletion mail tells an owner deletion apart from an operator deletion."""

from uniffy.core.mail.rendering import render_template
from uniffy.core.mail.templates import get_template

ORG_DELETED = "platform/org_deleted"

CONTEXT: dict = {
    "org_name": "Acme",
    "deleted_at": "October 01, 2026 at 09:30 UTC",
    "purge_at": "October 31, 2026 at 09:30 UTC",
    "grace_days": 30,
    "reason": "Abuse report",
}

OWNER_BODY = (
    "The owner of Acme deleted the workspace on October 01, 2026 at 09:30 UTC. "
    "Access to the workspace ends now. The data stays restorable for 30 days, until "
)
OPERATOR_BODY = "A platform operator marked your workspace for deletion on October 01, 2026"
OWNER_CLOSING = "This action is recorded in your workspace audit log."
OPERATOR_CLOSING = (
    "This action was performed by a platform operator and is recorded in your workspace audit log."
)
RESTORE_LINE = "A platform operator can restore it before then."


class TestOrgDeleted:
    def test_is_registered(self) -> None:
        assert get_template(ORG_DELETED).name == ORG_DELETED

    async def test_owner_copy_drops_the_operator_lines(self) -> None:
        rendered = await render_template(
            ORG_DELETED,
            {**CONTEXT, "reason": "Deleted by the organization owner", "deleted_by_owner": True},
        )

        assert rendered.subject == "Your Uniffy workspace Acme has been scheduled for deletion"
        assert OWNER_BODY + "October 31, 2026 at 09:30 UTC; " in rendered.text
        assert OWNER_BODY + "<strong>October 31, 2026 at 09:30 UTC</strong>; " in rendered.html
        for body in (rendered.text, rendered.html):
            assert OWNER_CLOSING in body
            assert RESTORE_LINE in body
            assert OPERATOR_BODY not in body
            assert OPERATOR_CLOSING not in body
            assert "Reason recorded" not in body
            assert "Deleted by the organization owner" not in body

    async def test_operator_copy_keeps_the_reason_and_attribution(self) -> None:
        rendered = await render_template(ORG_DELETED, {**CONTEXT, "deleted_by_owner": False})

        assert rendered.subject == "Your Uniffy workspace Acme has been scheduled for deletion"
        assert "Reason recorded by the operator: Abuse report" in rendered.text
        assert "<strong>Reason recorded by the operator:</strong> Abuse report" in rendered.html
        for body in (rendered.text, rendered.html):
            assert OPERATOR_BODY in body
            assert OPERATOR_CLOSING in body
            assert RESTORE_LINE in body
            assert "The owner of Acme" not in body

    async def test_operator_copy_without_a_reason_skips_the_reason_line(self) -> None:
        rendered = await render_template(
            ORG_DELETED, {**CONTEXT, "reason": "", "deleted_by_owner": False}
        )

        assert "Reason recorded" not in rendered.text
        assert "Reason recorded" not in rendered.html

    async def test_operator_copy_is_the_fallback_without_the_flag(self) -> None:
        # A mail queued with no flag can only come from an operator deletion.
        without_flag = await render_template(ORG_DELETED, CONTEXT)
        operator = await render_template(ORG_DELETED, {**CONTEXT, "deleted_by_owner": False})

        assert without_flag == operator
        assert OPERATOR_BODY in without_flag.text
