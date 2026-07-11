"""Screen-share quality enum shared by the calls proto and org policy.

Per-org call policy lives in the generic ``org_settings`` KV store
(``namespace='calls'``); see ``domains/calls/policy.py``.
"""

from enum import IntEnum


class ScreenShareQuality(IntEnum):
    """Ceiling for the publisher's top screen-share layer.

    Ints match the calls.v1.ScreenShareQuality proto values, so the two cross the
    wire without a lookup table. UNSPECIFIED on a policy means no explicit org cap.
    """

    UNSPECIFIED = 0
    BALANCED = 1
    HIGH = 2
    MAX = 3
