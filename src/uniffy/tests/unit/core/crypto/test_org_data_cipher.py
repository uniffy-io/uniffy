"""OrgDataCipher sealing, receipt digests and key caches, on static keys without a database."""

import asyncio
import os
import re
import struct
from collections.abc import Callable
from uuid import UUID

import pytest

from uniffy.core.crypto import (
    SEAL_OVERHEAD_BYTES,
    OrgDataCipher,
    OrgDekNotFoundError,
    SealedDataError,
    StaticKeySource,
    get_org_active_dek_versions,
    get_org_data_key_lru,
)
from uniffy.core.crypto import cache as cache_module
from uniffy.core.crypto.pubsub import _handle_invalidate_message
from uniffy.core.types import generate_id

AAD = b"scope:update:actor"


class RotatingKeys:
    """Every version an organization ever had stays readable; one of them is active."""

    def __init__(self, organization_id: UUID, *, delay: float = 0) -> None:
        self.organization_id = organization_id
        self.versions = {1: os.urandom(32)}
        self.active_version = 1
        self.active_reads = 0
        self.version_reads: list[int] = []
        self.delay = delay

    def rotate(self) -> None:
        self.active_version += 1
        self.versions[self.active_version] = os.urandom(32)

    async def active(self, organization_id: UUID) -> tuple[int, bytes]:
        self.active_reads += 1
        await asyncio.sleep(self.delay)
        if organization_id != self.organization_id:
            raise OrgDekNotFoundError("no DEK")
        return self.active_version, self.versions[self.active_version]

    async def version(self, organization_id: UUID, version: int) -> bytes | None:
        self.version_reads.append(version)
        await asyncio.sleep(self.delay)
        if organization_id != self.organization_id:
            return None
        return self.versions.get(version)


def static_cipher(*organizations: UUID) -> OrgDataCipher:
    return OrgDataCipher(StaticKeySource({org: (1, os.urandom(32)) for org in organizations}))


async def test_sealed_bytes_open_to_the_plaintext_under_the_same_associated_data() -> None:
    organization = generate_id()
    cipher = static_cipher(organization)

    sealed = await cipher.seal(organization, b"typed text", aad=AAD)

    assert await cipher.unseal(organization, sealed, aad=AAD) == b"typed text"
    assert b"typed text" not in sealed


async def test_sealed_layout_is_format_version_nonce_then_ciphertext_and_tag() -> None:
    organization = generate_id()
    cipher = static_cipher(organization)
    plaintext = b"x" * 100

    first = await cipher.seal(organization, plaintext, aad=AAD)
    second = await cipher.seal(organization, plaintext, aad=AAD)

    assert SEAL_OVERHEAD_BYTES == 33
    assert len(first) == len(plaintext) + SEAL_OVERHEAD_BYTES
    assert first[0] == 0x01
    assert struct.unpack(">I", first[1:5]) == (1,)
    # A fresh nonce per seal: equal plaintexts never produce equal records.
    assert first[5:17] != second[5:17]
    assert first != second


async def test_an_empty_plaintext_still_carries_the_full_overhead() -> None:
    organization = generate_id()
    cipher = static_cipher(organization)

    sealed = await cipher.seal(organization, b"", aad=AAD)

    assert len(sealed) == SEAL_OVERHEAD_BYTES
    assert await cipher.unseal(organization, sealed, aad=AAD) == b""


def flipped(sealed: bytes, index: int) -> bytes:
    return sealed[:index] + bytes([sealed[index] ^ 0x01]) + sealed[index + 1 :]


@pytest.mark.parametrize(
    "tamper",
    [
        pytest.param(lambda sealed: flipped(sealed, len(sealed) - 1), id="flipped_tag"),
        pytest.param(lambda sealed: flipped(sealed, SEAL_OVERHEAD_BYTES - 16), id="flipped_body"),
        pytest.param(lambda sealed: flipped(sealed, 7), id="flipped_nonce"),
        pytest.param(lambda sealed: flipped(sealed, 0), id="unknown_format"),
        pytest.param(lambda sealed: sealed[:1] + struct.pack(">I", 2) + sealed[5:], id="version"),
        pytest.param(lambda sealed: sealed[: SEAL_OVERHEAD_BYTES - 1], id="truncated"),
        pytest.param(lambda sealed: b"", id="empty"),
    ],
)
async def test_tampered_or_truncated_bytes_refuse_to_open(
    tamper: Callable[[bytes], bytes],
) -> None:
    organization = generate_id()
    cipher = static_cipher(organization)
    sealed = await cipher.seal(organization, b"typed text", aad=AAD)

    with pytest.raises(SealedDataError):
        await cipher.unseal(organization, tamper(sealed), aad=AAD)


@pytest.mark.parametrize("version", [0, 2**31, 2**32 - 1])
async def test_a_version_outside_the_key_table_range_refuses_without_a_lookup(version: int) -> None:
    organization = generate_id()
    keys = RotatingKeys(organization)
    cipher = OrgDataCipher(keys)
    sealed = await cipher.seal(organization, b"typed text", aad=AAD)

    with pytest.raises(SealedDataError):
        await cipher.unseal(
            organization, sealed[:1] + struct.pack(">I", version) + sealed[5:], aad=AAD
        )
    assert keys.version_reads == []


async def test_concurrent_misses_share_one_key_load() -> None:
    organization = generate_id()
    keys = RotatingKeys(organization, delay=0.02)
    cipher = OrgDataCipher(keys)

    sealed = await asyncio.gather(
        *(cipher.seal(organization, b"typed text", aad=AAD) for _ in range(50))
    )
    assert keys.active_reads == 1

    await get_org_data_key_lru().invalidate(organization)
    opened = await asyncio.gather(*(cipher.unseal(organization, s, aad=AAD) for s in sealed))
    assert opened == [b"typed text"] * 50
    assert keys.version_reads == [1]


class FirstLoadFails(RotatingKeys):
    async def active(self, organization_id: UUID) -> tuple[int, bytes]:
        if self.active_reads == 0:
            self.active_reads += 1
            await asyncio.sleep(self.delay)
            raise OSError("database unreachable")
        return await super().active(organization_id)


async def test_a_failed_load_lets_the_next_waiter_load_again() -> None:
    organization = generate_id()
    keys = FirstLoadFails(organization, delay=0.02)
    cipher = OrgDataCipher(keys)

    first, second = await asyncio.gather(
        cipher.seal(organization, b"typed text", aad=AAD),
        cipher.seal(organization, b"typed text", aad=AAD),
        return_exceptions=True,
    )

    assert isinstance(first, OSError)
    assert isinstance(second, bytes)
    assert keys.active_reads == 2


async def test_other_associated_data_or_organization_refuses_to_open() -> None:
    organization, other = generate_id(), generate_id()
    cipher = static_cipher(organization, other)
    sealed = await cipher.seal(organization, b"typed text", aad=AAD)

    with pytest.raises(SealedDataError):
        await cipher.unseal(organization, sealed, aad=AAD + b"x")
    with pytest.raises(SealedDataError):
        await cipher.unseal(other, sealed, aad=AAD)


async def test_an_organization_without_a_dek_cannot_seal() -> None:
    with pytest.raises(OrgDekNotFoundError):
        await static_cipher().seal(generate_id(), b"typed text", aad=AAD)


async def test_receipt_digest_is_keyed_hex_per_organization() -> None:
    organization, other = generate_id(), generate_id()
    cipher = static_cipher(organization, other)

    digest = await cipher.receipt_digest(organization, b"typed text")

    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert await cipher.receipt_digest(organization, b"typed text") == digest
    assert await cipher.receipt_digest(other, b"typed text") != digest
    assert await cipher.receipt_digest(organization, b"other text") != digest


async def test_retired_versions_stay_readable_after_a_rotation() -> None:
    organization = generate_id()
    keys = RotatingKeys(organization)
    cipher = OrgDataCipher(keys)
    before = await cipher.seal(organization, b"before", aad=AAD)
    digest = await cipher.receipt_digest(organization, b"before")

    keys.rotate()
    await _handle_invalidate_message({"organization_id": str(organization)})
    after = await cipher.seal(organization, b"after", aad=AAD)

    assert struct.unpack(">I", after[1:5]) == (2,)
    assert await cipher.unseal(organization, before, aad=AAD) == b"before"
    assert await cipher.unseal(organization, after, aad=AAD) == b"after"
    # The receipt key rotates with the DEK, so a retry across a rotation is an id conflict.
    assert await cipher.receipt_digest(organization, b"before") != digest


async def test_invalidation_drops_derived_keys_and_the_active_version() -> None:
    organization = generate_id()
    keys = RotatingKeys(organization)
    cipher = OrgDataCipher(keys)
    await cipher.seal(organization, b"typed text", aad=AAD)
    await cipher.receipt_digest(organization, b"typed text")
    assert keys.active_reads == 1
    assert await get_org_data_key_lru().get(organization, 1) is not None
    assert await get_org_active_dek_versions().get(organization) == 1

    await _handle_invalidate_message({"organization_id": str(organization)})

    assert await get_org_data_key_lru().get(organization, 1) is None
    assert await get_org_active_dek_versions().get(organization) is None
    await cipher.seal(organization, b"typed text", aad=AAD)
    assert keys.active_reads == 2


async def test_the_active_version_is_read_again_once_its_ttl_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization = generate_id()
    keys = RotatingKeys(organization)
    cipher = OrgDataCipher(keys)
    await cipher.seal(organization, b"typed text", aad=AAD)
    keys.rotate()

    monkeypatch.setattr(cache_module, "_ACTIVE_VERSION_TTL_SECONDS", -1)
    sealed = await cipher.seal(organization, b"typed text", aad=AAD)

    assert keys.active_reads == 2
    assert struct.unpack(">I", sealed[1:5]) == (2,)


async def test_derived_keys_never_show_their_bytes() -> None:
    organization = generate_id()
    await static_cipher(organization).seal(organization, b"typed text", aad=AAD)
    derived = await get_org_data_key_lru().get(organization, 1)

    assert derived is not None
    assert derived.mac_key.hex() not in repr(derived)
    assert str(derived.mac_key) not in repr(derived)


def test_static_keys_must_hold_32_bytes() -> None:
    with pytest.raises(ValueError):
        StaticKeySource({generate_id(): (1, b"short")})
