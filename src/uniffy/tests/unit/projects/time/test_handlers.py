"""Request parsing that the generated oneof shape makes easy to get wrong."""

from uuid import uuid4

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from protobuf import Oneof
from uniffy_proto.projects.v1.time_pb import AggregateWorklogsRequest

from uniffy.domains.projects.time.handlers import parse_aggregate_scope


def test_project_scope_comes_out_of_the_oneof() -> None:
    project_id = uuid4()
    request = AggregateWorklogsRequest(scope=Oneof(field="project_id", value=str(project_id)))
    assert parse_aggregate_scope(request) == (project_id, None)


def test_user_scope_comes_out_of_the_oneof() -> None:
    user_id = uuid4()
    request = AggregateWorklogsRequest(scope=Oneof(field="user_id", value=str(user_id)))
    assert parse_aggregate_scope(request) == (None, user_id)


def test_missing_scope_is_an_invalid_argument() -> None:
    with pytest.raises(ConnectError) as excinfo:
        parse_aggregate_scope(AggregateWorklogsRequest())
    assert excinfo.value.code is Code.INVALID_ARGUMENT


def test_malformed_scope_id_is_an_invalid_argument() -> None:
    request = AggregateWorklogsRequest(scope=Oneof(field="project_id", value="not-a-uuid"))
    with pytest.raises(ConnectError) as excinfo:
        parse_aggregate_scope(request)
    assert excinfo.value.code is Code.INVALID_ARGUMENT
