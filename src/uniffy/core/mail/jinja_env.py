"""Singleton async Jinja2 environment for mail templates.

``StrictUndefined`` so a missing context key fails loudly in tests rather than
silently rendering an empty span in production mail.
"""

from functools import lru_cache

from jinja2 import Environment, PackageLoader, StrictUndefined, select_autoescape


@lru_cache(maxsize=1)
def get_jinja_env() -> Environment:
    return Environment(
        loader=PackageLoader("uniffy", "core/mail/templates"),
        enable_async=True,
        autoescape=select_autoescape(enabled_extensions=("html", "j2")),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
