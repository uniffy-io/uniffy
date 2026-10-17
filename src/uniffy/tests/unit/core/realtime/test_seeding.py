from datetime import UTC, datetime, timedelta

import pycrdt

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.markdown import MARKDOWN_MIRROR_FIELD, PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.seeding import adds_seed_claim, has_fragment_content
from uniffy.core.realtime.storage import elect_seed_owner
from uniffy.core.types import ContentType, generate_id


def row(owner: str | None = None, expires_in: timedelta | None = None) -> RealtimeYjsSnapshot:
    return RealtimeYjsSnapshot(
        content_type=ContentType.NOTE,
        content_id=generate_id(),
        updates=b"",
        state_vector=b"",
        seed_owner=owner,
        seed_expires_at=None if expires_in is None else datetime.now(UTC) + expires_in,
    )


def fragment(*paragraphs: str) -> pycrdt.XmlFragment:
    doc = pycrdt.Doc()
    doc[PROSEMIRROR_FRAGMENT_FIELD] = pycrdt.XmlFragment([
        pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText(text)] if text else [])
        for text in paragraphs
    ])
    return doc.get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)


def test_empty_placeholder_paragraphs_do_not_count_as_fragment_content() -> None:
    assert not has_fragment_content(fragment())
    assert not has_fragment_content(fragment("", ""))
    assert has_fragment_content(fragment("", "seeded"))


def test_live_lease_stays_with_its_owner_while_candidates_poll() -> None:
    snapshot = row("left:1", timedelta(seconds=30))
    lease = elect_seed_owner(snapshot, initialized=False, candidates=["right:2"], replica="right")
    assert lease is not None and lease.owner == "left:1"


def test_expired_lease_moves_to_another_candidate() -> None:
    snapshot = row("left:1", timedelta(seconds=-1))
    lease = elect_seed_owner(
        snapshot, initialized=False, candidates=["left:1", "left:2"], replica="left"
    )
    assert lease is not None and lease.owner == "left:2"
    assert lease.expires_at > datetime.now(UTC)


def test_owner_that_stopped_offering_loses_the_lease_on_its_own_replica() -> None:
    snapshot = row("left:1", timedelta(seconds=30))
    lease = elect_seed_owner(snapshot, initialized=False, candidates=["left:3"], replica="left")
    assert lease is not None and lease.owner == "left:3"


def test_initialized_fragment_needs_no_seeder() -> None:
    snapshot = row("left:1", timedelta(seconds=30))
    assert (
        elect_seed_owner(snapshot, initialized=True, candidates=["left:1"], replica="left") is None
    )
    assert snapshot.seed_owner is None


def test_only_a_new_seed_claim_counts_as_claiming() -> None:
    before = pycrdt.Doc()
    before.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)["seeded_by:earlier"] = [0]
    replay = pycrdt.Doc()
    replay.apply_update(before.get_update())
    claimed = pycrdt.Doc()
    claimed.apply_update(before.get_update())
    claimed.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)["seeded_by:client"] = [0]

    assert not adds_seed_claim(before, replay)
    assert adds_seed_claim(before, claimed)
