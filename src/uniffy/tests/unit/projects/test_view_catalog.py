"""The view catalog RPC serves exactly the rules the definition validator applies."""

from uniffy_proto.projects.v1.projects_pb import (
    FieldType,
    TaskFilterOperator,
    TaskPseudoField,
    ViewIdFlag,
)

from uniffy.domains.projects.views.catalog import PSEUDO_FIELD_KINDS
from uniffy.domains.projects.views.definition import MAX_FILTER_DEPTH, MAX_FILTER_NODES
from uniffy.domains.projects.views.handlers import view_catalog

_OP = TaskFilterOperator


def _field_type(field_type: FieldType):
    return next(
        entry.capabilities for entry in view_catalog().field_types if entry.type == field_type
    )


def _pseudo(pseudo: TaskPseudoField):
    return next(
        entry.capabilities for entry in view_catalog().pseudo_fields if entry.pseudo == pseudo
    )


def test_every_custom_field_type_and_task_attribute_is_listed() -> None:
    catalog = view_catalog()
    assert {entry.type for entry in catalog.field_types} == set(FieldType) - {
        FieldType.UNSPECIFIED
    }
    assert {entry.pseudo for entry in catalog.pseudo_fields} == set(PSEUDO_FIELD_KINDS)


def test_person_fields_take_the_single_and_multi_value_operators_and_me() -> None:
    person = _field_type(FieldType.PERSON)
    assert set(person.operators) == {
        _OP.IS,
        _OP.IS_NOT,
        _OP.IS_ANY_OF,
        _OP.IS_NONE_OF,
        _OP.IS_ALL_OF,
        _OP.IS_EMPTY,
        _OP.IS_NOT_EMPTY,
    }
    assert set(person.id_flags) == {ViewIdFlag.CURRENT_USER, ViewIdFlag.EMPTY}
    assert person.sortable
    assert person.groupable


def test_an_attribute_every_task_has_offers_no_emptiness_operators() -> None:
    creator = _pseudo(TaskPseudoField.CREATOR)
    assert _OP.IS_EMPTY not in creator.operators
    assert _OP.IS_NOT_EMPTY not in creator.operators
    assert list(creator.id_flags) == [ViewIdFlag.CURRENT_USER]
    assert _OP.IS_EMPTY in _pseudo(TaskPseudoField.COMPLETED_AT).operators


def test_sprint_takes_the_active_sprint_and_booleans_only_is() -> None:
    assert set(_pseudo(TaskPseudoField.SPRINT).id_flags) == {
        ViewIdFlag.ACTIVE_SPRINT,
        ViewIdFlag.EMPTY,
    }
    blocked = _pseudo(TaskPseudoField.IS_BLOCKED)
    assert list(blocked.operators) == [_OP.IS]
    assert blocked.sortable
    assert blocked.groupable


def test_references_only_filter_on_emptiness_and_neither_sort_nor_group() -> None:
    reference = _field_type(FieldType.REFERENCE)
    assert set(reference.operators) == {_OP.IS_EMPTY, _OP.IS_NOT_EMPTY}
    assert not reference.sortable
    assert not reference.groupable


def test_limits_match_the_validator() -> None:
    limits = view_catalog().filter_limits
    assert limits.max_depth == MAX_FILTER_DEPTH
    assert limits.max_nodes == MAX_FILTER_NODES
