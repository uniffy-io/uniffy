import pycrdt

from uniffy.core.realtime.storage import compact_update


def test_compaction_retains_missing_predecessors_and_collects_deleted_text():
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("base")
    baseline_update = doc.get_update()
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(4, " first")
    predecessor = doc.get_update(before)
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(10, " second")
    raw = pycrdt.merge_updates(baseline_update, doc.get_update(before))
    recovered = pycrdt.Doc()
    recovered.apply_update(compact_update(raw))
    recovered.apply_update(predecessor)
    assert str(recovered.get("markdown", type=pycrdt.Text)) == "base first second"
    raw = doc.get_update()
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(0, "z" * 10000)
    raw = pycrdt.merge_updates(raw, doc.get_update(before))
    before = doc.get_state()
    del doc.get("markdown", type=pycrdt.Text)[:10000]
    raw = pycrdt.merge_updates(raw, doc.get_update(before))
    compacted = compact_update(raw)
    assert len(compacted) < len(raw) // 10
    peer = pycrdt.Doc()
    peer.apply_update(compacted)
    assert str(peer.get("markdown", type=pycrdt.Text)) == "base first second"
