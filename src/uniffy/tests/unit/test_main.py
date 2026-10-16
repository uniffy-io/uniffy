"""Mode selection for ``python -m uniffy``."""

import pytest

from uniffy.main import parse_mode

ARGPARSE_USAGE_ERROR = 2


@pytest.mark.parametrize(
    ("flag", "mode"),
    [
        ("--backend", "backend"),
        ("--worker-core", "worker-core"),
        ("--worker-egress", "worker-egress"),
        ("--worker-media", "worker-media"),
        ("--realtime-checkpoint-now", "realtime-checkpoint-now"),
    ],
)
def test_each_flag_selects_its_process_mode(flag: str, mode: str) -> None:
    assert parse_mode([flag]) == mode


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["--realtime-checkpoint-now", "--worker-core"],
        ["--realtime-checkpoint-now", "--backend"],
        ["--realtime-checkpoint-now", "--namespace", "test:"],
    ],
    ids=["no-mode", "beside-worker", "beside-backend", "unknown-option"],
)
def test_checkpoint_now_runs_alone_and_a_mode_is_required(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as exited:
        parse_mode(argv)

    assert exited.value.code == ARGPARSE_USAGE_ERROR
