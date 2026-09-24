"""Names available to organization subject pickers and content ordering."""

from uuid import UUID

from sqlalchemy import Subquery, and_, exists, func, or_, select

from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User


def subject_names(organization_id: UUID, user_id: UUID) -> Subquery:
    people = select(
        User.id.label("subject_id"),
        func.coalesce(func.nullif(User.full_name, ""), User.username).label("name"),
    ).where(
        exists().where(
            and_(
                OrganizationMember.user_id == User.id,
                OrganizationMember.organization_id == organization_id,
            )
        )
    )
    own_membership = exists().where(
        and_(
            GroupMember.group_id == Group.id,
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
        )
    )
    groups = select(Group.id.label("subject_id"), Group.name.label("name")).where(
        Group.organization_id == organization_id,
        or_(Group.is_private.is_(False), own_membership),
    )
    return people.union_all(groups).subquery()
