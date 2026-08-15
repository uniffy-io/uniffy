from uniffy.core.valkey.queue import QueueName


def test_queue_names_define_physical_valkey_queues() -> None:
    physical_names = [name.valkey_name for name in QueueName]

    assert all(name.valkey_name == f"uniffy:queue:{name.value}" for name in QueueName)
    assert len(physical_names) == len(set(physical_names))
