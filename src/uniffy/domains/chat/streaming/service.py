"""Chat stream service wrapper for ConnectRPC mounting."""

from uniffy.domains.chat.streaming.handlers import ChatStreamHandlers


class ChatStreamServiceImpl(ChatStreamHandlers):
    """Chat stream service mounted with StreamDisconnectMiddleware."""

    pass
