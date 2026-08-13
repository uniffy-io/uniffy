from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.users.v1.users_pb2 import (
    DeleteAvatarRequest,
    DeleteAvatarResponse,
    GetMyProfileRequest,
    GetMyProfileResponse,
    UpdateMyProfileRequest,
    UpdateMyProfileResponse,
    UploadAvatarRequest,
    UploadAvatarResponse,
)

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.users.converters import user_to_profile
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="users.handlers")


class UsersHandlers:
    async def get_my_profile(
        self,
        request: GetMyProfileRequest,
        ctx: RequestContext,
    ) -> GetMyProfileResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = UserOperations(session)
                user = await ops.get_by_id(user_id)
                return GetMyProfileResponse(user=user_to_profile(user))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error fetching user profile: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_my_profile(
        self,
        request: UpdateMyProfileRequest,
        ctx: RequestContext,
    ) -> UpdateMyProfileResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = UserOperations(session)
                user = await ops.update_profile(
                    user_id=user_id,
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                    font_family=request.font_family if request.HasField("font_family") else None,
                    pronouns=request.pronouns if request.HasField("pronouns") else None,
                )
                return UpdateMyProfileResponse(user=user_to_profile(user))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating profile: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upload_avatar(
        self,
        request: UploadAvatarRequest,
        ctx: RequestContext,
    ) -> UploadAvatarResponse:
        user_id = get_user_id_from_context(ctx)

        if not request.image_data:
            raise ConnectError(Code.INVALID_ARGUMENT, "Image data is required")
        if not request.filename:
            raise ConnectError(Code.INVALID_ARGUMENT, "Filename is required")

        try:
            async with open_session() as session:
                ops = UserOperations(session)
                user = await ops.upload_avatar(
                    user_id=user_id,
                    image_data=request.image_data,
                    filename=request.filename,
                )
                return UploadAvatarResponse(user=user_to_profile(user))
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error uploading avatar: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_avatar(
        self,
        request: DeleteAvatarRequest,
        ctx: RequestContext,
    ) -> DeleteAvatarResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = UserOperations(session)
                user = await ops.delete_avatar(user_id)
                return DeleteAvatarResponse(user=user_to_profile(user))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error deleting avatar: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
