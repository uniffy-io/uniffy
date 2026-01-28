"""Settings service wrapper for ConnectRPC mounting."""

from uniffy.domains.settings.handlers import SettingsHandlers


class SettingsServiceImpl(SettingsHandlers):
    """
    Combined settings service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
