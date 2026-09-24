import pytest
from uniffy_proto.agents.v1 import sessions_pb, skills_pb
from uniffy_proto.chat.v1 import chat_pb


def test_sessions_expose_no_rating_rpc_or_payloads():
    service = next(item for item in sessions_pb.desc().services if item.name == "SessionsService")
    assert "SubmitMessageFeedback" not in {method.name for method in service.methods}
    assert not {
        "SubmitMessageFeedbackRequest",
        "SubmitMessageFeedbackResponse",
        "MessageFeedback",
    }.intersection(message.name for message in sessions_pb.desc().messages)


@pytest.mark.parametrize(
    ("message", "removed"),
    [
        (sessions_pb.MessageInfo, {20: "feedback_rating"}),
        (chat_pb.ChatMessage, {13: "feedback_rating"}),
        (
            skills_pb.SkillMetric,
            {
                15: "rated_response_count",
                16: "positive_feedback_count",
                17: "negative_feedback_count",
                18: "rating_count",
                19: "positive_feedback_rate",
                20: "negative_feedback_rate",
            },
        ),
    ],
)
def test_removed_rating_fields_are_reserved(message, removed):
    descriptor = message.desc().proto
    for number, name in removed.items():
        assert name not in {field.name for field in message.desc().fields}
        assert number not in {field.number for field in message.desc().fields}
        assert name in descriptor.reserved_name
        assert any(span.start <= number < span.end for span in descriptor.reserved_range)
