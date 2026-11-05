"""Inspect chat delivery backlog and rearm failed effects as a database operator."""

import argparse
import asyncio
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select, text

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.chat_trigger import AgentChatTrigger, ChatTriggerStatus
from uniffy.core.models.chat.delivery import ChatDelivery, ChatDeliveryEffect, ChatDeliveryStatus
from uniffy.domains.chat.delivery_operations import retry_failed_delivery
from uniffy.infrastructure.database import close_db, init_db, open_session


class Command(StrEnum):
    LIST = "list"
    AGENTS = "agents"
    RETRY = "retry"
    STATS = "stats"


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    for name in (Command.LIST, Command.AGENTS, Command.RETRY):
        sub = commands.add_parser(name)
        sub.add_argument("--organization-id", required=True, type=UUID)
        if name == Command.RETRY:
            sub.add_argument("--message-id", required=True, type=UUID)
            sub.add_argument(
                "--effect", required=True, type=ChatDeliveryEffect, choices=list(ChatDeliveryEffect)
            )
            sub.add_argument("--operator", required=True)
            sub.add_argument("--reason", required=True)
        else:
            sub.add_argument("--limit", type=int, default=100)
            statuses = ChatDeliveryStatus if name == Command.LIST else ChatTriggerStatus
            sub.add_argument(
                "--status",
                choices=[str(value) for value in statuses],
                default=str(
                    ChatDeliveryStatus.FAILED
                    if name == Command.LIST
                    else ChatTriggerStatus.UNCERTAIN
                ),
            )
    commands.add_parser("stats")
    return root


async def run(args: argparse.Namespace) -> None:
    await init_db(skip_migrations=True)
    try:
        async with open_session() as session:
            if args.command == Command.RETRY:
                await retry_failed_delivery(
                    session,
                    organization_id=args.organization_id,
                    message_id=args.message_id,
                    effect=args.effect,
                    operator=args.operator,
                    reason=args.reason,
                )
                print("Delivery rearmed. Recovery will dispatch it on its next sweep.")
            elif args.command == Command.STATS:
                rows = (
                    (
                        await session.execute(
                            text("""
                    SELECT s.relname, pg_total_relation_size(s.relid) AS total_bytes,
                           s.n_live_tup, s.n_dead_tup, s.last_autovacuum, s.last_autoanalyze,
                           c.reloptions
                    FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
                    WHERE s.relname IN ('chat_deliveries', 'agents_chat_triggers')
                    ORDER BY s.relname
                """)
                        )
                    )
                    .mappings()
                    .all()
                )
                print(dumps_str([dict(row) for row in rows], default=str))
            elif args.command == Command.LIST:
                rows = (
                    await session.scalars(
                        select(ChatDelivery)
                        .where(
                            ChatDelivery.organization_id == args.organization_id,
                            ChatDelivery.status == args.status,
                        )
                        .order_by(ChatDelivery.created_at, ChatDelivery.message_id)
                        .limit(max(1, min(args.limit, 500)))
                    )
                ).all()
                print(dumps_str([row.model_dump() for row in rows], default=str))
            elif args.command == Command.AGENTS:
                rows = (
                    await session.scalars(
                        select(AgentChatTrigger)
                        .where(
                            AgentChatTrigger.organization_id == args.organization_id,
                            AgentChatTrigger.status == args.status,
                        )
                        .order_by(AgentChatTrigger.created_at, AgentChatTrigger.id)
                        .limit(max(1, min(args.limit, 500)))
                    )
                ).all()
                print(dumps_str([row.model_dump() for row in rows], default=str))
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(run(parser().parse_args()))
