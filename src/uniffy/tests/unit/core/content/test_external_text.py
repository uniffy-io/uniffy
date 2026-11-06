import pytest

from uniffy.core.content.external_text import neutralize_external_text, strip_controls

_TARGET = "urn:uniffy:content:USER:00000000-0000-0000-0000-000000000001"
_LONG_LABEL = "x" * 250


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (f"Ask [[[CEO|{_TARGET}]]] now", "Ask CEO now"),
        (f"[[[{_LONG_LABEL}|{_TARGET}]]]", _LONG_LABEL),
        (f"\\[\\[\\[CEO\\|{_TARGET}\\]\\]\\]", "CEO"),
        ("[[[Boss|URN:UNIFFY:CONTENT:USER:1]]]", "Boss"),
        # Fullwidth brackets turn into ASCII under NFKC, then collapse.
        (f"［［［CEO|{_TARGET}］］］", "CEO"),
        # Markup assembled from the pieces left by an inner collapse.
        (f"[[[[[[x|{_TARGET}]]]|{_TARGET}]]]", "x"),
    ],
)
def test_foreign_mention_markup_never_survives(raw: str, expected: str) -> None:
    neutralized = neutralize_external_text(raw)

    assert "|urn:" not in neutralized.lower()
    assert neutralized == expected


def test_ordinary_text_and_links_are_left_alone() -> None:
    text = "Standup in [room 4](https://example.com/rooms/4)\nBring notes"

    assert neutralize_external_text(text) == text


def test_hidden_controls_go_but_line_breaks_stay() -> None:
    assert strip_controls("a‮b​c\nd\te\x00") == "abc\nd\te"
