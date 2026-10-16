"""Logins and documents created through the public ConnectRPC API."""

from __future__ import annotations

import asyncio
import random
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_connect import AuthServiceClient
from uniffy_proto.auth.v1.auth_pb import AuthResult, LoginRequest, SwitchOrganizationRequest
from uniffy_proto.common.v1.common_pb import AccessMode, ContentRole
from uniffy_proto.notes.v1.notes_connect import NotesServiceClient
from uniffy_proto.notes.v1.notes_pb import CreateNoteRequest, GetNoteRequest, UpdateNoteRequest
from uniffy_proto.organizations.v1.organizations_connect import OrganizationsServiceClient
from uniffy_proto.organizations.v1.organizations_pb import ListMyOrganizationsRequest

from uniffy.scripts.demo_company.loader import load_demo_content

CREATE_CONCURRENCY = 8


@dataclass(frozen=True)
class Identity:
    """A logged-in seeded member; the token stays in memory only."""

    email: str
    user_id: str
    organization_id: str
    token: str = field(repr=False)


def roster_emails(count: int) -> list[str]:
    """Logins the demo seeder created, in roster order."""
    people = load_demo_content().people.people
    emails = [person.email for person in people if person.username]
    if len(emails) < count:
        raise SystemExit(f"--users {count} exceeds the {len(emails)} seeded logins")
    return emails[:count]


async def login(api_url: str, emails: list[str], password: str) -> list[Identity]:
    """Password login, then the organization switch the web picker performs."""
    identities = []
    async with (
        AuthServiceClient(api_url) as auth,
        OrganizationsServiceClient(api_url) as organizations,
    ):
        for email in emails:
            response = await auth.login(LoginRequest(email=email, password=password))
            unscoped = response.result.value if response.result is not None else None
            if not isinstance(unscoped, AuthResult):
                raise SystemExit(f"login for {email} did not return tokens")
            memberships = await organizations.list_my_organizations(
                ListMyOrganizationsRequest(),
                headers={"authorization": f"Bearer {unscoped.access_token}"},
            )
            slugs = {
                item.organization.slug for item in memberships.organizations if item.organization
            }
            if len(slugs) != 1:
                raise SystemExit(f"{email} belongs to {len(slugs)} organizations, expected one")
            switched = await auth.switch_organization(
                SwitchOrganizationRequest(
                    refresh_token=unscoped.refresh_token, organization_slug=slugs.pop()
                )
            )
            result = switched.auth_result
            if result is None or not result.organization_id:
                raise SystemExit(f"organization switch for {email} returned no organization")
            identities.append(
                Identity(email, result.user_id, result.organization_id, result.access_token)
            )
    if len({identity.organization_id for identity in identities}) != 1:
        raise SystemExit("seeded users do not share one organization")
    return identities


def document_text(size: int, rng: random.Random) -> str:
    words = [
        "".join(rng.choices("abcdefghijklmnopqrstuvwxyz", k=rng.randrange(2, 10)))
        for _ in range(512)
    ]
    lines = []
    length = 0
    while length < size:
        line = " ".join(rng.choices(words, k=12))
        lines.append(line)
        length += len(line) + 1
    return "\n".join(lines)[:size]


async def create_notes(
    api_url: str, owner: Identity, count: int, title: str, content: str
) -> list[UUID]:
    """Org-open editor notes, so every seeded member may write to every document."""
    gate = asyncio.Semaphore(CREATE_CONCURRENCY)
    headers = {"authorization": f"Bearer {owner.token}"}
    async with NotesServiceClient(api_url) as client:

        async def create(index: int) -> UUID:
            async with gate:
                response = await client.create_note(
                    CreateNoteRequest(
                        organization_id=owner.organization_id,
                        title=f"{title} {index + 1}",
                        content=content,
                        access_mode=AccessMode.OPEN_TO_ORG,
                        baseline_role=ContentRole.EDITOR,
                    ),
                    headers=headers,
                )
            if response.note is None:
                raise SystemExit("CreateNote returned no note")
            return UUID(response.note.id)

        return list(await asyncio.gather(*(create(index) for index in range(count))))


async def append_line_through_rpc(
    api_url: str, owner: Identity, note_ids: list[UUID], line: str
) -> dict[str, Any]:
    """Ordinary text writes as the web host sends them, then a read back of each note.

    Outcomes are ``ok`` or the Connect code of a refused write; ``stored`` counts notes whose
    content reads back with the line, which a merge with live edits keeps.
    """
    headers = {"authorization": f"Bearer {owner.token}"}
    outcomes: Counter[str] = Counter()
    stored = 0
    async with NotesServiceClient(api_url) as client:
        for note_id in note_ids:
            read = GetNoteRequest(note_id=str(note_id), organization_id=owner.organization_id)
            before = await client.get_note(read, headers=headers)
            base = before.note.content if before.note is not None else ""
            written = f"{base}\n{line}"
            try:
                await client.update_note(
                    UpdateNoteRequest(
                        note_id=str(note_id),
                        organization_id=owner.organization_id,
                        content=written,
                        base_content=base,
                    ),
                    headers=headers,
                )
            except ConnectError as exc:
                outcomes[exc.code.value] += 1
                continue
            outcomes["ok"] += 1
            after = await client.get_note(read, headers=headers)
            stored += after.note is not None and line in after.note.content
    return {"writes": len(note_ids), "outcomes": dict(outcomes), "stored": stored}
