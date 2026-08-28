"""Agents RateLimitsService wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.limits.handlers import RateLimitsHandlers


class RateLimitsServiceImpl(RateLimitsHandlers):
    """Combined rate-limits service implementation."""

    pass
