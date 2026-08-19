from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.core.valkey.queue import QueueName
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.workers.tasks import JobName


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

    queue = MagicMock()
    queue.enqueue_job = AsyncMock()
    with (
        patch("uniffy.domains.organizations.operations.get_queue", return_value=queue) as get_queue,
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
    get_queue.assert_called_once_with(QueueName.CORE)
    run_id = str(int(defaults.updated_at.timestamp() * 1_000_000))
    queue.enqueue_job.assert_awaited_once_with(
        JobName.REINDEX_ORG_CONTENT_FOR_DEFAULTS,
        str(organization_id),
        ContentType.NOTE.value,
        None,
        run_id,
        _job_id=f"reindex_defaults:{organization_id}:{ContentType.NOTE.value}:{run_id}",
    )
