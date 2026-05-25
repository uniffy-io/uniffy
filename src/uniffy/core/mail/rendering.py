"""Render a registered mail template into ``(subject, html, text)``.

Templates ship as three sibling files per name:

* ``{name}.subject.j2`` -- single-line subject
* ``{name}.html.j2``    -- inline-styled HTML body
* ``{name}.txt.j2``     -- plaintext alternative

The renderer loads all three through the singleton async environment.
Subject newlines are stripped after render -- some MTAs reject headers
that contain bare CRLF.
"""

from typing import Any, NamedTuple

from jinja2 import TemplateNotFound

from uniffy.core.mail.errors import TemplateNotFoundError
from uniffy.core.mail.jinja_env import get_jinja_env


class RenderedMail(NamedTuple):
    """Output of ``render_template``."""

    subject: str
    html: str
    text: str


async def render_template(template_name: str, context: dict[str, Any]) -> RenderedMail:
    """Render the subject + html + text variants of ``template_name``.

    Raises ``TemplateNotFoundError`` when any of the three files is
    absent so a typo in a caller surfaces as a typed error instead of
    a Jinja exception leaking through the call stack.
    """
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
