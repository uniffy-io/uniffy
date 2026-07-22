"""Entity-type rank weights drive query-time sort tiebreaking.

Every searchable entity type needs an explicit weight; a type falling back
to the default silently mis-ranks. Chat messages must stay the lowest so
conversational noise never outranks primary content.
"""

from uniffy.core.search.indexer import (
    RANK_SCORE_BY_ENTITY_TYPE,
    default_rank_score,
)
from uniffy.domains.search.converters import ENTITY_TYPE_TO_PROTO


def test_every_searchable_entity_type_has_an_explicit_weight() -> None:
    missing = set(ENTITY_TYPE_TO_PROTO) - set(RANK_SCORE_BY_ENTITY_TYPE)
    assert not missing, f"entity types without a rank weight: {missing}"


def test_chat_messages_rank_below_all_primary_content() -> None:
    message_score = RANK_SCORE_BY_ENTITY_TYPE["chat_message"]
    for entity_type, score in RANK_SCORE_BY_ENTITY_TYPE.items():
        if entity_type == "chat_message":
            continue
        assert message_score < score


def test_lookup_is_case_insensitive_with_fallback() -> None:
    assert default_rank_score("NOTE") == RANK_SCORE_BY_ENTITY_TYPE["note"]
    assert default_rank_score("CHAT_MESSAGE") == RANK_SCORE_BY_ENTITY_TYPE["chat_message"]
    assert 0.0 < default_rank_score("something_new") <= 1.0
