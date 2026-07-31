"""Scrubbers for external text: mention collapse, control strip, NFKC, caps."""

import re

from uniffy.domains.integrations.format import scrub_external_code, scrub_external_text

_MENTION_MARKUP = re.compile(r"\[\[\[[^\]]*\|urn:")

_FULLWIDTH_GIT = "\uff27\uff49\uff54"


def test_mention_markup_collapses_to_its_label() -> None:
    out = scrub_external_text("See [[[My Note|urn:uniffy:content:NOTE:x]]] first")
    assert out == "See My Note first"


def test_assembled_markup_collapses_to_plain_text_over_repeated_passes() -> None:
    out = scrub_external_text("[[[a[[[b|urn:c]]]|urn:d]]]")
    assert out == "ab"
    assert not _MENTION_MARKUP.search(out)


def test_markup_hidden_behind_zero_width_characters_still_collapses() -> None:
    out = scrub_external_text("[[[a|urn:x\u200b]]]")
    assert out == "a"
    assert not _MENTION_MARKUP.search(out)


def test_markup_written_with_fullwidth_brackets_still_collapses() -> None:
    out = scrub_external_text("\uff3b\uff3b\uff3bx|urn:y\uff3d\uff3d\uff3d")
    assert out == "x"
    assert not _MENTION_MARKUP.search(out)


def test_bidi_and_zero_width_controls_are_stripped() -> None:
    assert scrub_external_text("a\u202eb\u2066c\u200bd\u200de") == "abcde"


def test_newline_and_tab_survive_but_carriage_return_is_dropped() -> None:
    assert scrub_external_text("a\nb\tc\rd") == "a\nb\tcd"


def test_text_scrub_applies_nfkc_normalization() -> None:
    assert scrub_external_text(_FULLWIDTH_GIT) == "Git"


def test_code_scrub_skips_nfkc_but_still_strips_bidi() -> None:
    assert scrub_external_code(_FULLWIDTH_GIT) == _FULLWIDTH_GIT
    assert scrub_external_code("a\u202eb\u200bc") == "abc"


def test_over_cap_text_ends_with_the_truncation_marker() -> None:
    out = scrub_external_text("x" * 60, cap=50)
    assert out.startswith("x" * 50)
    assert out.endswith("[truncated: showing 50 of 60 characters]")


def test_under_cap_text_is_unchanged() -> None:
    assert scrub_external_text("x" * 40, cap=50) == "x" * 40
    assert scrub_external_code("y" * 40, cap=50) == "y" * 40


def test_empty_inputs_return_empty_strings() -> None:
    assert scrub_external_text(None) == ""
    assert scrub_external_text("") == ""
    assert scrub_external_code(None) == ""
    assert scrub_external_code("") == ""
