"""Request device metadata used by authentication sessions."""

import re

from connectrpc.request import RequestContext

_BROWSER_PATTERNS = [
    (re.compile(r"Edg(?:e)?/([\d.]+)"), "Edge"),
    (re.compile(r"OPR/([\d.]+)"), "Opera"),
    (re.compile(r"Chrome/([\d.]+)"), "Chrome"),
    (re.compile(r"Firefox/([\d.]+)"), "Firefox"),
    (re.compile(r"Safari/([\d.]+)"), "Safari"),
]

_OS_PATTERNS = [
    (re.compile(r"Android"), "Android"),
    (re.compile(r"iPhone|iPad|iPod"), "iOS"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Windows NT"), "Windows"),
    (re.compile(r"Macintosh|Mac OS X"), "macOS"),
    (re.compile(r"Linux"), "Linux"),
]

_APP_CLIENT_PATTERNS = [
    (
        re.compile(r"Uniffy/[\d.]+\s*\(\s*(?:iOS|iPadOS|iPhone|iPad|iPod)", re.I),
        "Uniffy for iOS",
    ),
    (re.compile(r"Uniffy/[\d.]+\s*\(\s*Android", re.I), "Uniffy for Android"),
    (re.compile(r"Uniffy/[\d.]+", re.I), "Uniffy app"),
]


def request_user_agent(ctx: RequestContext) -> str:
    return ctx.request_headers().get("user-agent", "")


def parse_device_label(user_agent: str) -> str:
    if not user_agent:
        return "Unknown device"

    for pattern, label in _APP_CLIENT_PATTERNS:
        if pattern.search(user_agent):
            return label

    browser = "Unknown browser"
    for pattern, name in _BROWSER_PATTERNS:
        if pattern.search(user_agent):
            browser = name
            break

    operating_system = "Unknown OS"
    for pattern, name in _OS_PATTERNS:
        if pattern.search(user_agent):
            operating_system = name
            break

    if browser == "Unknown browser" and operating_system == "Unknown OS":  # noqa: PLR2004
        return "Unknown device"

    return f"{browser} on {operating_system}"


__all__ = ["parse_device_label", "request_user_agent"]
