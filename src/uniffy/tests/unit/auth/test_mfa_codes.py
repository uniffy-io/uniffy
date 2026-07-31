"""Recovery code generation, hashing, and verification.

Pure-function tests -- no DB, no Valkey. Covers the format invariants
(length, alphabet, structure), the Argon2 roundtrip, the
case-and-dash normalisation, and the no-collision property on the
random generator.
"""

from __future__ import annotations

import re

from uniffy.domains.auth.mfa.codes import (
    RECOVERY_CODE_ALPHABET,
    RECOVERY_CODE_COUNT,
    generate_recovery_code,
    generate_recovery_codes,
    hash_recovery_code,
    verify_recovery_code,
)


class TestRecoveryCodeFormat:
    """Codes must look like ``xxxx-xxxx-xxxx`` from the lower-case b32 alphabet."""

    SHAPE = re.compile(r"^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$")

    def test_shape(self) -> None:
        for _ in range(50):
            assert self.SHAPE.match(generate_recovery_code())

    def test_alphabet_is_lower_base32(self) -> None:
        # Sanity check the alphabet const is what we documented.
        assert RECOVERY_CODE_ALPHABET == "abcdefghijklmnopqrstuvwxyz234567"
        assert "0" not in RECOVERY_CODE_ALPHABET
        assert "1" not in RECOVERY_CODE_ALPHABET
        assert "8" not in RECOVERY_CODE_ALPHABET
        assert "9" not in RECOVERY_CODE_ALPHABET

    def test_batch_size(self) -> None:
        assert RECOVERY_CODE_COUNT == 10
        codes = generate_recovery_codes()
        assert len(codes) == 10
        assert all(self.SHAPE.match(c) for c in codes)

    def test_batch_size_custom(self) -> None:
        assert len(generate_recovery_codes(3)) == 3

    def test_batch_codes_are_unique(self) -> None:
        # 60 bits of entropy per code -- a duplicate inside one batch
        # of ten is statistically impossible, so any collision in this
        # test indicates a real bug.
        codes = generate_recovery_codes()
        assert len(set(codes)) == len(codes)


class TestRecoveryCodeHashing:
    """Argon2id roundtrip, normalisation, mismatch behaviour."""

    def test_verify_roundtrip(self) -> None:
        code = generate_recovery_code()
        h = hash_recovery_code(code)
        assert verify_recovery_code(code, h) is True

    def test_verify_mismatch(self) -> None:
        h = hash_recovery_code("aaaa-bbbb-cccc")
        assert verify_recovery_code("zzzz-yyyy-xxxx", h) is False

    def test_normalisation_strips_case(self) -> None:
        code = generate_recovery_code()
        h = hash_recovery_code(code)
        assert verify_recovery_code(code.upper(), h) is True

    def test_normalisation_strips_dashes(self) -> None:
        code = generate_recovery_code()
        h = hash_recovery_code(code)
        assert verify_recovery_code(code.replace("-", ""), h) is True

    def test_normalisation_strips_spaces(self) -> None:
        code = generate_recovery_code()
        h = hash_recovery_code(code)
        assert verify_recovery_code(f"  {code}  ", h) is True
        assert verify_recovery_code(code.replace("-", " - "), h) is True

    def test_hash_is_unique_per_call(self) -> None:
        # Argon2 emits a fresh salt every call, so two hashes of the
        # same plaintext must not be byte-identical (but must both
        # verify).
        code = generate_recovery_code()
        h1 = hash_recovery_code(code)
        h2 = hash_recovery_code(code)
        assert h1 != h2
        assert verify_recovery_code(code, h1) is True
        assert verify_recovery_code(code, h2) is True

    def test_verify_handles_garbage_hash(self) -> None:
        assert verify_recovery_code("anything", "not-an-argon2-hash") is False
