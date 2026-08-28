"""Stable files RPC handler façade."""

from uniffy.domains.files.rpc.bulk import BulkHandlers
from uniffy.domains.files.rpc.folders import FolderHandlers
from uniffy.domains.files.rpc.items import FileItemHandlers
from uniffy.domains.files.rpc.trash import TrashHandlers
from uniffy.domains.files.rpc.tree import TreeHandlers
from uniffy.domains.files.rpc.uploads import UploadHandlers
from uniffy.domains.files.rpc.versions import VersionHandlers


class FilesHandlers(
    UploadHandlers,
    FileItemHandlers,
    FolderHandlers,
    TrashHandlers,
    TreeHandlers,
    VersionHandlers,
    BulkHandlers,
):
    pass
