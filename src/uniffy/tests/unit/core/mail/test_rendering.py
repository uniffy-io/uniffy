"""Pure-Jinja tests for template rendering."""

import asyncio

import pytest

from uniffy.core.mail import RenderedMail, TemplateNotFoundError, render_template


def _run(coro):
    return asyncio.run(coro)


class TestRenderTemplate:
    def test_admin_test_renders_all_three_parts(self) -> None:
        result = _run(
            render_template(
                "admin/test",
                {
                    "sent_at": "2026-05-21T14:30:00Z",
                    "config_source": "env",
                    "org_name": "Acme",
                },
            )
        )
        assert isinstance(result, RenderedMail)
        assert "Test email from Uniffy" in result.subject
        assert "Acme" in result.subject
        assert "Mail delivery is working" in result.text
        assert "Mail delivery is working" in result.html
        assert "Acme" in result.text
        assert "Acme" in result.html

    def test_subject_is_single_line(self) -> None:
        result = _run(
            render_template(
                "admin/test",
                {
                    "sent_at": "2026-05-21T14:30:00Z",
                    "config_source": "env",
                    "org_name": "Multi\nLine\nName",
                },
            )
        )
        assert "\n" not in result.subject

    def test_missing_template_raises(self) -> None:
        with pytest.raises(TemplateNotFoundError):
            _run(render_template("does/not/exist", {}))

    def test_strict_undefined_surfaces_missing_context(self) -> None:
        from jinja2.exceptions import UndefinedError

        with pytest.raises(UndefinedError):
            _run(render_template("admin/test", {}))
