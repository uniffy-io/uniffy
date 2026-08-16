"""Guards the index-time relevancy settings against silent drift."""

from uniffy.core.search.meilisearch import INDEX_SETTINGS
from uniffy.core.search.stop_words import STOP_WORDS, STOP_WORDS_BG, STOP_WORDS_EN


def test_stop_words_are_wired_into_index_settings() -> None:
    assert INDEX_SETTINGS.stop_words == list(STOP_WORDS)


def test_stop_words_are_lowercase_and_unique() -> None:
    assert len(set(STOP_WORDS)) == len(STOP_WORDS)
    for word in STOP_WORDS:
        assert word == word.lower().strip()
        assert word


def test_language_lists_never_share_a_script() -> None:
    # Cyrillic tokens cannot collide with Latin ones; this split is what
    # makes the Bulgarian list unable to affect English content.
    for word in STOP_WORDS_EN:
        assert word.isascii(), word
    for word in STOP_WORDS_BG:
        assert not any("a" <= ch <= "z" for ch in word), word


def test_ambiguous_enterprise_terms_stay_searchable() -> None:
    # English: "it" (IT), "us" (US), "am"/"pm" (times), "will"/"may"/"can"
    # (names, month). Bulgarian: content nouns that pollute public lists.
    for word in ("it", "us", "am", "pm", "will", "may", "can"):
        assert word not in STOP_WORDS_EN
    for word in ("време", "година", "ден", "работа", "начин", "край"):
        assert word not in STOP_WORDS_BG
