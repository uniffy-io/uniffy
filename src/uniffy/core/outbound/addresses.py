"""Which hosts a user-supplied URL may reach: public internet only, plus operator-opened ranges."""

import asyncio
import ipaddress
import os
import re
import socket
from collections.abc import Awaitable, Callable, Sequence
from enum import StrEnum
from urllib.parse import urlsplit, urlunsplit

MAX_URL_LENGTH = 2000

ALLOWED_PRIVATE_NETWORKS_ENV = "OUTBOUND_ALLOWED_PRIVATE_NETWORKS"

_SCHEME_ALIASES = {"webcal": "https", "webcals": "https"}
_FETCHABLE_SCHEMES = frozenset({"http", "https"})

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[Sequence[str]]]


class OutboundFailure(StrEnum):
    INVALID_URL = "INVALID_URL"
    UNRESOLVABLE = "UNRESOLVABLE"
    BLOCKED_ADDRESS = "BLOCKED_ADDRESS"
    UNREACHABLE = "UNREACHABLE"
    TIMEOUT = "TIMEOUT"
    HTTP_STATUS = "HTTP_STATUS"
    TOO_LARGE = "TOO_LARGE"
    REDIRECT_REFUSED = "REDIRECT_REFUSED"
    TOO_MANY_REDIRECTS = "TOO_MANY_REDIRECTS"


class OutboundFetchError(Exception):
    """A refused or failed fetch; its text never carries the URL, which may be a secret."""

    def __init__(self, failure: OutboundFailure, status: int | None = None) -> None:
        self.failure = failure
        self.status = status
        super().__init__(failure.value if status is None else f"{failure.value} {status}")


def _parse_networks(raw: str | None) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    if not raw:
        return ()
    networks = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError as exc:
            message = f"{ALLOWED_PRIVATE_NETWORKS_ENV} holds an invalid CIDR: {entry!r}"
            raise ValueError(message) from exc
    return tuple(networks)


# Parsed once so a typo fails the process at startup instead of on the first fetch.
ALLOWED_PRIVATE_NETWORKS = _parse_networks(os.getenv(ALLOWED_PRIVATE_NETWORKS_ENV))


def normalize_public_url(raw: str) -> str:
    """The canonical fetchable form of a URL a person typed, or ``INVALID_URL``."""
    text = (raw or "").strip()
    if not text or len(text) > MAX_URL_LENGTH:
        raise OutboundFetchError(OutboundFailure.INVALID_URL)
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise OutboundFetchError(OutboundFailure.INVALID_URL)
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError as exc:
        raise OutboundFetchError(OutboundFailure.INVALID_URL) from exc
    scheme = _SCHEME_ALIASES.get(parts.scheme.lower(), parts.scheme.lower())
    host = parts.hostname
    if scheme not in _FETCHABLE_SCHEMES or not host:
        raise OutboundFetchError(OutboundFailure.INVALID_URL)
    # Credentials in the URL would travel to every redirect target.
    if parts.username is not None or parts.password is not None:
        raise OutboundFetchError(OutboundFailure.INVALID_URL)
    try:
        ascii_host = host.encode("idna").decode("ascii") if not _is_ip_literal(host) else host
    except UnicodeError as exc:
        raise OutboundFetchError(OutboundFailure.INVALID_URL) from exc
    # Python and the transport's WHATWG parser must read the same host; a backslash
    # or percent sign is a host to one and a path or escape to the other.
    if not _is_ip_literal(ascii_host) and not _HOSTNAME.fullmatch(ascii_host):
        raise OutboundFetchError(OutboundFailure.INVALID_URL)
    netloc = (
        f"[{ascii_host}]"
        if isinstance(_ip_or_none(ascii_host), ipaddress.IPv6Address)
        else ascii_host
    )
    if port is not None:
        netloc = f"{netloc}:{port}"
    return urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))


_LABEL = r"[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?"
_HOSTNAME = re.compile(rf"{_LABEL}(\.{_LABEL})*\.?")


def _ip_or_none(host: str) -> IPAddress | None:
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def _is_ip_literal(host: str) -> bool:
    return _ip_or_none(host) is not None


def _embedded_ipv4(ip: IPAddress) -> ipaddress.IPv4Address | None:
    """The IPv4 address an IPv6 transition form actually routes to."""
    if not isinstance(ip, ipaddress.IPv6Address):
        return None
    if ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    if ip.sixtofour is not None:
        return ip.sixtofour
    if ip.teredo is not None:
        return ip.teredo[1]
    if ip in _NAT64:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_GLOBAL_UNICAST = ipaddress.ip_network("2000::/3")


def is_allowed_address(ip: IPAddress) -> bool:
    if any(ip in network for network in ALLOWED_PRIVATE_NETWORKS):
        return True
    embedded = _embedded_ipv4(ip)
    if embedded is not None:
        return is_allowed_address(embedded)
    # Deprecated IPv4-compatible and translated forms count as global but can route
    # to the embedded IPv4 address; only global unicast space is public.
    if isinstance(ip, ipaddress.IPv6Address) and ip not in _GLOBAL_UNICAST:
        return False
    return ip.is_global and not ip.is_multicast


async def _system_resolver(host: str, port: int) -> Sequence[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def resolve_public(
    host: str, port: int, *, resolver: Resolver | None = None
) -> tuple[str, ...]:
    """Every address the host resolves to, refused unless each one is allowed."""
    if _is_ip_literal(host):
        candidates: Sequence[str] = [host]
    else:
        try:
            candidates = await (resolver or _system_resolver)(host, port)
        except (OSError, UnicodeError) as exc:
            raise OutboundFetchError(OutboundFailure.UNRESOLVABLE) from exc
    if not candidates:
        raise OutboundFetchError(OutboundFailure.UNRESOLVABLE)
    addresses: list[str] = []
    for candidate in candidates:
        # A scoped IPv6 answer ("fe80::1%eth0") is link-local whatever its scope.
        ip = ipaddress.ip_address(candidate.split("%", 1)[0])
        # One private answer refuses the host: the connection may pick any of them.
        if not is_allowed_address(ip):
            raise OutboundFetchError(OutboundFailure.BLOCKED_ADDRESS)
        if str(ip) not in addresses:
            addresses.append(str(ip))
    return tuple(addresses)
