"""
Stress test seed for chat - generates a busy channel with thousands of messages.

Usage:
    uv run python -m uniffy.scripts.stress.chat_stress [OPTIONS]

Options:
    --messages      Number of messages to generate (default: 5000)
    --channel-name  Name of the stress test channel (default: "stress-test")
    --threads       Percentage of messages that start threads (default: 5)
    --replies       Max replies per thread (default: 10)
    --dry-run       Print stats without writing to database
"""

import argparse
import asyncio
import os
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger


@dataclass
class ChatStressConfig:
    """Configuration for chat stress test data generation."""

    message_count: int = 5000
    channel_name: str = "stress-test"
    thread_pct: int = 5
    max_replies: int = 10
    dry_run: bool = False


# Realistic chat messages - short and conversational
CHAT_MESSAGES = [
    "Hey, has anyone looked at the latest build?",
    "I just pushed a fix for that bug we discussed",
    "Can someone review my PR? It's been sitting for a while",
    "The deployment went smoothly this morning",
    "Are we still on for the standup at 10?",
    "I'll be a few minutes late to the meeting",
    "Thanks for the quick turnaround on that!",
    "Has anyone else seen this error in staging?",
    "I think we should revisit the architecture for this component",
    "Good morning everyone!",
    "Let me know if you need any help with that",
    "I just updated the documentation",
    "The tests are passing now",
    "Can we schedule a quick sync about the API changes?",
    "I'll take a look at that after lunch",
    "Great work on the release!",
    "Does anyone have experience with this library?",
    "I found a workaround for the issue",
    "The client meeting went well",
    "We need to prioritize the security fixes",
    "I'll send out the notes from today's meeting",
    "Who's available for a code review?",
    "The performance numbers look much better now",
    "I'm going to refactor this module",
    "The new feature is ready for QA",
    "Heads up - I'm going to restart the dev server",
    "Can we get more eyes on this design proposal?",
    "I think there's a race condition in the auth flow",
    "The customer reported the same issue again",
    "I'll be OOO tomorrow",
    "Just merged the feature branch",
    "The CI pipeline is green again",
    "Anyone up for a coffee break?",
    "I need to pair on this - it's tricky",
    "The migration script worked perfectly",
    "We should add more test coverage here",
    "I'm blocked on the API response format",
    "Can we bump the priority on this ticket?",
    "The monitoring dashboard looks good",
    "I'll handle the rollback if needed",
]

CHAT_LONG_MESSAGES = [
    (
        "I've been thinking about our approach to caching and I think we"
        " should consider using a write-through strategy instead of"
        " write-behind. The current implementation has some edge cases"
        " where stale data can persist for too long."
    ),
    (
        "Just finished reviewing the design doc. Overall it looks solid,"
        " but I have a few concerns about the error handling strategy."
        " Can we discuss during the next team meeting?"
    ),
    (
        "Here's a summary of what we covered in the client call:\n"
        "- They want the feature by end of Q2\n"
        "- Budget is approved for the additional infrastructure\n"
        "- They're flexible on the exact implementation details\n"
        "- Follow-up meeting scheduled for next Thursday"
    ),
    (
        "I ran some benchmarks on the new query optimizer:\n\n"
        "| Query Type | Before | After |\n"
        "|-----------|--------|-------|\n"
        "| Simple | 45ms | 12ms |\n"
        "| Complex | 320ms | 85ms |\n"
        "| Aggregation | 890ms | 210ms |\n\n"
        "Pretty significant improvement across the board."
    ),
    (
        "Found the root cause of the memory leak. It was in the event"
        " listener cleanup - we were registering new listeners on every"
        " render but only cleaning up on unmount. The fix is"
        " straightforward but we should audit other components for the"
        " same pattern."
    ),
    (
        "Quick update on the migration plan:\n"
        "1. Phase 1: Schema changes (this week)\n"
        "2. Phase 2: Data backfill (next week)\n"
        "3. Phase 3: Switch traffic (two weeks out)\n"
        "4. Phase 4: Cleanup old tables (end of month)\n\n"
        "Let me know if anyone sees issues with this timeline."
    ),
]

CODE_SNIPPETS = [
    (
        "```python\ndef process_batch(items):\n"
        "    results = []\n"
        "    for item in items:\n"
        "        result = transform(item)\n"
        "        results.append(result)\n"
        "    return results\n```"
    ),
    (
        "```typescript\nconst fetchData = async (id: string)"
        " => {\n  const response = await api.get("
        "`/items/${id}`);\n  return response.data;\n};\n```"
    ),
    (
        "```sql\nSELECT u.name, COUNT(o.id) as order_count\n"
        "FROM users u\n"
        "LEFT JOIN orders o ON u.id = o.user_id\n"
        "GROUP BY u.name\n"
        "HAVING COUNT(o.id) > 5;\n```"
    ),
    (
        "```bash\ncurl -X POST https://api.example.com/webhook"
        " \\\\\n  -H 'Content-Type: application/json'"
        " \\\\\n  -d '{\"event\": \"deploy\","
        " \"status\": \"success\"}'\n```"
    ),
]

EMOJI_MESSAGES = [
    ":)",
    ":D",
    "<3",
    "^^",
    ";)",
]

REACTION_EMOJIS = [
    "\U0001F44D",  # thumbs up
    "\u2764\uFE0F",  # red heart
    "\U0001F604",  # grinning
    "\U0001F389",  # party
    "\U0001F44F",  # clapping
    "\U0001F525",  # fire
    "\U0001F680",  # rocket
    "\U0001F440",  # eyes
    "\u2705",  # check mark
    "\U0001F4AF",  # 100
]


def generate_message_content() -> str:
    """Generate a random chat message."""
    roll = random.random()
    if roll < 0.05:
        return random.choice(CODE_SNIPPETS)
    if roll < 0.10:
        return random.choice(CHAT_LONG_MESSAGES)
    if roll < 0.13:
        return random.choice(EMOJI_MESSAGES)
    return random.choice(CHAT_MESSAGES)


async def run_chat_stress(config: ChatStressConfig) -> None:
    """Generate chat stress test data."""
    from dotenv import load_dotenv
    from sqlalchemy import select, update

    from uniffy.core.models import Organization, User
    from uniffy.core.models.chat.channel import (
        ChannelType,
        ChatChannel,
        ChatChannelStats,
    )
    from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
    from uniffy.core.models.chat.message import ChatMessage, SenderType
    from uniffy.core.models.chat.reaction import ChatReaction
    from uniffy.core.types import generate_id
    from uniffy.db.session import close_db, get_async_session, init_db

    load_dotenv()

    logger.info(f"Chat stress seed - {config.message_count} messages")

    if config.dry_run:
        logger.info("DRY RUN - No data will be written")
        logger.info(f"  Channel: #{config.channel_name}")
        logger.info(f"  Messages: {config.message_count}")
        thread_count = int(config.message_count * config.thread_pct / 100)
        logger.info(f"  Threads: ~{thread_count}")
        logger.info(f"  Max replies per thread: {config.max_replies}")
        return

    await init_db()

    try:
        async for session in get_async_session():
            # Get org - resolve slug from env (same logic as seed.py)
            org_slug = os.environ.get("DEFAULT_ORG_SLUG")
            if not org_slug:
                from uniffy.core.types import slugify

                org_name = os.environ.get("DEFAULT_ORG_NAME", "Default")
                org_slug = slugify(org_name)

            result = await session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
            org = result.scalar_one_or_none()
            if not org:
                logger.error(
                    f"Organization with slug '{org_slug}' not found. Run normal seed first."
                )
                return

            result = await session.execute(
                select(User).where(
                    User.email.in_([
                        "admin@uniffy.io",
                        "alice@uniffy.io",
                        "bob@uniffy.io",
                        "charlie@uniffy.io",
                        "diana@uniffy.io",
                        "eve@uniffy.io",
                    ])
                )
            )
            users = list(result.scalars().all())
            if len(users) < 2:
                logger.error("Not enough dev users found. Run dev seed first.")
                return

            logger.info(f"Found {len(users)} users: {[u.username for u in users]}")

            # Check for existing stress channel
            result = await session.execute(
                select(ChatChannel).where(
                    ChatChannel.organization_id == org.id,
                    ChatChannel.slug == f"stress-{config.channel_name}",
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                logger.warning(
                    f"Stress channel #{config.channel_name} already exists. Skipping."
                )
                return

            # Create the channel
            logger.info(f"Creating channel #{config.channel_name}...")
            channel = ChatChannel(
                organization_id=org.id,
                owner_id=users[0].id,
                name=config.channel_name,
                slug=f"stress-{config.channel_name}",
                channel_type=ChannelType.PUBLIC,
                description=f"Stress test channel with {config.message_count} messages",
            )
            session.add(channel)
            await session.flush()
            await session.refresh(channel)

            # Create stats row
            stats = ChatChannelStats(
                channel_id=channel.id,
                member_count=len(users),
            )
            session.add(stats)

            # Add all users as members
            for i, user in enumerate(users):
                member = ChatChannelMember(
                    channel_id=channel.id,
                    user_id=user.id,
                    role=ChannelRole.OWNER if i == 0 else ChannelRole.MEMBER,
                )
                session.add(member)

            await session.flush()
            logger.info(f"Channel created with {len(users)} members")

            # Generate messages spread over ~30 days
            logger.info(f"Generating {config.message_count} messages...")
            now = datetime.now(UTC)
            start_time = now - timedelta(days=30)
            time_step = timedelta(days=30) / config.message_count

            root_message_ids: list[UUID] = []
            batch_size = 500
            total_root = 0
            total_replies = 0
            total_reactions = 0

            for i in range(config.message_count):
                sender = random.choice(users)
                msg_time = start_time + (time_step * i) + timedelta(
                    seconds=random.randint(0, int(time_step.total_seconds()))
                )
                content = generate_message_content()

                # Decide if this is a thread reply
                is_reply = (
                    root_message_ids
                    and random.random() < 0.15
                    and len(root_message_ids) > 0
                )
                root_id = random.choice(root_message_ids) if is_reply else None

                msg = ChatMessage(
                    id=generate_id(),
                    channel_id=channel.id,
                    sender_id=sender.id,
                    sender_type=SenderType.USER,
                    content=content,
                    root_id=root_id,
                    created_at=msg_time,
                    updated_at=msg_time,
                )
                session.add(msg)

                if root_id:
                    total_replies += 1
                else:
                    total_root += 1
                    # Some root messages become threads
                    if random.random() < (config.thread_pct / 100):
                        root_message_ids.append(msg.id)
                        # Cap tracked threads to avoid memory bloat
                        if len(root_message_ids) > 500:
                            root_message_ids = root_message_ids[-300:]

                # Random reactions (~10% of messages)
                if random.random() < 0.10:
                    num_reactions = random.randint(1, 3)
                    reactors = random.sample(users, min(num_reactions, len(users)))
                    for reactor in reactors:
                        emoji = random.choice(REACTION_EMOJIS)
                        reaction = ChatReaction(
                            message_id=msg.id,
                            user_id=reactor.id,
                            emoji=emoji,
                            created_at=msg_time + timedelta(seconds=random.randint(1, 300)),
                        )
                        session.add(reaction)
                        total_reactions += 1

                if (i + 1) % batch_size == 0:
                    await session.flush()
                    logger.info(f"  {i + 1}/{config.message_count} messages...")

            # Final flush
            await session.flush()

            # Update channel stats
            await session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel.id)
                .values(
                    message_count=total_root + total_replies,
                    root_message_count=total_root,
                    last_message_at=now,
                    last_root_message_at=now,
                )
            )

            await session.commit()

            logger.info("=" * 50)
            logger.info("CHAT STRESS SEED COMPLETE")
            logger.info("=" * 50)
            logger.info(f"Channel: #{config.channel_name}")
            logger.info(f"Root messages: {total_root}")
            logger.info(f"Thread replies: {total_replies}")
            logger.info(f"Total messages: {total_root + total_replies}")
            logger.info(f"Threads created: {len(root_message_ids)}")
            logger.info(f"Reactions: {total_reactions}")
            logger.info(f"Members: {len(users)}")
    finally:
        await close_db()


def main() -> None:
    """Entry point for chat stress seed script."""
    parser = argparse.ArgumentParser(
        description="Generate chat stress test data for Uniffy",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--messages",
        type=int,
        default=5000,
        help="Number of messages to generate",
    )
    parser.add_argument(
        "--channel-name",
        type=str,
        default="stress-test",
        help="Name of the stress test channel",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=5,
        help="Percentage of root messages that become threads",
    )
    parser.add_argument(
        "--replies",
        type=int,
        default=10,
        help="Max replies per thread",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print stats without writing to database",
    )

    args = parser.parse_args()

    config = ChatStressConfig(
        message_count=args.messages,
        channel_name=args.channel_name,
        thread_pct=args.threads,
        max_replies=args.replies,
        dry_run=args.dry_run,
    )

    asyncio.run(run_chat_stress(config))


if __name__ == "__main__":
    main()
