from pathlib import Path

import pytest
import pytest_asyncio

from uniffy.tests.video import make_videos


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def video_samples(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return await make_videos(tmp_path_factory.mktemp("videos"))
