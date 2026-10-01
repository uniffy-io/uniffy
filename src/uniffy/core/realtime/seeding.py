import pycrdt

from uniffy.core.realtime.markdown import PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.state import ClientHandle, YDocSession

_PARAGRAPH_TAG = "paragraph"


def _has_fragment_content(root: pycrdt.XmlFragment | pycrdt.XmlElement) -> bool:
    # ySyncPlugin can publish an empty paragraph before the assigned client seeds.
    for child in root.children:
        if isinstance(child, pycrdt.XmlText):
            if str(child):
                return True
        elif child.tag != _PARAGRAPH_TAG or _has_fragment_content(child):
            return True
    return False


def fragment_seeder_changes(session: YDocSession) -> list[tuple[ClientHandle, bool]]:
    fragment = session.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)
    previous = (
        session.clients.get(session.seeder_conn_id) if session.seeder_conn_id is not None else None
    )
    selected: ClientHandle | None = None
    if not _has_fragment_content(fragment):
        if previous is not None and previous.can_edit and not previous.closed:
            selected = previous
        else:
            selected = next(
                (
                    handle
                    for handle in session.clients.values()
                    if handle.can_edit and not handle.closed
                ),
                None,
            )
    conn_id = selected.conn_id if selected is not None else None
    if session.seeder_conn_id == conn_id:
        return []
    session.seeder_conn_id = conn_id
    changes: list[tuple[ClientHandle, bool]] = []
    if previous is not None:
        changes.append((previous, False))
    if selected is not None:
        changes.append((selected, True))
    return changes
