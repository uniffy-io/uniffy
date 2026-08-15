"""Search query parser edge cases.

Type keywords and ``my:`` are bare prefixes: text after them must survive
into the free-text query. Only ``tag:`` / ``owner:`` / ``type:`` consume a
value. The parser must never swallow search terms, whatever garbage follows
a prefix.
"""

import pytest

from uniffy.domains.search.parser import has_active_filters, parse_search_query


@pytest.mark.parametrize(
    ("query", "type_filters", "text"),
    [
        ("note: --docker", ["note"], "--docker"),
        ("note:--docker", ["note"], "--docker"),
        ("note: docker compose", ["note"], "docker compose"),
        ("notes: meeting", ["note"], "meeting"),
        ("file: report.pdf", ["file"], "report.pdf"),
        ("folder: invoices", ["folder"], "invoices"),
        ("agentfolder: research", ["agent_folder"], "research"),
        ("agent-folders: research", ["agent_folder"], "research"),
        ("message: deploy failed", ["chat_message"], "deploy failed"),
        ("msg: deploy", ["chat_message"], "deploy"),
        ("agent-chats: onboarding", ["agent_chat"], "onboarding"),
        ("agentchat: onboarding", ["agent_chat"], "onboarding"),
        ("task: fix login", ["task"], "fix login"),
        ("project: alpha", ["project"], "alpha"),
        ("note: !@#$%^&*()", ["note"], "!@#$%^&*()"),
        ("note::", ["note"], ":"),
        ("NOTE: Docker", ["note"], "Docker"),
        ("note: file: shared plan", ["note", "file"], "shared plan"),
    ],
)
def test_type_keywords_keep_following_text(query: str, type_filters: list[str], text: str) -> None:
    parsed = parse_search_query(query)
    assert parsed.type_filters == type_filters
    assert parsed.text == text


def test_type_keyword_deduplicates() -> None:
    parsed = parse_search_query("note: notes: docker")
    assert parsed.type_filters == ["note"]
    assert parsed.text == "docker"


@pytest.mark.parametrize(
    ("query", "text"),
    [
        ("my: drafts", "drafts"),
        ("my:", ""),
        ("my: note: plan", "plan"),
    ],
)
def test_my_is_bare_prefix(query: str, text: str) -> None:
    parsed = parse_search_query(query)
    assert parsed.my_content_only is True
    assert parsed.text == text


def test_tag_consumes_value() -> None:
    parsed = parse_search_query("tag:work note: meeting")
    assert parsed.tags == ["work"]
    assert parsed.type_filters == ["note"]
    assert parsed.text == "meeting"


def test_tag_quoted_value() -> None:
    parsed = parse_search_query('tag:"project alpha" report')
    assert parsed.tags == ["project alpha"]
    assert parsed.text == "report"
    assert parsed.exact_phrases == []


def test_dangling_tag_is_stripped_without_filter() -> None:
    parsed = parse_search_query("docker tag:")
    assert parsed.tags == []
    assert parsed.text == "docker"


def test_owner_consumes_value() -> None:
    parsed = parse_search_query("owner:jane report")
    assert parsed.owner == "jane"
    assert parsed.text == "report"


def test_type_meta_keyword() -> None:
    parsed = parse_search_query("type:note docker")
    assert parsed.type_filters == ["note"]
    assert parsed.text == "docker"


def test_type_meta_unknown_value_is_dropped() -> None:
    parsed = parse_search_query("type:bogus docker")
    assert parsed.type_filters == []
    assert parsed.text == "docker"


def test_quoted_phrase_after_type_keyword() -> None:
    parsed = parse_search_query('note: "kubernetes deploy"')
    assert parsed.type_filters == ["note"]
    assert parsed.text == '"kubernetes deploy"'
    assert parsed.exact_phrases == ["kubernetes deploy"]


def test_keywords_inside_quoted_phrase_stay_literal() -> None:
    parsed = parse_search_query('"note: literal my: text"')
    assert parsed.type_filters == []
    assert parsed.my_content_only is False
    assert parsed.text == '"note: literal my: text"'
    assert parsed.exact_phrases == ["note: literal my: text"]


def test_plain_text_passthrough() -> None:
    parsed = parse_search_query("docker compose setup")
    assert parsed.text == "docker compose setup"
    assert parsed.type_filters == []
    assert has_active_filters(parsed) is False


def test_word_containing_keyword_is_not_a_filter() -> None:
    parsed = parse_search_query("keynote: agenda")
    assert parsed.type_filters == []
    assert parsed.text == "keynote: agenda"


def test_empty_query() -> None:
    parsed = parse_search_query("   ")
    assert parsed.text == ""
    assert has_active_filters(parsed) is False


def test_combined_filters() -> None:
    parsed = parse_search_query('note: tag:prod my: "exact term" docker')
    assert parsed.type_filters == ["note"]
    assert parsed.tags == ["prod"]
    assert parsed.my_content_only is True
    assert parsed.text == '"exact term" docker'
    assert parsed.exact_phrases == ["exact term"]
    assert has_active_filters(parsed) is True
