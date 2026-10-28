from datetime import UTC, datetime

import pytest
from sqlalchemy import select, update
from uniffy_proto.notifications.v1.notifications_pb import ListNotificationsRequest

from uniffy.core.auth.principal import (
    principal_from_access_token,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.auth.tokens import create_access_token
from uniffy.core.errors import MembershipRequiredError
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.shared import NotificationType
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.notifications.handlers import NotificationsHandlers
from uniffy.domains.notifications.operations import NotificationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import _auth_session
from uniffy.tests.integration.access.test_call_revocation import _make_system_admin

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("closed_state", ["suspended", "deleted", "removed"])
async def test_notification_operations_require_live_membership(session, access, closed_state):
    session.add(
        OrganizationMember(
            user_id=access.member_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        )
    )
    closed = Notification(
        user_id=access.member_id,
        organization_id=access.org_id,
        notification_type=NotificationType.CHAT_MENTION,
        title="Private preview",
        body="Closed organization",
        source_urn="urn:uniffy:content:NOTE:notification-test",
    )
    active = Notification(
        user_id=access.member_id,
        organization_id=access.other_org_id,
        notification_type=NotificationType.CHAT_MENTION,
        title="Active preview",
        body="Active organization",
    )
    session.add_all([closed, active])
    await session.commit()
    closed_id, active_id = closed.id, active.id
    ops = NotificationOperations(session)
    assert (await ops.list_notifications(access.member_id, access.org_id))[1] == 1

    if closed_state == "removed":
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == access.member_id,
            )
            .values(is_active=False)
        )
    else:
        await session.execute(
            update(Organization)
            .where(Organization.id == access.org_id)
            .values(
                is_suspended=closed_state == "suspended",
                deleted_at=datetime.now(UTC) if closed_state == "deleted" else None,
            )
        )
    await session.commit()

    for method in (
        ops.list_notifications,
        ops.search_notifications,
        ops.get_unread_count,
        ops.get_notification_stats,
        ops.mark_all_as_read,
    ):
        with pytest.raises(MembershipRequiredError):
            await method(access.member_id, access.org_id)
    for method in (ops.mark_as_read, ops.delete_notification):
        with pytest.raises(MembershipRequiredError):
            await method(access.member_id, closed_id)
    for method in (ops.bulk_mark_as_read, ops.bulk_delete_notifications):
        with pytest.raises(MembershipRequiredError):
            await method(access.member_id, [closed_id, active_id])
    with pytest.raises(MembershipRequiredError):
        await ops.mark_read_by_source_urn(access.member_id, access.org_id, closed.source_urn)

    session.expire_all()
    rows = list(
        (
            await session.execute(
                select(Notification).where(Notification.id.in_([closed_id, active_id]))
            )
        ).scalars()
    )
    assert len(rows) == 2
    assert not any(row.is_read for row in rows)
    assert await ops.get_unread_count(access.member_id, access.other_org_id) == 1
    assert await ops.bulk_mark_as_read(access.member_id, [active_id]) == 1
    assert await ops.bulk_delete_notifications(access.member_id, [active_id]) == 1


async def test_suspended_org_token_cannot_read_notification_handler(session, access):
    await _make_system_admin(session, access.outsider_id)
    auth = await _auth_session(session, access.member_id, access.org_id)
    user = await session.get(User, access.member_id)
    bearer = create_access_token(
        access.member_id, access.org_id, token_version=user.token_version, session_id=auth.id
    )
    session.add(
        Notification(
            user_id=access.member_id,
            organization_id=access.org_id,
            notification_type=NotificationType.CHAT_MENTION,
            title="Private preview",
            body="Tenant message",
        )
    )
    await session.commit()
    await PlatformDirectoryOperations(session, CallsLifecycle(open_session)).suspend_organization(
        user_id=access.outsider_id, organization_id=access.org_id, reason="Access test"
    )
    principal = principal_from_access_token(bearer)
    await AuthenticationInterceptor._enforce_principal_revocation(principal)
    token = set_current_principal(principal)
    try:
        with pytest.raises(MembershipRequiredError):
            await NotificationsHandlers().list_notifications(
                ListNotificationsRequest(organization_id=str(access.org_id)), None
            )
    finally:
        reset_current_principal(token)
