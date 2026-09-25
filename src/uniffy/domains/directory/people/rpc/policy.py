from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.domains.directory.people.converters import policy_to_proto
from uniffy.domains.directory.people.policy import (
    ResolvedProfilePolicy,
    load_profile_policy,
    save_profile_policy,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.people.rpc.policy")


class ProfilePolicyHandlers:
    async def get_profile_policy(
        self,
        request: pb.GetProfilePolicyRequest,
        ctx: RequestContext,
    ) -> pb.GetProfilePolicyResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                policy = await load_profile_policy(session, org_id)
            return pb.GetProfilePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error fetching profile policy: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_profile_policy(
        self,
        request: pb.UpdateProfilePolicyRequest,
        ctx: RequestContext,
    ) -> pb.UpdateProfilePolicyResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                fields = request.policy if request.policy is not None else pb.ProfilePolicy()
                policy = ResolvedProfilePolicy(
                    organization_id=org_id,
                    directory_enabled=fields.directory_enabled,
                    org_chart_enabled=fields.org_chart_enabled,
                )
                await save_profile_policy(session, policy=policy, updated_by_user_id=user_id)
                await session.commit()
            return pb.UpdateProfilePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error updating profile policy: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
