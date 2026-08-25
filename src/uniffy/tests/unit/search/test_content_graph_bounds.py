from uuid import UUID

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.search.content_graph import GraphEdgeCollector


def _urn(content_type: ContentType, content_id: UUID) -> str:
    return f"urn:uniffy:content:{content_type.value}:{content_id}"


def test_graph_edges_deduplicate_and_drop_self_references() -> None:
    source_id = generate_id()
    source = _urn(ContentType.NOTE, source_id)
    target = _urn(ContentType.TASK, generate_id())
    collector = GraphEdgeCollector()

    assert collector.add_rows(
        [(source_id, [target, target, source, "", 42])],
        ContentType.NOTE,
    )
    assert collector.edges == [(source, target)]
    assert collector.truncated is False


def test_graph_rows_use_lookahead_to_report_real_truncation() -> None:
    first_id = generate_id()
    second_id = generate_id()
    first_target = _urn(ContentType.FILE, generate_id())
    second_target = _urn(ContentType.FILE, generate_id())
    collector = GraphEdgeCollector(max_rows=1)

    collector.add_rows(
        [(first_id, [first_target]), (second_id, [second_target])],
        ContentType.NOTE,
    )

    assert collector.edges == [(_urn(ContentType.NOTE, first_id), first_target)]
    assert collector.truncated is True


def test_graph_edges_enforce_per_source_and_global_caps() -> None:
    first_id = generate_id()
    second_id = generate_id()
    targets = [_urn(ContentType.FILE, generate_id()) for _ in range(4)]
    collector = GraphEdgeCollector(max_references_per_source=2, max_edges=3)

    has_capacity = collector.add_rows(
        [
            (first_id, targets[:3]),
            (second_id, targets[2:]),
        ],
        ContentType.TASK,
    )

    assert has_capacity is False
    assert collector.edges == [
        (_urn(ContentType.TASK, first_id), targets[0]),
        (_urn(ContentType.TASK, first_id), targets[1]),
        (_urn(ContentType.TASK, second_id), targets[2]),
    ]
    assert collector.truncated is True


def test_graph_edge_limit_is_not_truncated_without_an_overflow_edge() -> None:
    source_id = generate_id()
    target = _urn(ContentType.FILE, generate_id())
    collector = GraphEdgeCollector(max_edges=1)

    assert collector.add_rows([(source_id, [target])], ContentType.NOTE) is True
    assert collector.truncated is False
