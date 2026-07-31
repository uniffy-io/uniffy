"""Pure-Jinja tests for template rendering."""


import pytest

from uniffy.core.mail import RenderedMail, TemplateNotFoundError, render_template


class TestRenderTemplate:
    async def test_admin_test_renders_all_three_parts(self) -> None:
        result = await render_template(
            "admin/test",
            {
                "sent_at": "2026-05-21T14:30:00Z",
                "config_source": "env",
                "org_name": "Acme",
            },
        )
        assert isinstance(result, RenderedMail)
        assert "Test email from Uniffy" in result.subject
        assert "Acme" in result.subject
        assert "Mail delivery is working" in result.text
        assert "Mail delivery is working" in result.html
        assert "Acme" in result.text
        assert "Acme" in result.html

    async def test_subject_is_single_line(self) -> None:
        result = await render_template(
            "admin/test",
            {
                "sent_at": "2026-05-21T14:30:00Z",
                "config_source": "env",
                "org_name": "Multi\nLine\nName",
            },
        )
        assert "\n" not in result.subject

    async def test_missing_template_raises(self) -> None:
        with pytest.raises(TemplateNotFoundError):
            await render_template("does/not/exist", {})

    async def test_strict_undefined_surfaces_missing_context(self) -> None:
        from jinja2.exceptions import UndefinedError

        with pytest.raises(UndefinedError):
            await render_template("admin/test", {})
