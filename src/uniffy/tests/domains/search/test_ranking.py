"""Type-priority re-ranking: tiers apply within match-strength buckets, so
a typo/partial match never rides its type above a full match.
"""

from uuid import uuid4

from uniffy.domains.search.queries import SearchResult, apply_type_priority

CHAT_PRIORITY = ["user", "chat", "agent_chat", "chat_message"]


def make_result(entity_type: str, urn: str, score: float | None) -> SearchResult:
    return SearchResult(
        urn=urn,
        organization_id=uuid4(),
        title=urn,
        description=None,
        entity_type=entity_type,
        url_path=f"/{urn}",
        access_mode="OWNER_ONLY",
        baseline_role=None,
        owner_id=uuid4(),
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=1.0,
        search_score=score,
    )


def urns(results: list[SearchResult]) -> list[str]:
    return [r.urn for r in results]


def test_weak_user_match_stays_below_full_matches() -> None:
    results = [
        make_result("chat_message", "msg-1", 0.99),
        make_result("chat_message", "msg-2", 0.98),
        make_result("user", "eve", 0.55),
    ]
    ranked = apply_type_priority(results, CHAT_PRIORITY)
    assert urns(ranked) == ["msg-1", "msg-2", "eve"]


def test_tiers_order_within_strong_bucket() -> None:
    results = [
        make_result("note", "note-1", 0.97),
        make_result("chat_message", "msg-1", 0.99),
        make_result("agent_chat", "agent-chat-1", 0.98),
        make_result("chat", "channel-1", 0.96),
        make_result("user", "user-1", 0.95),
    ]
    ranked = apply_type_priority(results, CHAT_PRIORITY)
    assert urns(ranked) == ["user-1", "channel-1", "agent-chat-1", "msg-1", "note-1"]


def test_weak_bucket_is_tier_ordered_after_strong() -> None:
    results = [
        make_result("chat_message", "msg-strong", 1.0),
        make_result("note", "note-weak", 0.5),
        make_result("user", "user-weak", 0.4),
    ]
    ranked = apply_type_priority(results, CHAT_PRIORITY)
    assert urns(ranked) == ["msg-strong", "user-weak", "note-weak"]


def test_no_scores_falls_back_to_pure_tier_order() -> None:
    # Filter-only browsing carries no ranking score; one bucket, tiers apply.
    results = [
        make_result("note", "note-1", None),
        make_result("user", "user-1", None),
        make_result("note", "note-2", None),
    ]
    ranked = apply_type_priority(results, CHAT_PRIORITY)
    assert urns(ranked) == ["user-1", "note-1", "note-2"]


def test_order_is_stable_within_tier_and_bucket() -> None:
    results = [
        make_result("chat_message", "msg-1", 0.99),
        make_result("chat_message", "msg-2", 0.97),
        make_result("chat_message", "msg-3", 0.96),
    ]
    ranked = apply_type_priority(results, CHAT_PRIORITY)
    assert urns(ranked) == ["msg-1", "msg-2", "msg-3"]


def test_empty_priority_returns_input_unchanged() -> None:
    results = [
        make_result("note", "note-1", 0.9),
        make_result("user", "user-1", 0.5),
    ]
    assert apply_type_priority(results, []) is results
