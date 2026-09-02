"""Guards the engine-neutral workspace search schema against silent drift."""

from uniffy.core.search.policy import WORKSPACE_SEARCH_SCHEMA
from uniffy.core.search.stop_words import STOP_WORDS, STOP_WORDS_BG, STOP_WORDS_EN


def test_stop_words_are_wired_into_index_settings() -> None:
    assert WORKSPACE_SEARCH_SCHEMA.stop_words == STOP_WORDS


def test_search_schema_uses_engine_neutral_ranking_rules() -> None:
    assert WORKSPACE_SEARCH_SCHEMA.primary_key == "id"
    assert all(rule.value == str(rule) for rule in WORKSPACE_SEARCH_SCHEMA.ranking_rules)


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
