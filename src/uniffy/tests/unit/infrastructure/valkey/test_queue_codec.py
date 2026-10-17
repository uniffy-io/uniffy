from uniffy.core.jobs import QueueName
from uniffy.core.jobs.codec import deserialize_job_payload, serialize_job_payload
from uniffy.infrastructure.valkey import queue as queue_module


async def test_queue_pools_read_and_write_jobs_through_the_json_codec(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_create_pool(settings: object, **kwargs: object) -> object:
        del settings
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(queue_module, "create_pool", fake_create_pool)
    previous = queue_module._pools[QueueName.CORE]
    try:
        await queue_module.init_queue(QueueName.CORE)
    finally:
        queue_module._pools[QueueName.CORE] = previous

    assert captured["default_queue_name"] == QueueName.CORE.valkey_name
    assert captured["job_serializer"] is serialize_job_payload
    assert captured["job_deserializer"] is deserialize_job_payload
