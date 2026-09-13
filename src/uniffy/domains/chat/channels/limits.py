"""Chat channel pagination and direct-message limits."""

DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500
GROUP_DM_MAX_PARTICIPANTS = 9

# Create and add reject with identical copy so the ceiling reads the same wherever a user hits it.
GROUP_DM_CAP_MESSAGE = (
    f"Group chats are limited to {GROUP_DM_MAX_PARTICIPANTS} people. "
    "Convert this conversation to a channel to add more."
)
