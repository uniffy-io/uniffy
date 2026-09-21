"""Claims and guarded publication for immutable playback copies."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from uniffy.core.models.files.file import File, PlaybackStatus
from uniffy.core.models.files.rendition import FileRendition
from uniffy.core.types import generate_id
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.infrastructure.database import open_session


@dataclass(frozen=True)
class PlaybackClaim:
    file_id: UUID
    organization_id: UUID
    owner_id: UUID
    version: int
    source_key: str
    output_key: str
    size_bytes: int
    attempt: int


def matches_claim(file: File, claim: PlaybackClaim) -> bool:
    return (
        file.id == claim.file_id
        and file.organization_id == claim.organization_id
        and file.version == claim.version
        and file.storage_key == claim.source_key
        and file.playback_key == claim.output_key
        and file.playback_status == PlaybackStatus.PROCESSING
        and not file.is_deleted
    )


async def claim_playback(file_id: UUID, organization_id: UUID) -> PlaybackClaim | None:
    now = datetime.now(UTC)
    async with open_session() as session:
        file = (
            await session.execute(
                select(File)
                .where(
                    File.id == file_id,
                    File.organization_id == organization_id,
                    File.is_deleted.is_(False),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if file is None or file.playback_status not in {
            PlaybackStatus.PENDING,
            PlaybackStatus.PROCESSING,
        }:
            return None
        if (
            file.playback_status == PlaybackStatus.PROCESSING
            and file.playback_started_at
            and file.playback_started_at > now - timedelta(seconds=MEDIA_SETTINGS.job_timeout + 60)
        ):
            return None
        if not MEDIA_SETTINGS.enabled or file.playback_attempts >= 3:
            file.playback_status = PlaybackStatus.FAILED
            file.playback_error = (
                "Conversion disabled"
                if not MEDIA_SETTINGS.enabled
                else "Conversion attempts exhausted"
            )
            await session.commit()
            return None
        key = f"{organization_id}/renditions/{file.id}/{file.version}/{generate_id()}.mp4"
        file.playback_status = PlaybackStatus.PROCESSING
        file.playback_started_at = now
        file.playback_version = file.version
        file.playback_key = key
        file.playback_attempts += 1
        file.playback_error = None
        session.add(
            FileRendition(
                storage_key=key,
                file_id=file.id,
                expires_at=now + timedelta(seconds=MEDIA_SETTINGS.job_timeout + 120),
            )
        )
        claim = PlaybackClaim(
            file.id,
            organization_id,
            file.owner_id,
            file.version,
            file.storage_key,
            key,
            file.size_bytes,
            file.playback_attempts,
        )
        await session.commit()
        return claim


async def finish_playback(
    claim: PlaybackClaim, status: PlaybackStatus, error: str | None = None
) -> bool:
    async with open_session() as session:
        file = (
            await session.execute(select(File).where(File.id == claim.file_id).with_for_update())
        ).scalar_one_or_none()
        if file is None or not matches_claim(file, claim):
            return False
        file.playback_status = status
        file.playback_error = error[:2000] if error else None
        file.playback_started_at = None
        if status != PlaybackStatus.COMPLETED:
            file.playback_key = None
            file.playback_version = None
        await session.commit()
        return True


async def record_multipart(key: str, upload_id: str) -> None:
    async with open_session() as session:
        await session.execute(
            update(FileRendition).where(FileRendition.storage_key == key).values(upload_id=upload_id)
        )
        await session.commit()
