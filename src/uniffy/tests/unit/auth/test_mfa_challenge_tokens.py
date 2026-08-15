"""Type enforcement + expiry on the MFA challenge / enrollment-only tokens.

Both token types ride the same HS256 secret as access tokens. The
risk we test against is a challenge or enrollment-only token sneaking
through code that expected an access token; the type-claim decoders
must reject those, including the symmetric case (decoding an access
token as a challenge token).
"""

from __future__ import annotations

import time
from datetime import timedelta

import jwt
import pytest

from uniffy.core.types import generate_id
from uniffy.domains.auth.mfa.challenge import (
    ENROLLMENT_ALLOWED_RPCS,
    TOKEN_TYPE_ENROLLMENT_ONLY,
    TOKEN_TYPE_MFA_CHALLENGE,
    create_enrollment_only_token,
    create_mfa_challenge_token,
    decode_enrollment_only_token,
    decode_mfa_challenge_token,
)
from uniffy.domains.auth.tokens import create_access_token

# Tests must not depend on the CI environment carrying ``JWT_SECRET_KEY``.
# ``get_secret_key`` reads the env at call time, so an autouse fixture
# that sets it via ``monkeypatch`` is enough -- and it isolates the value
# per test so individual cases can override it (e.g. the wrong-secret
# rejection test below).
_TEST_SECRET = "test-32-byte-secret-padding-for-mfa-tests-0123"


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", _TEST_SECRET)


class TestChallengeTokenRoundtrip:
    def test_basic_roundtrip(self) -> None:
        uid = generate_id()
        token = create_mfa_challenge_token(uid)
        payload = decode_mfa_challenge_token(token)
        assert payload["sub"] == str(uid)
        assert payload["type"] == TOKEN_TYPE_MFA_CHALLENGE

    def test_carries_org_id(self) -> None:
        uid = generate_id()
        oid = generate_id()
        token = create_mfa_challenge_token(uid, organization_id=oid)
        payload = decode_mfa_challenge_token(token)
        assert payload["org_id"] == str(oid)

    def test_carries_token_version(self) -> None:
        uid = generate_id()
        token = create_mfa_challenge_token(uid, token_version=7)
        payload = decode_mfa_challenge_token(token)
        assert payload["tkv"] == 7


class TestEnrollmentTokenRoundtrip:
    def test_basic_roundtrip(self) -> None:
        uid = generate_id()
        token = create_enrollment_only_token(uid)
        payload = decode_enrollment_only_token(token)
        assert payload["sub"] == str(uid)
        assert payload["type"] == TOKEN_TYPE_ENROLLMENT_ONLY

    def test_allowed_rpcs_is_a_tight_set(self) -> None:
        # Three -- ``BeginEnrollment``, ``ConfirmEnrollment``,
        # ``GetMfaStatus``. Anything else means somebody widened the
        # blast radius without updating the doc.
        assert (
            frozenset({"BeginEnrollment", "ConfirmEnrollment", "GetMfaStatus"})
            == ENROLLMENT_ALLOWED_RPCS
        )


class TestTypeEnforcement:
    def test_decode_challenge_rejects_enrollment(self) -> None:
        token = create_enrollment_only_token(generate_id())
        with pytest.raises(jwt.InvalidTokenError):
            decode_mfa_challenge_token(token)

    def test_decode_enrollment_rejects_challenge(self) -> None:
        token = create_mfa_challenge_token(generate_id())
        with pytest.raises(jwt.InvalidTokenError):
            decode_enrollment_only_token(token)

    def test_decode_challenge_rejects_access_token(self) -> None:
        # Access tokens carry ``type="access"`` -- the challenge decoder
        # must reject those so an access token cannot be replayed as
        # a challenge.
        token = create_access_token(generate_id(), token_version=1)
        with pytest.raises(jwt.InvalidTokenError):
            decode_mfa_challenge_token(token)


class TestExpiry:
    def test_challenge_token_expires(self) -> None:
        # 0 minutes = already expired the instant pyjwt validates.
        token = create_mfa_challenge_token(generate_id(), expires_delta=timedelta(seconds=-1))
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_mfa_challenge_token(token)

    def test_enrollment_token_expires(self) -> None:
        token = create_enrollment_only_token(generate_id(), expires_delta=timedelta(seconds=-1))
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_enrollment_only_token(token)

    def test_freshly_issued_token_is_valid_now(self) -> None:
        token = create_mfa_challenge_token(generate_id())
        # Decode now (will not raise).
        decode_mfa_challenge_token(token)
        # And one nanosecond later (sanity, the clock should not have
        # advanced past exp).
        time.sleep(0)
        decode_mfa_challenge_token(token)


class TestSignatureRejection:
    def test_decoder_rejects_wrong_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Issue the token with the current secret, then change the
        # secret before decoding. The signature check must reject.
        token = create_mfa_challenge_token(generate_id())
        monkeypatch.setenv("JWT_SECRET_KEY", "a-completely-different-secret-here-pad")
        with pytest.raises(jwt.InvalidSignatureError):
            decode_mfa_challenge_token(token)
