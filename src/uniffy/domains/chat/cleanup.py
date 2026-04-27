"""App-level cleanup for chat rows that lost their FK enforcement in M1-M3.

Migrations 045-047 dropped the hard FKs on `chat_channel_members.user_id`,
`chat_thread_participants.user_id`, `chat_thread_follows.user_id`, and
`chat_messages.sender_id`. That was the price of making the chat tables
polymorphic (USER | AGENT).

CASCADE on user deletion was the old referential-integrity guarantee.
We replace it with this helper, which any user-deletion code path MUST
call to keep chat membership state coherent with the users table.

Not wired into a deletion path today -- the product has no user-delete
feature yet. Keeping the helper ready means when that flow lands we don't
leak orphaned membership rows behind it.

Chat message rows are intentionally NOT purged: a deleted user's past
messages stay visible (with "Unknown" sender via `SenderResolver`'s
fallback), matching how Slack / Discord handle account deletion.
"""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.thread import ChatThreadParticipant
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType


async def cleanup_chat_membership_for_deleted_user(session: AsyncSession, user_id: UUID) -> None:
    """Remove all chat membership rows for a deleted user.

    Targets the polymorphic subject columns `(subject_type=USER, subject_id)`
    -- the authoritative shape after M1/M2. Commits are caller-controlled so
    this can be folded into the enclosing user-deletion transaction.
    """
    await session.execute(
        delete(ChatChannelMember).where(
            ChatChannelMember.subject_type == SubjectType.USER,
            ChatChannelMember.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadParticipant).where(
            ChatThreadParticipant.subject_type == SubjectType.USER,
            ChatThreadParticipant.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadFollow).where(
            ChatThreadFollow.subject_type == SubjectType.USER,
            ChatThreadFollow.subject_id == user_id,
        )
    )
