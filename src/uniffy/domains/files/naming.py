"""Filename rules shared by file mutations and the asset routes."""

from urllib.parse import quote


def file_extension(filename: str) -> str:
    """`.mp4` for `clip.mp4`; empty for dotfiles and names without a dot."""
    dot = filename.rfind(".")
    if dot <= 0 or dot == len(filename) - 1:
        return ""
    return filename[dot:]


def content_disposition(disposition: str, filename: str) -> str:
    """RFC 6266 value; HTTP headers are latin-1, so a non-ASCII name rides `filename*`."""
    fallback = filename.encode("ascii", "replace").decode("ascii")
    fallback = "".join(
        char if char.isprintable() and char not in {'"', "\\"} else "_" for char in fallback
    )
    if fallback == filename:
        return f'{disposition}; filename="{fallback}"'
    encoded = quote(filename, safe="")
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
