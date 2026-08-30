"""WebM-to-MP4 transcode orchestration behavior."""

from typing import Any

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.files.jobs import transcode as transcode_mod
from uniffy.domains.files.jobs.contracts import (
    GENERATE_VIDEO_THUMBNAIL,
    TRANSCODE_VIDEO_TO_MP4,
)
from uniffy.domains.files.jobs.mime import get_jobs_for_mime_type


class _FakeOpsClient:
    """Stand-in for the Valkey ops client. Records SET/DEL calls."""

    def __init__(self, owner_can_acquire: bool = True) -> None:
        self.owner_can_acquire = owner_can_acquire
        self.calls: list[tuple[str, ...]] = []
        self._held: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int = 0, nx: bool = False):
        self.calls.append(("set", key))
        if nx and key in self._held:
            return None
        if not self.owner_can_acquire:
            return None
        self._held[key] = value
        return True

    async def eval(self, _script: str, _numkeys: int, key: str, token: str):
        self.calls.append(("eval", key))
        if self._held.get(key) != token:
            return 0
        self._held.pop(key)
        return 1


@pytest.fixture
def lock_acquired(monkeypatch):
    """Patch the Valkey ops client so the worker can acquire its lock."""
    fake = _FakeOpsClient(owner_can_acquire=True)
    monkeypatch.setattr(transcode_mod, "_get_ops_client", lambda: fake)
    return fake


@pytest.fixture
def lock_held(monkeypatch):
    """Patch the Valkey ops client so SET NX always returns False."""
    fake = _FakeOpsClient(owner_can_acquire=False)
    monkeypatch.setattr(transcode_mod, "_get_ops_client", lambda: fake)
    return fake


async def test_invalid_uuid_args_short_circuit() -> None:
    """Bad uuid arguments should never touch Valkey, S3, or PG."""
    result = await transcode_mod.transcode_video_to_mp4(
        ctx={},
        file_id="not-a-uuid",
        organization_id=str(generate_id()),
    )
    assert result == {"status": "error", "error": "invalid_uuid"}


async def test_lock_held_returns_skipped(lock_held) -> None:
    """Concurrent invocation while another worker holds the lock is a
    no-op so two workers cannot race to write duplicate FileVersion rows.
    """
    file_id = str(generate_id())
    org_id = str(generate_id())

    async def _run() -> dict[str, Any]:
        return await transcode_mod.transcode_video_to_mp4(
            ctx={},
            file_id=file_id,
            organization_id=org_id,
        )

    result = await _run()
    assert result == {
        "status": "skipped",
        "reason": "lock_held",
        "file_id": file_id,
    }


async def test_missing_ops_client_skips_before_loading_file_state(monkeypatch) -> None:
    monkeypatch.setattr(transcode_mod, "_get_ops_client", lambda: None)

    file_id = str(generate_id())
    result = await transcode_mod.transcode_video_to_mp4(
        ctx={},
        file_id=file_id,
        organization_id=str(generate_id()),
    )

    assert result == {
        "status": "skipped",
        "reason": "lock_held",
        "file_id": file_id,
    }


async def test_release_lock_called_on_invalid_uuid(monkeypatch) -> None:
    """Even when the body short-circuits, the lock must be released so
    a retried submit does not have to wait out the TTL.

    invalid_uuid path returns before SET NX runs, so DEL must NOT be
    issued either - we never acquired the lock. Mirrors agent_compaction.
    """
    fake = _FakeOpsClient()
    monkeypatch.setattr(transcode_mod, "_get_ops_client", lambda: fake)
    await transcode_mod.transcode_video_to_mp4(
        ctx={},
        file_id="not-a-uuid",
        organization_id=str(generate_id()),
    )
    assert fake.calls == []


def test_ffmpeg_codec_args_default(monkeypatch) -> None:
    """Default encoder is libx264 when no hardware override is set."""
    monkeypatch.setattr(transcode_mod, "_HW_ENCODER", "")
    args = transcode_mod._ffmpeg_video_codec_args()
    assert args[:2] == ["-c:v", "libx264"]
    assert "veryfast" in args


def test_ffmpeg_codec_args_hw_encoder(monkeypatch) -> None:
    """Hardware encoder is used when env declares a recognised value."""
    monkeypatch.setattr(transcode_mod, "_HW_ENCODER", "h264_nvenc")
    args = transcode_mod._ffmpeg_video_codec_args()
    assert args[:2] == ["-c:v", "h264_nvenc"]


def test_ffmpeg_codec_args_unknown_hw_encoder_falls_back(monkeypatch) -> None:
    """Unrecognised TRANSCODE_HW_ENCODER values fall back to libx264 so
    a misconfigured env does not crash the worker on every job.
    """
    monkeypatch.setattr(transcode_mod, "_HW_ENCODER", "h264_made_up")
    args = transcode_mod._ffmpeg_video_codec_args()
    assert args[:2] == ["-c:v", "libx264"]


async def test_run_ffmpeg_raises_on_nonzero_exit(monkeypatch, tmp_path) -> None:
    """A non-zero ffmpeg exit must bubble up as RuntimeError so the
    worker can flip ``transcode_status=FAILED`` and leave the WebM live.
    """

    class _FakeProc:
        returncode = 1

        async def communicate(self):
            return b"", b"boom"

    async def _fake_exec(*args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(transcode_mod.asyncio, "create_subprocess_exec", _fake_exec)

    with pytest.raises(RuntimeError, match="ffmpeg failed"):
        await transcode_mod._run_ffmpeg(tmp_path / "in.webm", tmp_path / "out.mp4")


def test_get_jobs_for_webm_includes_transcode() -> None:
    """The MIME registry should fan out both thumbnail and transcode for
    `video/webm`. Thumbnail and transcode run in parallel.
    """
    jobs = get_jobs_for_mime_type("video/webm")
    assert GENERATE_VIDEO_THUMBNAIL in jobs
    assert TRANSCODE_VIDEO_TO_MP4 in jobs


def test_get_jobs_for_mp4_excludes_transcode() -> None:
    """Already-MP4 uploads must not trigger a transcode."""
    jobs = get_jobs_for_mime_type("video/mp4")
    assert TRANSCODE_VIDEO_TO_MP4 not in jobs


def test_initial_transcode_status_only_when_filename_is_mp4() -> None:
    """`complete_upload` decides whether to flag a webm upload as
    needing a transcode based on whether the filename is `.mp4` (the
    recording feature contract). Drag-and-drop webm uploads keep their
    `.webm` extension and stay at NOT_NEEDED.
    """
    from uniffy.core.models.files.file import TranscodeStatus
    from uniffy.domains.files.operations import FileOperations

    ops = FileOperations.__new__(FileOperations)

    pending = ops._get_initial_transcode_status("video/webm", "Screen Recording 2026-05-09.mp4")
    assert pending == TranscodeStatus.PENDING

    skipped_extension = ops._get_initial_transcode_status("video/webm", "lecture.webm")
    assert skipped_extension == TranscodeStatus.NOT_NEEDED

    skipped_mime = ops._get_initial_transcode_status("video/mp4", "Screen Recording 2026-05-09.mp4")
    assert skipped_mime == TranscodeStatus.NOT_NEEDED


def test_transcode_status_proto_mapping_is_total() -> None:
    """Every TranscodeStatus enum member must have a proto mapping so
    `file_to_proto` never silently downgrades to NOT_NEEDED on a real
    PROCESSING/FAILED row.
    """
    from uniffy.core.models.files.file import TranscodeStatus
    from uniffy.domains.files.converters import TRANSCODE_STATUS_TO_PROTO

    for member in TranscodeStatus:
        assert member in TRANSCODE_STATUS_TO_PROTO


@pytest.mark.parametrize(
    "status",
    ["NOT_NEEDED", "COMPLETED"],
)
async def test_worker_skips_terminal_states(monkeypatch, lock_acquired, status) -> None:
    """A re-enqueued job that lands on a row in a terminal state must
    no-op so a retry storm cannot resurface a completed file.

    We can only assert this without a live DB by patching `open_session`
    to yield an in-memory File-like object.
    """
    from uniffy.core.models.files.file import TranscodeStatus

    class _Sess:
        def __init__(self, file):
            self._file = file

        async def get(self, _model, _id):
            return self._file

        async def commit(self):
            return None

        async def execute(self, *args, **kwargs):
            class _R:
                def scalar_one_or_none(self_inner):
                    return None

            return _R()

    class _CtxMgr:
        def __init__(self, file):
            self._file = file

        async def __aenter__(self):
            return _Sess(self._file)

        async def __aexit__(self, *_):
            return False

    class _File:
        def __init__(self, status_value, org_id):
            self.id = generate_id()
            self.organization_id = org_id
            self.transcode_status = TranscodeStatus(status_value)
            self.storage_key = "old/key.webm"
            self.storage_bucket = "bucket"
            self.owner_id = generate_id()
            self.filename = "Screen Recording.mp4"
            self.version = 1

    org_id = generate_id()
    file = _File(status, org_id)

    monkeypatch.setattr(transcode_mod, "open_session", lambda: _CtxMgr(file))

    result = await transcode_mod.transcode_video_to_mp4(
        ctx={},
        file_id=str(file.id),
        organization_id=str(org_id),
    )
    assert result["status"] == "skipped"
    if status == "COMPLETED":
        assert result["reason"] == "already_completed"
    else:
        assert result["reason"] == "not_needed"
