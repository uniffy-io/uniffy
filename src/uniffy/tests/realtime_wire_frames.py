"""The realtime wire frames the backend, web and mobile codecs are all held to."""

from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any

from uniffy.core.json_codec import loads
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_ACK,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_GENERATION,
    MESSAGE_SESSION_STATE,
    create_accepted_receipt_message,
    create_ack_message,
    create_checkpoint_progress_message,
    create_generation_message,
    create_session_state_message,
    parse_accepted_receipt_message,
    parse_ack_message,
    parse_checkpoint_progress_message,
    parse_generation_message,
    parse_session_state_message,
)

CORPUS_FILE = (
    Path(__file__).resolve().parents[2]
    / "proto"
    / "tests"
    / "fixtures"
    / "realtime_wire_frames.json"
)

CORPUS: dict[str, Any] = loads(CORPUS_FILE.read_bytes())
VALID_CASES: list[dict[str, Any]] = [
    case
    for case in CORPUS["cases"]
    if "error" not in case  # noqa: PLR2004 - corpus key
]
MALFORMED_CASES: list[dict[str, Any]] = [
    case
    for case in CORPUS["cases"]
    if "error" in case  # noqa: PLR2004 - corpus key
]
# Out-of-contract values a naive encoder would still serialize; the corpus keeps their bytes.
UNENCODABLE_CASES: list[dict[str, Any]] = [
    case
    for case in MALFORMED_CASES
    if "fields" in case  # noqa: PLR2004 - corpus key
]
# Document denials whose exact reason both clients act on, keyed by case name.
DENIALS: dict[str, dict[str, Any]] = {case["name"]: case for case in CORPUS["denials"]}
SEQUENCE_FRAMES: list[dict[str, Any]] = [
    {"name": f"{sequence['name']}[{index}]", **step["frame"]}
    for sequence in CORPUS["sequences"]
    for index, step in enumerate(sequence["steps"])
    if "frame" in step  # noqa: PLR2004 - corpus key
]

_CODECS: dict[int, tuple[Callable[..., bytes], Callable[[bytes], dict[str, Any]]]] = {
    MESSAGE_GENERATION: (
        create_generation_message,
        lambda frame: {"generation": parse_generation_message(frame)},
    ),
    MESSAGE_ACK: (create_ack_message, lambda frame: {"update_id": parse_ack_message(frame)}),
    MESSAGE_ACCEPTED_RECEIPT: (
        create_accepted_receipt_message,
        lambda frame: asdict(parse_accepted_receipt_message(frame)),
    ),
    MESSAGE_CHECKPOINT_PROGRESS: (
        create_checkpoint_progress_message,
        lambda frame: asdict(parse_checkpoint_progress_message(frame)),
    ),
    MESSAGE_SESSION_STATE: (
        create_session_state_message,
        lambda frame: asdict(parse_session_state_message(frame)),
    ),
}


def frame_bytes(case: dict[str, Any]) -> bytes:
    return bytes.fromhex(case["hex"])


def encode(case: dict[str, Any]) -> bytes:
    create, _ = _CODECS[case["type"]]
    return create(**case["fields"])


def decode(case: dict[str, Any]) -> dict[str, Any]:
    _, parse = _CODECS[case["type"]]
    return parse(frame_bytes(case))


def case_id(case: dict[str, Any]) -> str:
    return case["name"]
