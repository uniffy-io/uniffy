from uniffy.core.types import ContentType
from uniffy.domains.permissions.access.standard import DIRECT_CONTENT_TYPES

CALENDAR_CONTENT_TYPES = frozenset({ContentType.CALENDAR_EVENT})
PROJECT_CONTENT_TYPES = frozenset({ContentType.TASK})
CHAT_CONTENT_TYPES = frozenset({
    ContentType.CHAT,
    ContentType.AGENT_CHAT,
    ContentType.CHAT_MESSAGE,
})
CHAT_FOLDER_CONTENT_TYPES = frozenset({ContentType.AGENT_FOLDER})
DIRECTORY_CONTENT_TYPES = frozenset({
    ContentType.USER,
    ContentType.TEAM,
})
TAG_CONTENT_TYPES = frozenset({ContentType.TAG})
AUTOMATION_CONTENT_TYPES = frozenset({ContentType.AGENT_CRON_TASK})

SEARCHABLE_CONTENT_TYPES = frozenset().union(
    DIRECT_CONTENT_TYPES,
    CALENDAR_CONTENT_TYPES,
    PROJECT_CONTENT_TYPES,
    CHAT_CONTENT_TYPES,
    CHAT_FOLDER_CONTENT_TYPES,
    DIRECTORY_CONTENT_TYPES,
    TAG_CONTENT_TYPES,
    AUTOMATION_CONTENT_TYPES,
)

NON_SEARCHABLE_CONTENT_TYPES = frozenset({ContentType.PROVIDER_KEY})

if SEARCHABLE_CONTENT_TYPES & NON_SEARCHABLE_CONTENT_TYPES:
    raise RuntimeError("Resource access registry contains conflicting content types")
