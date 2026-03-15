"""Agent cron tasks service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.cron.handlers import CronHandlers


class CronServiceImpl(CronHandlers):
    """Combined cron service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
