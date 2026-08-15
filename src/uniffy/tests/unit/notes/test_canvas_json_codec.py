from uniffy.core.content.references import extract_all_outgoing_references_from_canvas
from uniffy.domains.notes.handlers import _parse_canvas_content
from uniffy.domains.notes.queries import extract_inline_tags_from_canvas


def test_canvas_string_parsers_share_the_json_codec() -> None:
    payload = (
        '{"nodes":[{"data":{"type":"text","content":"'
        "[[[tag|launch]]] "
        "[[[Note|urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000]]]"
        '"}}]}'
    )

    assert _parse_canvas_content(payload) == {
        "nodes": [
            {
                "data": {
                    "type": "text",
                    "content": "[[[tag|launch]]] "
                    "[[[Note|urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000]]]",
                }
            }
        ]
    }
    assert extract_inline_tags_from_canvas(payload) == ["launch"]
    assert extract_all_outgoing_references_from_canvas(payload) == [
        "urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000"
    ]


def test_invalid_canvas_strings_keep_existing_fallbacks() -> None:
    assert _parse_canvas_content("{not json") is None
    assert extract_inline_tags_from_canvas("{not json") == []
    assert extract_all_outgoing_references_from_canvas("{not json") == []
