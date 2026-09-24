"""Validation and storage of saved view definitions."""

import math
import re
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Any, NoReturn
from uuid import UUID

from loguru import logger
from protobuf import Oneof
from uniffy_proto.projects.v1.projects_pb import (
    BacklogLayout,
    BoardLayout,
    FilterLogic,
    GraphLayout,
    RelativeDateAnchor,
    ResourcesLayout,
    RoadmapLayout,
    RoadmapZoom,
    SortDirection,
    TableLayout,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterOperator,
    TaskFilterValue,
    TaskPseudoField,
    TaskSort,
    ViewDefinition,
)

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.task import TaskType
from uniffy.core.models.projects.view_config import ProjectViewType
from uniffy.domains.projects.validation import option_ids
from uniffy.domains.projects.views.catalog import (
    EMPTINESS_OPERATORS,
    FIELD_TYPE_KINDS,
    GROUPABLE_KINDS,
    ID_FLAGS,
    ID_KINDS,
    PSEUDO_FIELD_KINDS,
    SINGLE_ID_OPERATORS,
    SORTABLE_KINDS,
    UUID_ID_KINDS,
    FieldKind,
    IdFlag,
    operators_for,
)

logger = logger.bind(component="projects.views.definition")

MAX_FILTER_DEPTH = 3
MAX_FILTER_NODES = 50
MAX_IDS_PER_CONDITION = 100
MAX_TEXT_LENGTH = 500
MAX_SORT_KEYS = 5
MAX_VISIBLE_FIELDS = 100
MAX_COLUMN_WIDTHS = 100
MIN_COLUMN_WIDTH = 40
MAX_COLUMN_WIDTH = 2000
MAX_COLLAPSED_KEYS = 200
MAX_GROUP_KEY_LENGTH = 200
MAX_VIEW_NAME_LENGTH = 100
MAX_RELATIVE_OFFSET_DAYS = 3660

_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DIRECTIONS = frozenset({SortDirection.ASC, SortDirection.DESC})
_LOGICS = frozenset({FilterLogic.AND, FilterLogic.OR})
_ZOOMS = frozenset({
    RoadmapZoom.DAY,
    RoadmapZoom.WEEK,
    RoadmapZoom.MONTH,
})
_ANCHORS = frozenset(tuple(RelativeDateAnchor)) - {RelativeDateAnchor.UNSPECIFIED}
_TASK_TYPES = frozenset(TaskType)


class LayoutCase(StrEnum):
    TABLE = "table"
    BOARD = "board"
    ROADMAP = "roadmap"
    BACKLOG = "backlog"
    GRAPH = "graph"
    RESOURCES = "resources"


class RefCase(StrEnum):
    FIELD_ID = "field_id"
    PSEUDO = "pseudo"


class NodeCase(StrEnum):
    CONDITION = "condition"
    GROUP = "group"


class ValueCase(StrEnum):
    IDS = "ids"
    TEXT = "text"
    NUMBER = "number"
    NUMBER_RANGE = "number_range"
    DATE = "date"
    DATE_RANGE = "date_range"
    FLAG = "flag"


class DateCase(StrEnum):
    FIXED = "fixed"
    RELATIVE = "relative"


VIEW_TYPE_BY_LAYOUT: dict[LayoutCase, ProjectViewType] = {
    LayoutCase.TABLE: ProjectViewType.TABLE,
    LayoutCase.BOARD: ProjectViewType.BOARD,
    LayoutCase.ROADMAP: ProjectViewType.ROADMAP,
    LayoutCase.BACKLOG: ProjectViewType.BACKLOG,
    LayoutCase.GRAPH: ProjectViewType.GRAPH,
    LayoutCase.RESOURCES: ProjectViewType.RESOURCES,
}
LAYOUT_BY_VIEW_TYPE: dict[ProjectViewType, LayoutCase] = {
    view_type: case for case, view_type in VIEW_TYPE_BY_LAYOUT.items()
}


@dataclass(frozen=True)
class _ResolvedField:
    kind: FieldKind
    label: str
    field: FieldDefinition | None
    pseudo: TaskPseudoField | None


def _fail(message: str) -> NoReturn:
    raise ValidationError("definition", message)


def _enum_label(name: str, prefix: str) -> str:
    return name.removeprefix(prefix).lower().replace("_", " ")


def _operator_label(operator: TaskFilterOperator) -> str:
    return _enum_label(TaskFilterOperator(operator).name, "TASK_FILTER_OPERATOR_")


def _ref_key(ref: TaskFieldRef) -> tuple[str | None, str, int]:
    if ref.ref is None:
        return None, "", 0
    if ref.ref.field == RefCase.FIELD_ID:
        return ref.ref.field, ref.ref.value, 0
    return ref.ref.field, "", ref.ref.value


def view_type_for(definition: ViewDefinition) -> ProjectViewType:
    case = definition.layout.field if definition.layout is not None else None
    if case is None:
        raise ValidationError("definition", "A view needs a layout")
    return VIEW_TYPE_BY_LAYOUT[LayoutCase(case)]


def validate_view_name(name: str) -> str:
    stripped = name.strip()
    if not stripped:
        raise ValidationError("name", "A view needs a name")
    if len(stripped) > MAX_VIEW_NAME_LENGTH:
        raise ValidationError("name", f"View names are at most {MAX_VIEW_NAME_LENGTH} characters")
    return stripped


def _normalize_group(group: TaskFilterGroup) -> None:
    if group.logic == FilterLogic.UNSPECIFIED:
        group.logic = FilterLogic.AND
    for node in group.nodes:
        if (node.node.field if node.node is not None else None) == NodeCase.GROUP:
            _normalize_group(node.node.value)


def normalize_definition(definition: ViewDefinition) -> ViewDefinition:
    """Unset enums take their documented defaults so stored definitions never carry them."""
    normalized = deepcopy(definition)
    if normalized.has_field("filter"):
        _normalize_group(normalized.filter)
    for key in normalized.sort:
        if key.direction == SortDirection.UNSPECIFIED:
            key.direction = SortDirection.ASC
    if (
        normalized.has_field("group_by")
        and normalized.group_by.direction == SortDirection.UNSPECIFIED
    ):
        normalized.group_by.direction = SortDirection.ASC
    if (
        normalized.layout.field if normalized.layout is not None else None
    ) == LayoutCase.ROADMAP and normalized.layout.value.zoom == RoadmapZoom.UNSPECIFIED:
        normalized.layout.value.zoom = RoadmapZoom.WEEK
    return normalized


class _Validator:
    def __init__(self, fields: list[FieldDefinition], *, stored: bool = False) -> None:
        self.fields = {field.id: field for field in fields}
        self.node_count = 0
        # A stored view may name fields and options deleted since; those match nothing.
        self.stored = stored

    def resolve(self, ref: TaskFieldRef | None, where: str) -> _ResolvedField:
        if ref is None:
            _fail(f"{where}: select a field or task attribute")
        case = ref.ref.field if ref.ref is not None else None
        if case == RefCase.FIELD_ID:
            field = self.fields.get(ref.ref.value)
            kind = FIELD_TYPE_KINDS.get(ProjectFieldType(field.type)) if field else None
            if field is None or kind is None:
                raise ValidationError("definition", f"{where}: unknown field '{ref.ref.value}'")
            # The id rides along so a client can point at the offending condition.
            return _ResolvedField(kind, f"{field.name} ({field.id})", field, None)
        if case == RefCase.PSEUDO:
            kind = PSEUDO_FIELD_KINDS.get(ref.ref.value)
            if kind is None:
                raise ValidationError("definition", f"{where}: unknown task attribute")
            label = _enum_label(TaskPseudoField(ref.ref.value).name, "TASK_PSEUDO_FIELD_")
            return _ResolvedField(kind, label, None, ref.ref.value)
        raise ValidationError("definition", f"{where}: a field is required")

    def is_gone(self, ref: TaskFieldRef | None) -> bool:
        if ref is None:
            return False
        return (
            ref.ref.field if ref.ref is not None else None
        ) == RefCase.FIELD_ID and ref.ref.value not in self.fields

    def filter_group(self, group: TaskFilterGroup, path: str, depth: int) -> None:
        if depth > MAX_FILTER_DEPTH:
            _fail(f"Filter groups nest at most {MAX_FILTER_DEPTH} levels deep")
        if group.logic not in _LOGICS:
            _fail(f"Filter group {path or 'at the top'} has an unknown logic")
        for index, node in enumerate(group.nodes, start=1):
            self.node_count += 1
            if self.node_count > MAX_FILTER_NODES:
                _fail(f"A filter holds at most {MAX_FILTER_NODES} conditions and groups")
            where = f"{path}.{index}" if path else str(index)
            case = node.node.field if node.node is not None else None
            if case == NodeCase.CONDITION:
                self.condition(node.node.value, f"Filter condition {where}")
            elif case == NodeCase.GROUP:
                self.filter_group(node.node.value, where, depth + 1)
            else:
                _fail(f"Filter node {where} is empty")

    def condition(self, condition: TaskFilterCondition, where: str) -> None:
        if self.stored and self.is_gone(condition.field):
            return
        resolved = self.resolve(condition.field, where)
        operator = condition.operator
        label = resolved.label
        if operator not in operators_for(resolved.kind, resolved.pseudo):
            name = (
                _operator_label(operator)
                if operator in tuple(TaskFilterOperator)
                else "unknown operator"
            )
            _fail(f"{where}: '{label}' does not support '{name}'")
        if operator in EMPTINESS_OPERATORS:
            if condition.has_field("value"):
                _fail(f"{where}: '{label}' takes no value for '{_operator_label(operator)}'")
            return
        if not condition.has_field("value"):
            _fail(f"{where}: '{label}' needs a value")

        value = condition.value
        kind = resolved.kind
        if kind in ID_KINDS:
            self.id_value(resolved, operator, value, where)
        elif kind is FieldKind.TEXT:
            self.text_value(value, where, label)
        elif kind is FieldKind.NUMBER:
            self.number_value(operator, value, where, label)
        elif kind in (FieldKind.DATE, FieldKind.TIMESTAMP):
            self.date_condition_value(operator, value, where, label)
        elif (
            kind is FieldKind.BOOLEAN
            and (value.value.field if value.value is not None else None) != ValueCase.FLAG
        ):
            _fail(f"{where}: '{label}' needs yes or no")

    def id_value(
        self,
        resolved: _ResolvedField,
        operator: TaskFilterOperator,
        value: TaskFilterValue,
        where: str,
    ) -> None:
        label = resolved.label
        if (value.value.field if value.value is not None else None) != ValueCase.IDS:
            _fail(f"{where}: '{label}' needs a list of values")
        id_set = value.value.value
        flags = _id_flags(id_set)
        allowed = ID_FLAGS[resolved.kind]
        if flags - allowed:
            _fail(f"{where}: '{label}' does not accept {_flag_label(min(flags - allowed))}")
        if operator == TaskFilterOperator.IS_ALL_OF and IdFlag.EMPTY in flags:
            _fail(f"{where}: '{label}' cannot require an empty value alongside others")
        ids = list(id_set.ids)
        count = len(ids) + len(flags)
        if operator in SINGLE_ID_OPERATORS and count != 1:
            _fail(f"{where}: '{label}' needs exactly one value for '{_operator_label(operator)}'")
        if count == 0:
            _fail(f"{where}: '{label}' needs at least one value")
        if len(ids) > MAX_IDS_PER_CONDITION:
            _fail(f"{where}: '{label}' takes at most {MAX_IDS_PER_CONDITION} values")
        if len(set(ids)) != len(ids):
            _fail(f"{where}: '{label}' lists a value twice")

        kind = resolved.kind
        if (
            kind in (FieldKind.SINGLE_SELECT, FieldKind.MULTI_SELECT)
            and resolved.field
            and not self.stored
        ):
            known = option_ids(resolved.field.config or {})
            unknown = [option for option in ids if option not in known]
            if unknown:
                _fail(f"{where}: '{label}' has no option '{unknown[0]}'")
        elif kind is FieldKind.TASK_TYPE:
            unknown = [task_type for task_type in ids if task_type not in _TASK_TYPES]
            if unknown:
                _fail(f"{where}: '{unknown[0]}' is not a task type")
        elif kind in UUID_ID_KINDS:
            for raw in ids:
                try:
                    UUID(raw)
                except ValueError:
                    _fail(f"{where}: '{label}' has an invalid id '{raw}'")

    def text_value(self, value: TaskFilterValue, where: str, label: str) -> None:
        if (
            value.value.field if value.value is not None else None
        ) != ValueCase.TEXT or not value.value.value.strip():
            _fail(f"{where}: '{label}' needs text")
        if len(value.value.value) > MAX_TEXT_LENGTH:
            _fail(f"{where}: '{label}' text is at most {MAX_TEXT_LENGTH} characters")

    def number_value(
        self, operator: TaskFilterOperator, value: TaskFilterValue, where: str, label: str
    ) -> None:
        case = value.value.field if value.value is not None else None
        if operator == TaskFilterOperator.BETWEEN:
            if case != ValueCase.NUMBER_RANGE:
                _fail(f"{where}: '{label}' needs a number range")
            bounds = (value.value.value.min, value.value.value.max)
            if not all(math.isfinite(bound) for bound in bounds) or bounds[0] > bounds[1]:
                _fail(f"{where}: '{label}' needs a range whose start is not after its end")
            return
        if case != ValueCase.NUMBER or not math.isfinite(value.value.value):
            _fail(f"{where}: '{label}' needs a number")

    def date_condition_value(
        self, operator: TaskFilterOperator, value: TaskFilterValue, where: str, label: str
    ) -> None:
        case = value.value.field if value.value is not None else None
        if operator == TaskFilterOperator.BETWEEN:
            if case != ValueCase.DATE_RANGE:
                _fail(f"{where}: '{label}' needs a date range")
            start = self.date_value(value.value.value.start, where, label)
            end = self.date_value(value.value.value.end, where, label)
            if start and end and start > end:
                _fail(f"{where}: '{label}' needs a range whose start is not after its end")
            return
        if case != ValueCase.DATE:
            _fail(f"{where}: '{label}' needs a date")
        self.date_value(value.value.value, where, label)

    def date_value(self, value: TaskFilterDate | None, where: str, label: str) -> date | None:
        if value is None:
            _fail(f"{where}: '{label}' needs a date")
        case = value.value.field if value.value is not None else None
        if case == DateCase.FIXED:
            if not _DATE_PATTERN.match(value.value.value):
                _fail(f"{where}: '{label}' needs a date as YYYY-MM-DD")
            try:
                return date.fromisoformat(value.value.value)
            except ValueError:
                _fail(f"{where}: '{value.value.value}' is not a calendar date")
        if case == DateCase.RELATIVE:
            if value.value.value.anchor not in _ANCHORS:
                _fail(f"{where}: '{label}' has a relative date without an anchor")
            if abs(value.value.value.offset_days) > MAX_RELATIVE_OFFSET_DAYS:
                _fail(f"{where}: '{label}' offsets at most {MAX_RELATIVE_OFFSET_DAYS} days")
            return None
        _fail(f"{where}: '{label}' needs a date")

    def sort(self, keys: Sequence[TaskSort]) -> None:
        if len(keys) > MAX_SORT_KEYS:
            _fail(f"A view sorts by at most {MAX_SORT_KEYS} fields")
        seen: set[tuple[str | None, str, int]] = set()
        for index, key in enumerate(keys, start=1):
            where = f"Sort key {index}"
            resolved = self.resolve(key.field, where)
            if resolved.kind not in SORTABLE_KINDS:
                _fail(f"{where}: cannot sort by '{resolved.label}'")
            if _ref_key(key.field) in seen:
                _fail(f"{where}: '{resolved.label}' is already a sort key")
            seen.add(_ref_key(key.field))
            if key.direction not in _DIRECTIONS:
                _fail(f"{where}: unknown direction")

    def group_by(self, definition: ViewDefinition) -> None:
        if not definition.has_field("group_by"):
            return
        resolved = self.resolve(definition.group_by.field, "Group by")
        if resolved.kind not in GROUPABLE_KINDS:
            _fail(f"Group by: cannot group by '{resolved.label}'")
        if definition.group_by.direction not in _DIRECTIONS:
            _fail("Group by: unknown direction")

    def columns(self, definition: ViewDefinition) -> None:
        if len(definition.visible_fields) > MAX_VISIBLE_FIELDS:
            _fail(f"A view shows at most {MAX_VISIBLE_FIELDS} fields")
        seen: set[tuple[str | None, str, int]] = set()
        for index, ref in enumerate(definition.visible_fields, start=1):
            resolved = self.resolve(ref, f"Visible field {index}")
            if _ref_key(ref) in seen:
                _fail(f"Visible field {index}: '{resolved.label}' is listed twice")
            seen.add(_ref_key(ref))

        if len(definition.column_widths) > MAX_COLUMN_WIDTHS:
            _fail(f"A view sizes at most {MAX_COLUMN_WIDTHS} columns")
        sized: set[tuple[str | None, str, int]] = set()
        for index, column in enumerate(definition.column_widths, start=1):
            resolved = self.resolve(column.field, f"Column width {index}")
            if _ref_key(column.field) in sized:
                _fail(f"Column width {index}: '{resolved.label}' is sized twice")
            sized.add(_ref_key(column.field))
            if not MIN_COLUMN_WIDTH <= column.width <= MAX_COLUMN_WIDTH:
                _fail(
                    f"Column width {index}: '{resolved.label}' must be between "
                    f"{MIN_COLUMN_WIDTH} and {MAX_COLUMN_WIDTH} pixels"
                )

        if len(definition.collapsed_group_keys) > MAX_COLLAPSED_KEYS:
            _fail(f"A view collapses at most {MAX_COLLAPSED_KEYS} groups")
        if any(len(key) > MAX_GROUP_KEY_LENGTH for key in definition.collapsed_group_keys):
            _fail(f"Collapsed group keys are at most {MAX_GROUP_KEY_LENGTH} characters")

    def layout(self, definition: ViewDefinition) -> None:
        case = definition.layout.field if definition.layout is not None else None
        if case == LayoutCase.BOARD and definition.layout.value.column_field_id:
            field = self.fields.get(definition.layout.value.column_field_id)
            if field is None or ProjectFieldType(field.type) is not ProjectFieldType.SINGLE_SELECT:
                _fail("Board columns need a single-select field of this project")
        if case == LayoutCase.ROADMAP and definition.layout.value.zoom not in _ZOOMS:
            _fail("Roadmap zoom is unknown")


def _id_flags(id_set: TaskFilterIdSet) -> set[IdFlag]:
    flags: set[IdFlag] = set()
    if id_set.include_current_user:
        flags.add(IdFlag.CURRENT_USER)
    if id_set.include_empty:
        flags.add(IdFlag.EMPTY)
    if id_set.include_active_sprint:
        flags.add(IdFlag.ACTIVE_SPRINT)
    return flags


def _flag_label(flag: IdFlag) -> str:
    return {
        IdFlag.CURRENT_USER: "the current user",
        IdFlag.EMPTY: "an empty value",
        IdFlag.ACTIVE_SPRINT: "the active sprint",
    }[flag]


def validate_definition(definition: ViewDefinition, fields: list[FieldDefinition]) -> None:
    """Rejects anything the evaluators could not apply to this project's fields."""
    view_type_for(definition)
    validator = _Validator(fields)
    validator.layout(definition)
    if definition.has_field("filter"):
        validator.filter_group(definition.filter, "", 1)
    validator.sort(definition.sort)
    validator.group_by(definition)
    validator.columns(definition)


def validate_task_filter(
    task_filter: TaskFilterGroup, fields: list[FieldDefinition], *, stored: bool = False
) -> TaskFilterGroup:
    """A task list's filter, held to the rules a saved view's is; ``stored`` for a saved view's
    own filter, which may name fields and options deleted since it was saved.
    """
    normalized = deepcopy(task_filter)
    _normalize_group(normalized)
    try:
        _Validator(fields, stored=stored).filter_group(normalized, "", 1)
    except ValidationError as exc:
        raise ValidationError("query", exc.message) from None
    return normalized


def validate_task_sort(
    sort: Sequence[TaskSort], fields: list[FieldDefinition], *, stored: bool = False
) -> list[TaskSort]:
    """A task list's sort keys; ``stored`` drops keys on fields deleted since, as the web does."""
    validator = _Validator(fields, stored=stored)
    keys = []
    for key in sort:
        if stored and validator.is_gone(key.field):
            continue
        normalized = deepcopy(key)
        if normalized.direction == SortDirection.UNSPECIFIED:
            normalized.direction = SortDirection.ASC
        keys.append(normalized)
    try:
        validator.sort(keys)
    except ValidationError as exc:
        raise ValidationError("query", exc.message) from None
    return keys


def prepare_definition(
    definition: ViewDefinition, fields: list[FieldDefinition]
) -> tuple[ViewDefinition, ProjectViewType]:
    normalized = normalize_definition(definition)
    validate_definition(normalized, fields)
    return normalized, view_type_for(normalized)


def layout_only_definition(view_type: ProjectViewType) -> ViewDefinition:
    match view_type:
        case ProjectViewType.TABLE:
            return ViewDefinition(layout=Oneof(field="table", value=TableLayout()))
        case ProjectViewType.BOARD:
            return ViewDefinition(layout=Oneof(field="board", value=BoardLayout()))
        case ProjectViewType.ROADMAP:
            return ViewDefinition(layout=Oneof(field="roadmap", value=RoadmapLayout()))
        case ProjectViewType.BACKLOG:
            return ViewDefinition(layout=Oneof(field="backlog", value=BacklogLayout()))
        case ProjectViewType.GRAPH:
            return ViewDefinition(layout=Oneof(field="graph", value=GraphLayout()))
        case ProjectViewType.RESOURCES:
            return ViewDefinition(layout=Oneof(field="resources", value=ResourcesLayout()))
    raise ValidationError("definition", "Unknown view layout")


def definition_to_dict(definition: ViewDefinition) -> dict[str, Any]:
    return loads(definition.to_json(use_proto_field_name=True))


def definition_from_dict(data: dict[str, Any], view_type: ProjectViewType) -> ViewDefinition:
    """A stored definition that no longer parses degrades to its bare layout."""
    try:
        definition = ViewDefinition.from_json(dumps_bytes(data), ignore_unknown_fields=True)
    except ValueError:
        logger.opt(exception=True).warning(
            "Stored view definition does not parse", view_type=str(view_type)
        )
        return layout_only_definition(view_type)
    if (definition.layout.field if definition.layout is not None else None) is None:
        return layout_only_definition(view_type)
    return definition
