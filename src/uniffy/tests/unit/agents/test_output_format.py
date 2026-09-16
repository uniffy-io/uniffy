from itertools import product
from unittest.mock import MagicMock

import pytest

from uniffy.core.content.references import extract_urns_from_content, sanitize_mention_label
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.agents.runtime.output import prepare_model_markdown
from uniffy.domains.agents.runtime.output_format import OutputSurface, normalize_model_markdown

URN = "urn:uniffy:content:NOTE:019558e0-8700-7000-8000-000000000001"
MENTION = f"[[[Roadmap|{URN}]]]"


@pytest.mark.parametrize(
    ("source", "expected", "kinds"),
    [
        ("```markdown\n# Title\n```", "# Title\n", ["fence_unwrap"]),
        (" \r\n~~~md\r\nBody\r\n~~~~\r\n", "Body\r\n", ["fence_unwrap"]),
        (f"[[Roadmap|{URN}]]", MENTION, ["mention_brackets"]),
        (f"[[[Roadmap|{URN}]]", MENTION, ["mention_brackets"]),
        (f"[[Roadmap|{URN}]]]", MENTION, ["mention_brackets"]),
        (f"[Roadmap]({URN})", MENTION, ["mention_link"]),
        (f"[Draft [A] | Review]({URN})", f"[[[Draft A Review|{URN}]]]", ["mention_link"]),
        (f"See {URN}.", f"See [[[Note|{URN}]]].", ["bare_urn"]),
        (":::warning\nBody\n:::\n", "Body\n", ["directive"]),
        ("[Self]: Reply", "Reply", ["self_prefix"]),
        ("[Self]: [Self]: Reply", "Reply", ["self_prefix"]),
        (
            f"[Self]: ```md\n:::note\n[[Roadmap|{URN}]]\n:::\n```",
            MENTION + "\n",
            ["fence_unwrap", "mention_brackets", "directive", "self_prefix"],
        ),
        (
            ":::note\n````markdown\n[Self]: ```md\nBody\n```\n````\n:::\n",
            "Body\n",
            ["fence_unwrap", "directive", "self_prefix"],
        ),
        (
            f"[[  Road\\map  |{URN}]] [A|B]({URN})",
            f"[[[Road map|{URN}]]] [[[A B|{URN}]]]",
            ["mention_brackets", "mention_link"],
        ),
    ],
)
def test_repairs_are_reported_once_and_idempotent(source, expected, kinds) -> None:
    result, repairs = normalize_model_markdown(source, surface=OutputSurface.CHAT, agent_name="Self")
    assert (result, repairs) == (expected, kinds)
    assert normalize_model_markdown(result, surface=OutputSurface.CHAT, agent_name="Self") == (
        result,
        [],
    )


@pytest.mark.parametrize(
    "source",
    [
        "",
        " \n\t",
        "# Heading\n\nParagraph  \nNext\n",
        MENTION,
        "[[[tag|release]]]",
        "[[[video|some-file]]]",
        f"\\[\\[\\[Roadmap\\|{URN}\\]\\]\\]",
        f"```python\n[[Roadmap|{URN}]]\n:::\n[Self]: example\n```",
        f"```\n{URN}\n```",
        f"````python\n```\n{URN}\n:::note\n````",
        f"~~~sql\n{URN}\n```\n:::note\n~~~",
        f"```python\n{URN}\n:::note",
        f"> ```md\n> {URN}\n> ```",
        f"- ```python\n  {URN}\n  :::note\n  ```\n",
        f"1. ~~~md\n   {URN}\n   ~~~\n",
        f"```python\n- ```\n{URN}\n:::note\n```\n",
        f"```python\n    ```\n{URN}\n:::note\n```\n",
        f"Example:\n```markdown\n{URN}\n```",
        f"`{URN}` and ``[[Roadmap|{URN}]] ` literal``",
        f"Example `\n:::warning\n{URN}\n` done",
        f"[[[Label\ncontinued|{URN}]]]",
        f"[[[Label `code`|{URN}]]]",
        f"![image]({URN})",
        "Example `code`:::note\n",
        "::: not a directive\n",
        "[Someone Else]: Reply",
        "urn:uniffy:content:NOTE:placeholder",
        "urn:uniffy:content:UNKNOWN:019558e0-8700-7000-8000-000000000001",
        URN + "extra",
        URN + ":extra",
        URN + "/extra",
        "urn:uniffy:broadcast:channel",
    ],
)
def test_clean_text_and_code_are_byte_identical(source) -> None:
    assert normalize_model_markdown(source, surface=OutputSurface.CHAT, agent_name="Self") == (
        source,
        [],
    )


@pytest.mark.parametrize("surface", list(OutputSurface))
def test_self_prefix_is_chat_only(surface) -> None:
    result, repairs = normalize_model_markdown(
        "[Agent (A)+]: text", surface=surface, agent_name="Agent (A)+"
    )
    expected = (
        ("text", ["self_prefix"]) if surface == OutputSurface.CHAT else ("[Agent (A)+]: text", [])
    )
    assert (result, repairs) == expected


def test_valid_mentions_never_change_across_content_types_and_labels() -> None:
    labels = ["Roadmap", "日本語", "A B", "A\\B", "Draft [A] | Review", "", "\n\t"]
    for content_type, label, surface in product(ContentType, labels, OutputSurface):
        urn = f"urn:uniffy:content:{content_type.value}:{generate_id()}"
        mention = f"[[[{sanitize_mention_label(label)}|{urn}]]]"
        assert normalize_model_markdown(mention, surface=surface) == (mention, [])


def test_fenced_bytes_survive_repairs_around_them() -> None:
    code = f"````python\r\n{URN}\r\n:::note\r\n```\r\n````\r\n"
    source = f"[[Roadmap|{URN}]]\n{code}[Roadmap]({URN})"
    result, kinds = normalize_model_markdown(source, surface=OutputSurface.NOTE)
    assert result == f"{MENTION}\n{code}{MENTION}"
    assert kinds == ["mention_brackets", "mention_link"]
    assert extract_urns_from_content(result) == [URN]


def test_ordered_list_fence_preserves_code_and_repairs_following_prose() -> None:
    code = f"10. ```python\n    {URN}\n    ```\n\n"
    result, repairs = normalize_model_markdown(code + URN, surface=OutputSurface.NOTE)
    assert result == code + f"[[[Note|{URN}]]]"
    assert repairs == ["bare_urn"]


def test_observations_count_kinds_per_body_and_exclude_body_from_logs(monkeypatch) -> None:
    import uniffy.domains.agents.runtime.output as output

    counter, logger = MagicMock(), MagicMock()
    monkeypatch.setattr(output, "AGENT_OUTPUT_REPAIRS_TOTAL", counter)
    monkeypatch.setattr(output, "logger", logger)
    raw = f"[[Roadmap|{URN}]] [[Roadmap|{URN}]] {URN}"
    repaired = prepare_model_markdown(
        raw, surface=OutputSurface.NOTE, provider="openrouter", model="test-model"
    )
    assert counter.labels.call_count == 2
    assert counter.labels.return_value.inc.call_count == 2
    labels = [call.kwargs for call in counter.labels.call_args_list]
    assert {item["kind"] for item in labels} == {"mention_brackets", "bare_urn"}
    assert all(item["provider"] == "openrouter" and item["surface"] == "note" for item in labels)
    assert logger.warning.call_args.kwargs["model"] == "test-model"
    assert URN not in str(logger.warning.call_args)
    prepare_model_markdown(
        repaired, surface=OutputSurface.NOTE, provider="openrouter", model="test-model"
    )
    assert counter.labels.call_count == 2
    assert logger.warning.call_count == 1


def test_unknown_provider_label_is_bounded(monkeypatch) -> None:
    import uniffy.domains.agents.runtime.output as output

    counter = MagicMock()
    monkeypatch.setattr(output, "AGENT_OUTPUT_REPAIRS_TOTAL", counter)
    prepare_model_markdown(URN, surface=OutputSurface.CHAT, provider="user-controlled", model=None)
    assert counter.labels.call_args.kwargs["provider"] == "unknown"


def test_deep_wrappers_are_processed_without_recursive_calls() -> None:
    markers = ["`" * length for length in range(303, 2, -1)]
    source = "".join(marker + "md\n" for marker in markers)
    source += MENTION + "\n" + "\n".join(reversed(markers))
    assert normalize_model_markdown(source, surface=OutputSurface.NOTE) == (
        MENTION + "\n",
        ["fence_unwrap"],
    )


def test_long_unmatched_delimiters_and_many_repairs_remain_stable() -> None:
    source = "[" * 50_000 + "\n" + (URN + " ") * 1000
    result, repairs = normalize_model_markdown(source, surface=OutputSurface.CHAT)
    assert repairs == ["bare_urn"]
    assert result.count(f"[[[Note|{URN}]]]") == 1000
    assert normalize_model_markdown(result, surface=OutputSurface.CHAT) == (result, [])
