"""Mail templates use strict variables and HTML-only autoescape."""

from functools import lru_cache

from jinja2 import Environment, PackageLoader, StrictUndefined


@lru_cache(maxsize=1)
def get_jinja_env() -> Environment:
    return Environment(
        loader=PackageLoader("uniffy", "core/mail/templates"),
        enable_async=True,
        autoescape=lambda template_name: bool(template_name and template_name.endswith(".html.j2")),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
