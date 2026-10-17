from uuid import UUID

from uniffy.core.realtime.rename import RENAME_BATCH_DOCUMENTS, rename_batches
from uniffy.core.types import ContentType


def test_rename_batches_are_bounded_and_follow_lock_order() -> None:
    keys = [(ContentType.TASK, UUID(int=index)) for index in range(RENAME_BATCH_DOCUMENTS + 1)] + [
        (ContentType.NOTE, UUID(int=1)),
        (ContentType.NOTE, UUID(int=1)),
    ]

    batches = rename_batches(reversed(keys))

    assert [len(batch) for batch in batches] == [RENAME_BATCH_DOCUMENTS, 2]
    flattened = [key for batch in batches for key in batch]
    assert flattened[0] == (ContentType.NOTE, UUID(int=1))
    assert flattened[1:] == [
        (ContentType.TASK, UUID(int=index)) for index in range(RENAME_BATCH_DOCUMENTS + 1)
    ]


def test_rename_batches_of_nothing_lock_nothing() -> None:
    assert rename_batches([]) == []
