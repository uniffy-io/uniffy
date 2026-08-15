"""Stable identifiers for tasks registered from this package."""

from enum import StrEnum


class JobName(StrEnum):
    GENERATE_IMAGE_THUMBNAIL = "generate_image_thumbnail"
    GENERATE_PDF_THUMBNAIL = "generate_pdf_thumbnail"
    GENERATE_VIDEO_THUMBNAIL = "generate_video_thumbnail"
    TRANSCODE_VIDEO_TO_MP4 = "transcode_video_to_mp4"
    DELETE_S3_OBJECT = "delete_s3_object"
    EXTRACT_IMAGE_METADATA = "extract_image_metadata"
    EXTRACT_AUDIO_METADATA = "extract_audio_metadata"
    EXTRACT_DOCUMENT_CONTENT = "extract_document_content"
    PROCESS_NOTIFICATION_EVENT = "process_notification_event"
    DELIVER_PUSH_NOTIFICATION = "deliver_push_notification"
    SEND_EMAIL = "send_email"
    SEND_EMAIL_DIGEST = "send_email_digest"
    REINDEX_TAG_URNS = "reindex_tag_urns"
    REINDEX_TAG_DOC = "reindex_tag_doc"
    REAP_EXPIRED_MULTIPART_UPLOADS = "reap_expired_multipart_uploads"
    REINDEX_ORG_CONTENT_FOR_DEFAULTS = "reindex_org_content_for_defaults"
    SAVE_REALTIME_SNAPSHOT = "save_realtime_snapshot"
    FLUSH_SEARCH_REMOVALS = "flush_search_removals"
    REFRESH_CHAT_SEARCH_ACL = "refresh_chat_search_acl"
    RESPOND_TO_CHAT_MESSAGE = "respond_to_chat_message"
    COMPACT_SESSION = "compact_session"
    ANALYZE_SESSION_FOR_SKILLS = "analyze_session_for_skills"
    EXECUTE_SINGLE_AGENT_CRON_TASK = "execute_single_agent_cron_task"
    RUN_AGENT_SESSION = "run_agent_session"
    DELETE_RUN_STREAM = "delete_run_stream"
    SYNC_IDENTITY_SOURCE = "sync_identity_source"


class SkillAnalysisDestination(StrEnum):
    SESSION = "session"
    CHANNEL = "channel"


__all__ = ["JobName", "SkillAnalysisDestination"]
