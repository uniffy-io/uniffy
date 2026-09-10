import pytest
from google.protobuf.descriptor_pb2 import DescriptorProto
from uniffy_proto.agents.v1 import sessions_pb2, skills_pb2
from uniffy_proto.chat.v1 import chat_pb2


def test_sessions_expose_no_rating_rpc_or_payloads():
    service = sessions_pb2.DESCRIPTOR.services_by_name["SessionsService"]
    assert "SubmitMessageFeedback" not in service.methods_by_name
    assert not {
        "SubmitMessageFeedbackRequest",
        "SubmitMessageFeedbackResponse",
        "MessageFeedback",
    }.intersection(sessions_pb2.DESCRIPTOR.message_types_by_name)


@pytest.mark.parametrize(
    ("message", "removed"),
    [
        (sessions_pb2.MessageInfo, {20: "feedback_rating"}),
        (chat_pb2.ChatMessage, {13: "feedback_rating"}),
        (
            skills_pb2.SkillMetric,
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
    descriptor = DescriptorProto()
    message.DESCRIPTOR.CopyToProto(descriptor)
    for number, name in removed.items():
        assert name not in message.DESCRIPTOR.fields_by_name
        assert number not in message.DESCRIPTOR.fields_by_number
        assert name in descriptor.reserved_name
        assert any(span.start <= number < span.end for span in descriptor.reserved_range)
