from datetime import datetime

from loguru import logger

from uniffy.core.json_codec import loads
from uniffy.observability.logger import serialize


def test_json_log_serializer_handles_loguru_record_types() -> None:
    messages = []
    handler_id = logger.add(messages.append)
    try:
        logger.bind(user_id="user-1", label="København").info("serialized")
    finally:
        logger.remove(handler_id)

    payload = loads(serialize(messages[0].record))

    assert payload["msg"] == "serialized"
    assert payload["user_id"] == "user-1"
    assert payload["label"] == "København"
    assert datetime.fromisoformat(payload["time"]).tzinfo is not None
    assert payload["time"][10] == " "
