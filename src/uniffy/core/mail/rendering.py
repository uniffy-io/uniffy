"""Render a mail template name into ``(subject, html, text)``.

Templates ship as three sibling files: ``{name}.subject.j2``, ``{name}.html.j2``,
``{name}.txt.j2``. Subject newlines are stripped after render because some MTAs
reject headers with bare CRLF.
"""

from typing import Any, NamedTuple

from jinja2 import TemplateNotFound

from uniffy.core.mail.errors import TemplateNotFoundError
from uniffy.core.mail.jinja_env import get_jinja_env


class RenderedMail(NamedTuple):
    subject: str
    html: str
    text: str


async def render_template(template_name: str, context: dict[str, Any]) -> RenderedMail:
    """Render all three variants. Raises ``TemplateNotFoundError`` if any file is missing."""
    env = get_jinja_env()
    try:
        subject_tpl = env.get_template(f"{template_name}.subject.j2")
        html_tpl = env.get_template(f"{template_name}.html.j2")
        text_tpl = env.get_template(f"{template_name}.txt.j2")
    except TemplateNotFound as exc:
        raise TemplateNotFoundError(
            f"Template {template_name!r} is missing one of the .subject/.html/.txt variants",
            details={"name": template_name, "missing": str(exc)},
        ) from exc

    subject = (await subject_tpl.render_async(**context)).strip().replace("\n", " ")
    html = await html_tpl.render_async(**context)
    text = await text_tpl.render_async(**context)
    return RenderedMail(subject=subject, html=html, text=text)
