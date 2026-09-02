"""Agent cron tasks service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.cron.handlers import CronHandlers


class CronServiceImpl(CronHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
