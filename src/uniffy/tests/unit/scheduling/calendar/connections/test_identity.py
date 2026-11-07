"""Canonical UIDs and email addresses for matching provider and Uniffy records."""

import pytest

from uniffy.domains.scheduling.calendar.connections.identity import normalize_email, normalize_uid

EXCHANGE_UID = "040000008200E00074C5B7101A82E00800000000D0BEF1E7F7D9DC010000000000000000100000004A"
# How Graph reports a meeting Google organized: the Google UID wrapped after "vCal-Uid".
WRAPPED_GOOGLE_UID = (
    "040000008200E00074C5B7101A82E0080000000000000000000000000000000000000000"
    "320000007643616C2D5569640100000035306261736D316E6F737135756D766F6537643067"
    "373163376F40676F6F676C652E636F6D00"
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (EXCHANGE_UID.lower(), EXCHANGE_UID),
        (f"  {EXCHANGE_UID}  ", EXCHANGE_UID),
        (WRAPPED_GOOGLE_UID, "50basm1nosq5umvoe7d0g71c7o@google.com"),
        (WRAPPED_GOOGLE_UID.lower(), "50basm1nosq5umvoe7d0g71c7o@google.com"),
        (EXCHANGE_UID + "ZZ", EXCHANGE_UID + "ZZ"),
        ("{8D3F0C1A-2B4E-4F6A-9C1D-0E2F3A4B5C6D}", "8D3F0C1A-2B4E-4F6A-9C1D-0E2F3A4B5C6D"),
        ("7k2m9q4r1s8t3u6v0w5x@google.com", "7k2m9q4r1s8t3u6v0w5x@google.com"),
        ("  Mixed-Case@uniffy.io ", "Mixed-Case@uniffy.io"),
        ("", None),
        ("   ", None),
        ("{}", None),
        (None, None),
    ],
)
def test_normalize_uid(raw: str | None, expected: str | None) -> None:
    assert normalize_uid(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" Maria@Contoso.COM ", "maria@contoso.com"),
        ("", None),
        (None, None),
        ("no-at-sign", None),
        ("a@b@c", None),
        ("@contoso.com", None),
        ("maria@", None),
    ],
)
def test_normalize_email(raw: str | None, expected: str | None) -> None:
    assert normalize_email(raw) == expected
