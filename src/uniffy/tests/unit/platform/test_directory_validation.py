"""Input normalization for platform org create/update."""

import pytest

from uniffy.core.errors import ValidationError
from uniffy.domains.platform.directory.operations import (
    derive_username,
    normalize_domain,
    normalize_org_name,
    normalize_plan,
    normalize_slug,
    normalize_username,
)


class TestNormalizeOrgName:
    def test_strips_whitespace(self):
        assert normalize_org_name("  Acme Inc  ") == "Acme Inc"

    def test_empty_raises(self):
        with pytest.raises(ValidationError):
            normalize_org_name("   ")

    def test_too_long_raises(self):
        with pytest.raises(ValidationError):
            normalize_org_name("a" * 256)


class TestNormalizeSlug:
    def test_valid_slug_passes_through(self):
        assert normalize_slug("acme-inc") == "acme-inc"

    def test_uppercase_is_lowered(self):
        assert normalize_slug("Acme-Inc") == "acme-inc"

    def test_empty_derives_from_fallback_name(self):
        assert normalize_slug("", fallback_name="Acme Inc!") == "acme-inc"

    def test_empty_without_fallback_raises(self):
        with pytest.raises(ValidationError):
            normalize_slug("")

    def test_spaces_raise(self):
        with pytest.raises(ValidationError):
            normalize_slug("acme inc")

    def test_single_char_raises(self):
        with pytest.raises(ValidationError):
            normalize_slug("a")

    def test_too_long_raises(self):
        with pytest.raises(ValidationError):
            normalize_slug("a" * 256)


class TestNormalizePlan:
    def test_empty_defaults_to_free(self):
        assert normalize_plan("") == "free"
        assert normalize_plan("   ") == "free"

    def test_known_plans_pass(self):
        for plan in ("free", "pro", "team", "business", "enterprise"):
            assert normalize_plan(plan) == plan

    def test_uppercase_is_lowered(self):
        assert normalize_plan("Enterprise") == "enterprise"

    def test_invalid_characters_raise(self):
        with pytest.raises(ValidationError):
            normalize_plan("bad plan!")

    def test_too_long_raises(self):
        with pytest.raises(ValidationError):
            normalize_plan("a" * 51)


class TestNormalizeUsername:
    def test_valid_username_passes(self):
        assert normalize_username("john.doe-42") == "john.doe-42"

    def test_uppercase_is_lowered(self):
        assert normalize_username("John") == "john"

    def test_leading_symbol_raises(self):
        with pytest.raises(ValidationError):
            normalize_username(".john")

    def test_single_char_raises(self):
        with pytest.raises(ValidationError):
            normalize_username("j")

    def test_spaces_raise(self):
        with pytest.raises(ValidationError):
            normalize_username("john doe")


class TestDeriveUsername:
    def test_local_part_survives(self):
        assert derive_username("alice@acme.com") == "alice"

    def test_disallowed_characters_stripped(self):
        assert derive_username("John.Doe+test@acme.com") == "john.doetest"

    def test_leading_separators_stripped(self):
        assert derive_username("._bob@acme.com") == "bob"

    def test_too_short_local_part_gets_prefix(self):
        assert derive_username("j@acme.com") == "user-j"


class TestNormalizeDomain:
    def test_empty_means_no_domain(self):
        assert normalize_domain("") is None
        assert normalize_domain("   ") is None

    def test_valid_domain_is_lowered(self):
        assert normalize_domain(" Acme.COM ") == "acme.com"

    def test_subdomains_pass(self):
        assert normalize_domain("eu.acme.co.uk") == "eu.acme.co.uk"

    def test_bare_label_raises(self):
        with pytest.raises(ValidationError):
            normalize_domain("localhost")

    def test_leading_hyphen_raises(self):
        with pytest.raises(ValidationError):
            normalize_domain("-bad.com")

    def test_garbage_raises(self):
        with pytest.raises(ValidationError):
            normalize_domain("not a domain")
