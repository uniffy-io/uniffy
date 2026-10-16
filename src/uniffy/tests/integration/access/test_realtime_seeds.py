"""Shared seeds, fragment seed leases and locked hydration on live PostgreSQL and Valkey."""

from datetime import UTC, datetime, timedelta

import pycrdt
import pytest
from sqlalchemy import delete

from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.live import accept_seed
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.state import WSSession
from uniffy.core.realtime.storage import (
    EditDenied,
    SeedConflict,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import stored, text_of
from uniffy.tests.integration.access.realtime_sockets import Socket
from uniffy.tests.integration.access.realtime_tasks import (
    document,  # noqa: F401 - fixture
    lease,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_replicas_hydrate_one_shared_seed(document):
    async with open_session() as db:
        await lock_document(db, document.key)
        await stage_seed(db, document.key, document.access.org_id)
        second = await load_snapshot(db, document.key)
        assert second is not None
        assert second.generation == document.seed.generation
        assert second.updates == document.seed.updates


async def test_seed_lease_has_one_owner_and_recovers_after_expiry(document):
    assert (await lease(document, "left:1")).owner == "left:1"
    assert (await lease(document, "right:2")).owner == "left:1"
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert (await lease(document, "right:2")).owner == "right:2"


def fragment_proposal(snapshot):
    proposal = decode_snapshot(snapshot)
    proposal["prosemirror"] = pycrdt.XmlFragment([
        pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText("base")])
    ])
    proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:proposal"] = [0]
    return proposal.get_update()


async def propose(document, update: bytes, held, *, token: str | None = None):
    return await accept_seed(
        document.live.buffer,
        document.key,
        document.access.org_id,
        document.access.member_id,
        document.seed.generation,
        update,
        seed_owner=held.owner,
        seed_token=held.token if token is None else token,
        seed_base="base",
        enqueue=document.live.jobs,
    )


async def test_expired_seed_cannot_duplicate_successor_content(document):
    first = await lease(document, "left:1")
    stale = fragment_proposal(document.seed)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    second = await lease(document, "right:2")
    winner = fragment_proposal(document.seed)
    accepted = await propose(document, winner, second)
    with pytest.raises(SeedConflict):
        await propose(document, stale, first)
    replay = await propose(document, winner, second)
    assert replay.revision == accepted.revision
    assert (
        str(decode_snapshot(replay).get("prosemirror", type=pycrdt.XmlFragment))
        == "<paragraph>base</paragraph>"
    )


async def test_seed_checks_source_and_live_updates_cannot_bypass_the_lease(document):
    held = await lease(document, "left:1")
    proposal = fragment_proposal(document.seed)
    with pytest.raises(SeedConflict):
        await document.live.admit_live("u-claim", proposal)
    edit = decode_snapshot(document.seed)
    markdown_text(edit).insert(4, " mobile edit")
    assert (await document.live.admit_live("u-mobile", edit.get_update())).applied
    with pytest.raises(SeedConflict):
        await propose(document, proposal, held)
    assert (await stored(document.key)).updates == document.seed.updates
    assert await document.live.stream_ids() == [b"1-0"]
    assert text_of((await document.live.checkpointed()).updates) == "base mobile edit"


@pytest.mark.parametrize("expired", [True, False])
async def test_seed_checks_lease_expiry_and_identity_before_any_peer_seed(document, expired):
    held = await lease(document, "left:1")
    if expired:
        async with open_session() as db:
            snapshot = await load_snapshot(db, document.key)
            snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
    with pytest.raises(SeedConflict):
        await propose(
            document,
            fragment_proposal(document.seed),
            held,
            token=None if expired else "expired-lease-token",
        )
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


@pytest.mark.parametrize("proposal_kind", ["text_edit", "missing_claim", "missing_predecessor"])
async def test_seed_rejects_text_edits_and_incomplete_initialization(document, proposal_kind):
    held = await lease(document, "left:1")
    proposal = decode_snapshot(document.seed)
    proposal.apply_update(fragment_proposal(document.seed))
    if proposal_kind == "text_edit":
        markdown_text(proposal).insert(4, " bundled typing")
        update = proposal.get_update()
    elif proposal_kind == "missing_claim":
        del proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:proposal"]
        update = proposal.get_update()
    else:
        proposal.get("markdown_mirror", type=pycrdt.Map)["predecessor"] = True
        before = proposal.get_state()
        proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:incomplete"] = [0]
        update = proposal.get_update(before)
    with pytest.raises(SeedConflict):
        await propose(document, update, held)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


async def test_locked_hydration_refuses_deleted_content_without_orphan(document):
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == document.key[1])
        )
        task = await db.get(Task, document.key[1])
        task.is_deleted = True
        await db.commit()
    socket = Socket()
    attaching = WSSession(
        user_id=document.access.member_id,
        organization_id=document.access.org_id,
        token_version=1,
        conn_id=id(socket),
        ws=socket,
    )
    with pytest.raises(EditDenied):
        await YDocManager(buffer=document.live.buffer).acquire(
            document.key, attaching, can_edit=True
        )
    async with open_session() as db:
        assert await load_snapshot(db, document.key) is None
