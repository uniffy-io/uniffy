from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.jobs.contracts import REINDEX_ORG_CONTENT_FOR_DEFAULTS


async def test_defaults_change_enqueues_content_reindex_on_core_queue() -> None:
    organization_id = generate_id()
    user_id = generate_id()
    defaults = OrganizationPermissionDefaults(
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        default_access_mode=AccessMode.OWNER_ONLY,
        updated_by_user_id=user_id,
    )
    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = defaults
    session = AsyncMock()
    session.execute.return_value = query_result

    operations = OrganizationOperations.__new__(OrganizationOperations)
    operations._session = session
    operations.require_org_admin = AsyncMock()

    enqueue = AsyncMock()
    with (
        patch("uniffy.domains.organizations.operations.enqueue_job", enqueue),
        patch(
            "uniffy.domains.organizations.operations.write_audit_event",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.core.realtime.publisher.publish_defaults_changed",
            new=AsyncMock(),
        ),
    ):
        updated = await operations.update_permission_defaults(
            user_id,
            organization_id,
            ContentType.NOTE,
            default_access_mode=AccessMode.OPEN_TO_ORG,
            default_baseline_role=ContentRole.VIEWER,
        )

    assert updated is defaults
    run_id = str(int(defaults.updated_at.timestamp() * 1_000_000))
    enqueue.assert_awaited_once_with(
        REINDEX_ORG_CONTENT_FOR_DEFAULTS,
        str(organization_id),
        ContentType.NOTE.value,
        None,
        run_id,
        _job_id=f"reindex_defaults:{organization_id}:{ContentType.NOTE.value}:{run_id}",
    )
