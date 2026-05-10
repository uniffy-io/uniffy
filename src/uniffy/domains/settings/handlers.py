"""Settings RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.settings.v1.settings_pb2 import (
    CreateProfileRequest,
    CreateProfileResponse,
    DeleteProfileRequest,
    DeleteProfileResponse,
    GetEffectiveSettingsRequest,
    GetEffectiveSettingsResponse,
    GetProfileRequest,
    GetProfileResponse,
    GetSettingsSchemaRequest,
    GetSettingsSchemaResponse,
    ListProfilesRequest,
    ListProfilesResponse,
    SetDefaultProfileRequest,
    SetDefaultProfileResponse,
    UpdateProfileRequest,
    UpdateProfileResponse,
)

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.settings.converters import (
    appearance_dict_to_proto,
    appearance_from_proto,
    effective_settings_to_proto,
    keyboard_shortcuts_dict_to_proto,
    keyboard_shortcuts_from_proto,
    notifications_dict_to_proto,
    notifications_from_proto,
    profile_to_proto,
)
from uniffy.domains.settings.operations import SettingsOperations


class SettingsHandlers:
    """RPC handlers for settings service."""

    async def create_profile(
        self,
        request: CreateProfileRequest,
        ctx: RequestContext,
    ) -> CreateProfileResponse:
        """
        Handle create_profile RPC call.

        Creates a new settings profile for the authenticated user.

        Parameters
        ----------
        request : CreateProfileRequest
            The create request with profile details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProfileResponse
            The created profile.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)

                profile = await ops.create_profile(
                    user_id=user_id,
                    name=request.name,
                    appearance=appearance_from_proto(request.appearance),
                    keyboard_shortcuts=keyboard_shortcuts_from_proto(request.keyboard_shortcuts),
                    notifications=notifications_from_proto(request.notifications),
                    is_default=request.is_default,
                )

                return CreateProfileResponse(profile=profile_to_proto(profile))

        except ValidationError as e:
            raise ConnectError(Code.ALREADY_EXISTS, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_profile(
        self,
        request: GetProfileRequest,
        ctx: RequestContext,
    ) -> GetProfileResponse:
        """
        Handle get_profile RPC call.

        Gets a settings profile by ID.

        Parameters
        ----------
        request : GetProfileRequest
            The request with profile ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProfileResponse
            The requested profile.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            profile_id = UUID(request.profile_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid profile ID format")

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)
                profile = await ops.get_profile(user_id, profile_id)
                return GetProfileResponse(profile=profile_to_proto(profile))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Profile not found")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_profile(
        self,
        request: UpdateProfileRequest,
        ctx: RequestContext,
    ) -> UpdateProfileResponse:
        """
        Handle update_profile RPC call.

        Updates an existing settings profile (sparse update).

        Parameters
        ----------
        request : UpdateProfileRequest
            The update request with changes.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProfileResponse
            The updated profile.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            profile_id = UUID(request.profile_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid profile ID format")

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)

                # Extract optional fields
                name = request.name if request.HasField("name") else None
                is_default = request.is_default if request.HasField("is_default") else None

                profile = await ops.update_profile(
                    user_id=user_id,
                    profile_id=profile_id,
                    name=name,
                    appearance=appearance_from_proto(request.appearance),
                    keyboard_shortcuts=keyboard_shortcuts_from_proto(request.keyboard_shortcuts),
                    notifications=notifications_from_proto(request.notifications),
                    is_default=is_default,
                )

                return UpdateProfileResponse(profile=profile_to_proto(profile))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Profile not found")
        except ValidationError as e:
            raise ConnectError(Code.ALREADY_EXISTS, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_profile(
        self,
        request: DeleteProfileRequest,
        ctx: RequestContext,
    ) -> DeleteProfileResponse:
        """
        Handle delete_profile RPC call.

        Deletes a settings profile.

        Parameters
        ----------
        request : DeleteProfileRequest
            The delete request with profile ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteProfileResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            profile_id = UUID(request.profile_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid profile ID format")

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)
                await ops.delete_profile(user_id, profile_id)
                return DeleteProfileResponse(success=True, message="Profile deleted successfully")

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Profile not found")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_profiles(
        self,
        request: ListProfilesRequest,
        ctx: RequestContext,
    ) -> ListProfilesResponse:
        """
        Handle list_profiles RPC call.

        Lists all profiles for the authenticated user.

        Parameters
        ----------
        request : ListProfilesRequest
            The list request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListProfilesResponse
            List of profiles.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)
                profiles = await ops.list_profiles(user_id)

                return ListProfilesResponse(
                    profiles=[profile_to_proto(p) for p in profiles],
                    total_count=len(profiles),
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing profiles: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_effective_settings(
        self,
        request: GetEffectiveSettingsRequest,
        ctx: RequestContext,
    ) -> GetEffectiveSettingsResponse:
        """
        Handle get_effective_settings RPC call.

        Gets effective settings (defaults merged with profile overrides).

        Parameters
        ----------
        request : GetEffectiveSettingsRequest
            The request with optional profile ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        EffectiveSettingsResponse
            Profile and merged effective settings.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)

                # Get specific profile or default
                if request.HasField("profile_id"):
                    try:
                        profile_id = UUID(request.profile_id)
                        profile = await ops.get_profile(user_id, profile_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid profile ID format")
                else:
                    profile = await ops.get_or_create_default_profile(user_id)

                # Compute effective settings
                effective = ops.get_effective_settings(profile)

                return GetEffectiveSettingsResponse(
                    profile=profile_to_proto(profile),
                    effective_settings=effective_settings_to_proto(effective),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Profile not found")
        except ConnectError:
            raise
        except Exception as e:
            # Check for FK violation (user doesn't exist in DB)
            is_fk_error = "ForeignKeyViolationError" in str(type(e).__name__)
            if is_fk_error or "foreign key" in str(e).lower():
                raise ConnectError(Code.UNAUTHENTICATED, "User not found. Please log in again.")
            logger.error(f"Error getting effective settings: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_settings_schema(
        self,
        request: GetSettingsSchemaRequest,
        ctx: RequestContext,
    ) -> GetSettingsSchemaResponse:
        """
        Handle get_settings_schema RPC call.

        Gets the schema of available settings with their defaults.

        Parameters
        ----------
        request : GetSettingsSchemaRequest
            The request (no parameters).
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SettingsSchemaResponse
            Settings schema with defaults.

        """
        # Authentication not strictly required but we verify anyway
        get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)
                schema = ops.get_settings_schema()

                return GetSettingsSchemaResponse(
                    appearance_defaults=appearance_dict_to_proto(schema["appearance_defaults"]),
                    keyboard_shortcuts_defaults=keyboard_shortcuts_dict_to_proto(
                        schema["keyboard_shortcuts_defaults"]
                    ),
                    notifications_defaults=notifications_dict_to_proto(
                        schema["notifications_defaults"]
                    ),
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting settings schema: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_default_profile(
        self,
        request: SetDefaultProfileRequest,
        ctx: RequestContext,
    ) -> SetDefaultProfileResponse:
        """
        Handle set_default_profile RPC call.

        Sets a profile as the default for the user.

        Parameters
        ----------
        request : SetDefaultProfileRequest
            The request with profile ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProfileResponse
            The updated profile.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            profile_id = UUID(request.profile_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid profile ID format")

        try:
            async with open_session() as session:
                ops = SettingsOperations(session)
                profile = await ops.set_default_profile(user_id, profile_id)
                return SetDefaultProfileResponse(profile=profile_to_proto(profile))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Profile not found")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error setting default profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
