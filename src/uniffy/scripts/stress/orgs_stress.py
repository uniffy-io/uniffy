"""Stress seed: create many organizations with many members each.

Run inside the dev backend container so it shares the same Postgres,
Valkey, and Meilisearch as the running app:

    docker compose exec uniffy-backend \
        uv run python scripts/stress/seed_stress.py --orgs 100 --users-per-org 25

Defaults to 100 orgs x 25 members. Idempotent on re-run: existing users
and orgs (matched by email / slug) are reused, not duplicated.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import time
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models import Organization, User
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.db.session import close_db, init_db, open_session
from uniffy.domains.auth.passwords import hash_password
from uniffy.domains.organizations.operations import OrganizationOperations

_PLANS = ["free", "pro", "team", "business", "enterprise"]
_FIRST_NAMES = [
    "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry",
    "Ivy", "Jack", "Kara", "Liam", "Maya", "Nora", "Owen", "Piper",
    "Quinn", "Riley", "Sage", "Tara", "Uma", "Vince", "Willa", "Xan",
    "Yuna", "Zane",
]
_LAST_NAMES = [
    "Adams", "Brown", "Clark", "Davis", "Evans", "Foster", "Garcia",
    "Hughes", "Iyer", "Jensen", "Khan", "Lopez", "Miller", "Nguyen",
    "Olsen", "Patel", "Quinn", "Reyes", "Smith", "Tanaka", "Ueda",
    "Vargas", "Wong", "Xu", "Young", "Zhao",
]
_ORG_WORDS = [
    "Acme", "Globex", "Initech", "Umbrella", "Soylent", "Tyrell",
    "Wonka", "Stark", "Wayne", "Cyberdyne", "Hooli", "Pied-Piper",
    "Massive-Dynamic", "Aperture", "Black-Mesa", "Vandelay", "Bluth",
    "Dunder", "Sterling", "Pinnacle", "Vector", "Helios", "Orion",
    "Nimbus", "Aurora", "Beacon",
]


def _org_name(idx: int, rng: random.Random) -> tuple[str, str]:
    base = rng.choice(_ORG_WORDS)
    name = f"{base} {idx:04d}"
    slug = f"stress-{base.lower()}-{idx:04d}"
    return name, slug


def _user_identity(
    org_idx: int, user_idx: int, rng: random.Random, prefix: str
) -> tuple[str, str, str]:
    first = rng.choice(_FIRST_NAMES)
    last = rng.choice(_LAST_NAMES)
    full_name = f"{first} {last}"
    username = f"{prefix}-o{org_idx:04d}-u{user_idx:03d}"
    email = f"{username}@uniffy.local"
    return email, username, full_name


async def _get_or_create_user(
    session, email: str, username: str, full_name: str, password_hash: str
) -> User:
    existing = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing:
        return existing
    user = User(
        email=email,
        username=username,
        full_name=full_name,
        hashed_password=password_hash,
        is_active=True,
        is_system_admin=False,
        email_verified=True,
    )
    session.add(user)
    await session.flush()
    await session.refresh(user)
    return user


async def _provision_org(
    org_idx: int,
    users_per_org: int,
    password_hash: str,
    prefix: str,
    rng: random.Random,
) -> tuple[UUID, str, int]:
    name, slug = _org_name(org_idx, rng)

    async with open_session() as session:
        existing_org = (
            await session.execute(select(Organization).where(Organization.slug == slug))
        ).scalar_one_or_none()
        if existing_org:
            return existing_org.id, slug, 0

        owner_email, owner_username, owner_full_name = _user_identity(
            org_idx, 0, rng, prefix
        )
        owner = await _get_or_create_user(
            session, owner_email, owner_username, owner_full_name, password_hash
        )

        org_ops = OrganizationOperations(session)
        org = await org_ops.create(
            name=name,
            slug=slug,
            owner_user_id=owner.id,
            plan=rng.choice(_PLANS),
        )

        added = 1
        for user_idx in range(1, users_per_org):
            email, username, full_name = _user_identity(
                org_idx, user_idx, rng, prefix
            )
            member_user = await _get_or_create_user(
                session, email, username, full_name, password_hash
            )
            role = OrganizationRole.MEMBER
            if user_idx == 1 and users_per_org > 2:
                role = OrganizationRole.ADMIN
            await org_ops.add_member(
                user_id=member_user.id,
                org_id=org.id,
                role=role,
                actor_user_id=owner.id,
            )
            added += 1

        return org.id, slug, added


async def stress_seed(
    *, orgs: int, users_per_org: int, password: str, prefix: str, seed: int
) -> None:
    rng = random.Random(seed)
    password_hash = hash_password(password)

    await init_db(skip_migrations=True)

    logger.info(
        f"Stress seeding {orgs} orgs x {users_per_org} members "
        f"(password='{password}', prefix='{prefix}', rng-seed={seed})"
    )

    started = time.monotonic()
    created_orgs = 0
    skipped_orgs = 0
    total_members = 0

    try:
        for i in range(1, orgs + 1):
            t0 = time.monotonic()
            try:
                _org_id, slug, added = await _provision_org(
                    i, users_per_org, password_hash, prefix, rng
                )
            except Exception:
                logger.exception(f"Org #{i} failed; continuing")
                continue

            if added == 0:
                skipped_orgs += 1
                logger.info(f"[{i}/{orgs}] skip {slug} (exists)")
            else:
                created_orgs += 1
                total_members += added
                elapsed = time.monotonic() - t0
                logger.info(
                    f"[{i}/{orgs}] {slug} +{added} members in {elapsed:.1f}s"
                )
    finally:
        await close_db()

    total = time.monotonic() - started
    logger.info(
        f"Done: created={created_orgs} skipped={skipped_orgs} "
        f"members_added={total_members} in {total:.1f}s"
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stress-seed orgs and members.")
    parser.add_argument("--orgs", type=int, default=100)
    parser.add_argument("--users-per-org", type=int, default=25)
    parser.add_argument("--password", type=str, default="stress")
    parser.add_argument(
        "--prefix",
        type=str,
        default="stress",
        help="Username/email prefix so stress users are easy to spot/clean.",
    )
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()
    if args.orgs < 1 or args.users_per_org < 1:
        parser.error("--orgs and --users-per-org must be >= 1")
    return args


def main() -> None:
    args = _parse_args()
    asyncio.run(
        stress_seed(
            orgs=args.orgs,
            users_per_org=args.users_per_org,
            password=args.password,
            prefix=args.prefix,
            seed=args.seed,
        )
    )


if __name__ == "__main__":
    main()
