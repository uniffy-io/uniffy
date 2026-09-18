"""What each field a view references can be filtered, sorted and grouped by."""

from enum import StrEnum

from uniffy_proto.projects.v1.projects_pb2 import TaskFilterOperator, TaskPseudoField

from uniffy.core.models.projects.field_definition import ProjectFieldType


class FieldKind(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    SINGLE_SELECT = "single_select"
    MULTI_SELECT = "multi_select"
    DATE = "date"
    TIMESTAMP = "timestamp"
    PERSON = "person"
    SINGLE_PERSON = "single_person"
    TAGS = "tags"
    SPRINT = "sprint"
    TASK_TYPE = "task_type"
    TASK_REF = "task_ref"
    TASK_REF_SET = "task_ref_set"
    EPIC = "epic"
    BOOLEAN = "boolean"
    REFERENCE = "reference"


class IdFlag(StrEnum):
    CURRENT_USER = "include_current_user"
    EMPTY = "include_empty"
    ACTIVE_SPRINT = "include_active_sprint"


Operator = TaskFilterOperator
PseudoField = TaskPseudoField

FIELD_TYPE_KINDS: dict[ProjectFieldType, FieldKind] = {
    ProjectFieldType.TEXT: FieldKind.TEXT,
    ProjectFieldType.NUMBER: FieldKind.NUMBER,
    ProjectFieldType.SINGLE_SELECT: FieldKind.SINGLE_SELECT,
    ProjectFieldType.MULTI_SELECT: FieldKind.MULTI_SELECT,
    ProjectFieldType.DATE: FieldKind.DATE,
    ProjectFieldType.PERSON: FieldKind.PERSON,
    ProjectFieldType.REFERENCE: FieldKind.REFERENCE,
}

PSEUDO_FIELD_KINDS: dict[PseudoField, FieldKind] = {
    TaskPseudoField.TASK_PSEUDO_FIELD_TAGS: FieldKind.TAGS,
    TaskPseudoField.TASK_PSEUDO_FIELD_SPRINT: FieldKind.SPRINT,
    TaskPseudoField.TASK_PSEUDO_FIELD_TASK_TYPE: FieldKind.TASK_TYPE,
    TaskPseudoField.TASK_PSEUDO_FIELD_CREATOR: FieldKind.SINGLE_PERSON,
    TaskPseudoField.TASK_PSEUDO_FIELD_PARENT: FieldKind.TASK_REF,
    TaskPseudoField.TASK_PSEUDO_FIELD_EPIC: FieldKind.EPIC,
    TaskPseudoField.TASK_PSEUDO_FIELD_HAS_SUBTASKS: FieldKind.BOOLEAN,
    TaskPseudoField.TASK_PSEUDO_FIELD_DEPTH: FieldKind.NUMBER,
    TaskPseudoField.TASK_PSEUDO_FIELD_IS_MILESTONE: FieldKind.BOOLEAN,
    # Same rule as TaskValidator.blockers_resolved: incomplete with a live incomplete blocker.
    TaskPseudoField.TASK_PSEUDO_FIELD_IS_BLOCKED: FieldKind.BOOLEAN,
    TaskPseudoField.TASK_PSEUDO_FIELD_BLOCKED_BY: FieldKind.TASK_REF_SET,
    TaskPseudoField.TASK_PSEUDO_FIELD_CREATED_AT: FieldKind.TIMESTAMP,
    TaskPseudoField.TASK_PSEUDO_FIELD_UPDATED_AT: FieldKind.TIMESTAMP,
    TaskPseudoField.TASK_PSEUDO_FIELD_COMPLETED_AT: FieldKind.TIMESTAMP,
    TaskPseudoField.TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: FieldKind.NUMBER,
    TaskPseudoField.TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: FieldKind.NUMBER,
    TaskPseudoField.TASK_PSEUDO_FIELD_NUMBER: FieldKind.NUMBER,
}

NEVER_EMPTY_PSEUDO_FIELDS: frozenset[PseudoField] = frozenset({
    TaskPseudoField.TASK_PSEUDO_FIELD_TASK_TYPE,
    TaskPseudoField.TASK_PSEUDO_FIELD_CREATOR,
    TaskPseudoField.TASK_PSEUDO_FIELD_DEPTH,
    TaskPseudoField.TASK_PSEUDO_FIELD_CREATED_AT,
    TaskPseudoField.TASK_PSEUDO_FIELD_UPDATED_AT,
    TaskPseudoField.TASK_PSEUDO_FIELD_NUMBER,
})

_OP = TaskFilterOperator
EMPTINESS_OPERATORS: frozenset[Operator] = frozenset({
    _OP.TASK_FILTER_OPERATOR_IS_EMPTY,
    _OP.TASK_FILTER_OPERATOR_IS_NOT_EMPTY,
})
ID_OPERATORS: frozenset[Operator] = frozenset({
    _OP.TASK_FILTER_OPERATOR_IS,
    _OP.TASK_FILTER_OPERATOR_IS_NOT,
    _OP.TASK_FILTER_OPERATOR_IS_ANY_OF,
    _OP.TASK_FILTER_OPERATOR_IS_NONE_OF,
    _OP.TASK_FILTER_OPERATOR_IS_ALL_OF,
})
SINGLE_ID_OPERATORS: frozenset[Operator] = frozenset({
    _OP.TASK_FILTER_OPERATOR_IS,
    _OP.TASK_FILTER_OPERATOR_IS_NOT,
})
DATE_COMPARISON_OPERATORS: frozenset[Operator] = frozenset({
    _OP.TASK_FILTER_OPERATOR_IS,
    _OP.TASK_FILTER_OPERATOR_BEFORE,
    _OP.TASK_FILTER_OPERATOR_AFTER,
    _OP.TASK_FILTER_OPERATOR_ON_OR_BEFORE,
    _OP.TASK_FILTER_OPERATOR_ON_OR_AFTER,
})

_SINGLE_ID_SET = (
    frozenset({
        _OP.TASK_FILTER_OPERATOR_IS,
        _OP.TASK_FILTER_OPERATOR_IS_NOT,
        _OP.TASK_FILTER_OPERATOR_IS_ANY_OF,
        _OP.TASK_FILTER_OPERATOR_IS_NONE_OF,
    })
    | EMPTINESS_OPERATORS
)
_MULTI_ID_SET = (
    frozenset({
        _OP.TASK_FILTER_OPERATOR_IS_ANY_OF,
        _OP.TASK_FILTER_OPERATOR_IS_ALL_OF,
        _OP.TASK_FILTER_OPERATOR_IS_NONE_OF,
    })
    | EMPTINESS_OPERATORS
)
_DATE_SET = (
    DATE_COMPARISON_OPERATORS | frozenset({_OP.TASK_FILTER_OPERATOR_BETWEEN}) | EMPTINESS_OPERATORS
)

OPERATORS: dict[FieldKind, frozenset[Operator]] = {
    FieldKind.TEXT: frozenset({
        _OP.TASK_FILTER_OPERATOR_CONTAINS,
        _OP.TASK_FILTER_OPERATOR_NOT_CONTAINS,
        _OP.TASK_FILTER_OPERATOR_IS,
        _OP.TASK_FILTER_OPERATOR_IS_NOT,
    })
    | EMPTINESS_OPERATORS,
    FieldKind.NUMBER: frozenset({
        _OP.TASK_FILTER_OPERATOR_IS,
        _OP.TASK_FILTER_OPERATOR_IS_NOT,
        _OP.TASK_FILTER_OPERATOR_GREATER_THAN,
        _OP.TASK_FILTER_OPERATOR_LESS_THAN,
        _OP.TASK_FILTER_OPERATOR_BETWEEN,
    })
    | EMPTINESS_OPERATORS,
    FieldKind.SINGLE_SELECT: _SINGLE_ID_SET,
    FieldKind.TASK_TYPE: _SINGLE_ID_SET,
    FieldKind.SPRINT: _SINGLE_ID_SET,
    FieldKind.TASK_REF: _SINGLE_ID_SET,
    FieldKind.EPIC: _SINGLE_ID_SET,
    FieldKind.SINGLE_PERSON: _SINGLE_ID_SET,
    FieldKind.MULTI_SELECT: _MULTI_ID_SET,
    FieldKind.TAGS: _MULTI_ID_SET,
    FieldKind.TASK_REF_SET: _MULTI_ID_SET,
    FieldKind.PERSON: _SINGLE_ID_SET | _MULTI_ID_SET,
    FieldKind.DATE: _DATE_SET,
    FieldKind.TIMESTAMP: _DATE_SET,
    FieldKind.BOOLEAN: frozenset({_OP.TASK_FILTER_OPERATOR_IS}),
    FieldKind.REFERENCE: EMPTINESS_OPERATORS,
}

ID_KINDS: frozenset[FieldKind] = frozenset({
    FieldKind.SINGLE_SELECT,
    FieldKind.MULTI_SELECT,
    FieldKind.PERSON,
    FieldKind.SINGLE_PERSON,
    FieldKind.TAGS,
    FieldKind.SPRINT,
    FieldKind.TASK_TYPE,
    FieldKind.TASK_REF,
    FieldKind.TASK_REF_SET,
    FieldKind.EPIC,
})

# Kinds whose ids are row ids; select options and task types are checked against their vocabulary.
UUID_ID_KINDS: frozenset[FieldKind] = frozenset({
    FieldKind.PERSON,
    FieldKind.SINGLE_PERSON,
    FieldKind.TAGS,
    FieldKind.SPRINT,
    FieldKind.TASK_REF,
    FieldKind.TASK_REF_SET,
    FieldKind.EPIC,
})

ID_FLAGS: dict[FieldKind, frozenset[IdFlag]] = {
    FieldKind.SINGLE_SELECT: frozenset({IdFlag.EMPTY}),
    FieldKind.MULTI_SELECT: frozenset({IdFlag.EMPTY}),
    FieldKind.PERSON: frozenset({IdFlag.CURRENT_USER, IdFlag.EMPTY}),
    FieldKind.SINGLE_PERSON: frozenset({IdFlag.CURRENT_USER}),
    FieldKind.TAGS: frozenset({IdFlag.EMPTY}),
    FieldKind.SPRINT: frozenset({IdFlag.ACTIVE_SPRINT, IdFlag.EMPTY}),
    FieldKind.TASK_TYPE: frozenset(),
    FieldKind.TASK_REF: frozenset({IdFlag.EMPTY}),
    FieldKind.TASK_REF_SET: frozenset({IdFlag.EMPTY}),
    FieldKind.EPIC: frozenset({IdFlag.EMPTY}),
}

SORTABLE_KINDS: frozenset[FieldKind] = frozenset({
    FieldKind.TEXT,
    FieldKind.NUMBER,
    FieldKind.SINGLE_SELECT,
    FieldKind.DATE,
    FieldKind.TIMESTAMP,
    FieldKind.PERSON,
    FieldKind.SINGLE_PERSON,
    FieldKind.SPRINT,
    FieldKind.TASK_TYPE,
    FieldKind.BOOLEAN,
})

GROUPABLE_KINDS: frozenset[FieldKind] = frozenset({
    FieldKind.SINGLE_SELECT,
    FieldKind.MULTI_SELECT,
    FieldKind.PERSON,
    FieldKind.SINGLE_PERSON,
    FieldKind.TAGS,
    FieldKind.SPRINT,
    FieldKind.TASK_TYPE,
    FieldKind.DATE,
    FieldKind.TIMESTAMP,
    FieldKind.BOOLEAN,
    FieldKind.EPIC,
})


def operators_for(kind: FieldKind, pseudo: PseudoField | None) -> frozenset[Operator]:
    operators = OPERATORS[kind]
    if pseudo in NEVER_EMPTY_PSEUDO_FIELDS:
        return operators - EMPTINESS_OPERATORS
    return operators
