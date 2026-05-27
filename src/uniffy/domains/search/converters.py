from uniffy_proto.search.v1.search_pb2 import (
    SearchResultItem,
    SearchResultType,
    UrnMetadata,
)

from uniffy.domains.search.queries import SearchResult

ENTITY_TYPE_TO_PROTO: dict[str, SearchResultType] = {
    "note": SearchResultType.SEARCH_RESULT_TYPE_NOTE,
    "file": SearchResultType.SEARCH_RESULT_TYPE_FILE,
    "chat": SearchResultType.SEARCH_RESULT_TYPE_CHAT,
    "user": SearchResultType.SEARCH_RESULT_TYPE_USER,
    "calendar_event": SearchResultType.SEARCH_RESULT_TYPE_CALENDAR_EVENT,
    "project": SearchResultType.SEARCH_RESULT_TYPE_PROJECT,
    "task": SearchResultType.SEARCH_RESULT_TYPE_TASK,
    "agent": SearchResultType.SEARCH_RESULT_TYPE_AGENT,
    "prompt": SearchResultType.SEARCH_RESULT_TYPE_PROMPT,
    "chat_message": SearchResultType.SEARCH_RESULT_TYPE_CHAT_MESSAGE,
    "room": SearchResultType.SEARCH_RESULT_TYPE_ROOM,
    "agent_chat": SearchResultType.SEARCH_RESULT_TYPE_AGENT_CHAT,
    "tag": SearchResultType.SEARCH_RESULT_TYPE_TAG,
}

PROTO_TO_ENTITY_TYPE: dict[SearchResultType, str] = {v: k for k, v in ENTITY_TYPE_TO_PROTO.items()}


def entity_type_to_proto(entity_type: str) -> SearchResultType:
    return ENTITY_TYPE_TO_PROTO.get(
        entity_type.lower(),
        SearchResultType.SEARCH_RESULT_TYPE_UNSPECIFIED,
    )


def proto_to_entity_type(proto_type: SearchResultType) -> str | None:
    if proto_type == SearchResultType.SEARCH_RESULT_TYPE_UNSPECIFIED:
        return None
    return PROTO_TO_ENTITY_TYPE.get(proto_type)


def search_result_to_proto(
    item: SearchResult,
    score: float | None = None,
) -> SearchResultItem:
    final_score = score if score is not None else (item.search_score or 0.0)

    return SearchResultItem(
        urn=item.urn,
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        score=final_score,
        metadata=item.metadata or {},
        tags=item.tags or [],
    )


def search_result_to_urn_metadata(item: SearchResult) -> UrnMetadata:
    metadata = dict(item.metadata) if item.metadata else {}

    # urn_status marks a tombstone synthesized by resolve_urns for a missing URN -
    # the frontend renders this as a deleted-state chip.
    if item.urn_status:
        metadata["urn_status"] = item.urn_status

    if item.updated_at:
        metadata["updated_at"] = item.updated_at.isoformat()

    if item.status:
        metadata["status"] = item.status
    if item.due_date:
        metadata["due_date"] = item.due_date
    if item.assignee_name:
        metadata["assignee_name"] = item.assignee_name
    if item.processing_status:
        metadata["processing_status"] = item.processing_status
    if item.completed_tasks:
        metadata["completed_tasks"] = str(item.completed_tasks)
    if item.total_tasks:
        metadata["total_tasks"] = str(item.total_tasks)
    if item.member_count:
        metadata["member_count"] = str(item.member_count)
    if item.updated_by_name:
        metadata["updated_by_name"] = item.updated_by_name

    if item.priority:
        metadata["priority"] = item.priority
    if item.priority_label:
        metadata["priority_label"] = item.priority_label
    if item.priority_color:
        metadata["priority_color"] = item.priority_color
    if item.status_label:
        metadata["status_label"] = item.status_label
    if item.status_color:
        metadata["status_color"] = item.status_color
    if item.task_type:
        metadata["task_type"] = item.task_type
    if item.task_number:
        metadata["task_number"] = str(item.task_number)
    if item.project_name:
        metadata["project_name"] = item.project_name
    if item.project_slug:
        metadata["project_slug"] = item.project_slug
    if item.project_color:
        metadata["project_color"] = item.project_color
    if item.subtask_completed:
        metadata["subtask_completed"] = str(item.subtask_completed)
    if item.subtask_total:
        metadata["subtask_total"] = str(item.subtask_total)
    if item.blocked_by_count:
        metadata["blocked_by_count"] = str(item.blocked_by_count)
    if item.assignee_ids:
        metadata["assignee_ids"] = ",".join(item.assignee_ids)
    if item.event_start_time:
        metadata["start_time"] = item.event_start_time
    if item.event_end_time:
        metadata["end_time"] = item.event_end_time
    if item.event_is_all_day:
        metadata["is_all_day"] = "true"
    if item.event_location:
        metadata["location"] = item.event_location
    if item.event_meeting_url:
        metadata["meeting_url"] = item.event_meeting_url
    if item.file_mime_type:
        metadata["mime_type"] = item.file_mime_type
    if item.file_size:
        metadata["file_size"] = str(item.file_size)
    if item.note_node_type:
        metadata["node_type"] = item.note_node_type
    if item.channel_type:
        metadata["channel_type"] = item.channel_type
    if item.agent_emoji:
        metadata["agent_emoji"] = item.agent_emoji
    if item.agent_theme_color:
        metadata["agent_theme_color"] = item.agent_theme_color
    if item.user_avatar_url:
        metadata["user_avatar_url"] = item.user_avatar_url
    if item.user_email:
        metadata["user_email"] = item.user_email

    return UrnMetadata(
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        metadata=metadata,
        priority=item.priority or "",
        priority_label=item.priority_label or "",
        priority_color=item.priority_color or "",
        status_label=item.status_label or "",
        status_color=item.status_color or "",
        task_type=item.task_type or "",
        task_number=item.task_number,
        project_name=item.project_name or "",
        project_slug=item.project_slug or "",
        project_color=item.project_color or "",
        subtask_completed=item.subtask_completed,
        subtask_total=item.subtask_total,
        blocked_by_count=item.blocked_by_count,
        event_start_time=item.event_start_time or "",
        event_end_time=item.event_end_time or "",
        event_is_all_day=item.event_is_all_day,
        event_location=item.event_location or "",
        event_meeting_url=item.event_meeting_url or "",
        file_mime_type=item.file_mime_type or "",
        file_size=item.file_size,
        note_node_type=item.note_node_type or "",
        channel_type=item.channel_type or "",
        agent_emoji=item.agent_emoji or "",
        agent_theme_color=item.agent_theme_color or "",
        user_avatar_url=item.user_avatar_url or "",
        user_email=item.user_email or "",
        assignee_ids=item.assignee_ids or [],
        content_tags=item.content_tags or [],
    )
