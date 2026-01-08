import random as py_random

from uwos.gen.randomnum.v1.random_pb2 import GetRandomNumberRequest, GetRandomNumberResponse
from connectrpc.request import RequestContext


class RandomServiceImpl:
    """Implementation of the RandomService."""

    async def get_random_number(
        self, request: GetRandomNumberRequest, ctx: RequestContext
    ) -> GetRandomNumberResponse:
        """Generate and return a random number."""
        min_val = request.min if request.min else 0
        max_val = request.max if request.max else 100

        # Generate random number
        value = py_random.randint(min_val, max_val)

        return GetRandomNumberResponse(value=value)
