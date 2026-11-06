"""Which URLs a person may make the server fetch, and which addresses they may reach."""

import ipaddress

import pytest

from uniffy.core.outbound import addresses
from uniffy.core.outbound.addresses import (
    OutboundFailure,
    OutboundFetchError,
    is_allowed_address,
    normalize_public_url,
    resolve_public,
)

_REFUSED = [
    "10.0.0.5",
    "172.16.4.1",
    "192.168.1.10",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "ff02::1",
    "::7f00:1",
    "::ffff:0:a00:1",
]


@pytest.mark.parametrize("raw", _REFUSED)
def test_private_and_special_addresses_are_refused(raw: str) -> None:
    assert not is_allowed_address(ipaddress.ip_address(raw))


@pytest.mark.parametrize("raw", ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"])
def test_public_addresses_pass(raw: str) -> None:
    assert is_allowed_address(ipaddress.ip_address(raw))


def test_an_operator_range_opens_a_private_network(monkeypatch) -> None:
    monkeypatch.setattr(
        addresses, "ALLOWED_PRIVATE_NETWORKS", addresses._parse_networks("10.20.0.0/16")
    )
    assert is_allowed_address(ipaddress.ip_address("10.20.3.4"))
    assert not is_allowed_address(ipaddress.ip_address("10.21.3.4"))


def test_a_malformed_operator_range_fails_loudly() -> None:
    with pytest.raises(ValueError, match="invalid CIDR"):
        addresses._parse_networks("10.0.0.0/8, not-a-network")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("webcal://Calendar.Example.com/feed.ics", "https://calendar.example.com/feed.ics"),
        ("webcals://example.com/x.ics?t=1", "https://example.com/x.ics?t=1"),
        ("  https://example.com  ", "https://example.com/"),
        ("http://example.com:8080/a", "http://example.com:8080/a"),
        ("https://bücher.example/cal.ics", "https://xn--bcher-kva.example/cal.ics"),
        ("https://[2606:2800::1]/c.ics", "https://[2606:2800::1]/c.ics"),
    ],
)
def test_urls_normalize_to_a_fetchable_form(raw: str, expected: str) -> None:
    assert normalize_public_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "ftp://example.com/feed.ics",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://user:pass@example.com/feed.ics",
        "https:///nohost",
        "https://example.com/a b",
        "https://example.com:99999/",
        "https://example.com/" + "a" * 2000,
        "https://127.0.0.1\\x.attacker.example/feed.ics",
        "https://a%2e127.0.0.1/feed.ics",
        "https://exa_mple-.example/",
    ],
)
def test_unfetchable_urls_are_refused(raw: str) -> None:
    with pytest.raises(OutboundFetchError) as caught:
        normalize_public_url(raw)
    assert caught.value.failure == OutboundFailure.INVALID_URL


async def test_one_private_answer_refuses_the_whole_host() -> None:
    async def resolver(host: str, port: int):
        return ["93.184.215.14", "10.0.0.7"]

    with pytest.raises(OutboundFetchError) as caught:
        await resolve_public("mixed.example", 443, resolver=resolver)
    assert caught.value.failure == OutboundFailure.BLOCKED_ADDRESS


async def test_a_literal_private_host_is_refused_without_resolving() -> None:
    async def resolver(host: str, port: int):
        raise AssertionError("a literal address must not be resolved")

    with pytest.raises(OutboundFetchError) as caught:
        await resolve_public("169.254.169.254", 80, resolver=resolver)
    assert caught.value.failure == OutboundFailure.BLOCKED_ADDRESS


async def test_an_unresolvable_host_is_reported_as_such() -> None:
    async def resolver(host: str, port: int):
        raise OSError("no such host")

    with pytest.raises(OutboundFetchError) as caught:
        await resolve_public("nowhere.invalid", 443, resolver=resolver)
    assert caught.value.failure == OutboundFailure.UNRESOLVABLE


async def test_public_answers_come_back_deduplicated() -> None:
    async def resolver(host: str, port: int):
        return ["93.184.215.14", "93.184.215.14", "2606:2800::1"]

    assert await resolve_public("example.com", 443, resolver=resolver) == (
        "93.184.215.14",
        "2606:2800::1",
    )
