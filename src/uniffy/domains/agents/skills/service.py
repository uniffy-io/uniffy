"""Agent skills service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.skills.handlers import SkillsHandlers


class SkillsServiceImpl(SkillsHandlers):
    """Combined skills service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
