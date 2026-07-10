"""Background task implementations split by worker fleet.

``CORE_TASKS`` runs on the ``core`` queue (local I/O, tight SLA).
``EGRESS_TASKS`` runs on the ``egress`` queue (LLM calls, slow external
APIs). The two fleets share lifecycle hooks but never share queues.
"""

from uniffy.domains.chat.read_state.flush import flush_chat_read_cursors
from uniffy.workers.tasks.agent_chat import respond_to_chat_message
from uniffy.workers.tasks.agent_compaction import compact_session
from uniffy.workers.tasks.agent_cron import (
    execute_agent_cron_tasks,
    execute_single_agent_cron_task,
)
from uniffy.workers.tasks.agent_run import delete_run_stream, run_agent_session
from uniffy.workers.tasks.agent_skill_analysis import analyze_session_for_skills
from uniffy.workers.tasks.base import (
    core_on_shutdown,
    core_on_startup,
    egress_on_shutdown,
    egress_on_startup,
    on_job_end,
    on_job_start,
)
from uniffy.workers.tasks.calls import cleanup_orphan_call_rooms, reconcile_calls
from uniffy.workers.tasks.chat_mute import auto_unmute_channels
from uniffy.workers.tasks.content_extraction import extract_document_content
from uniffy.workers.tasks.extraction import extract_audio_metadata, extract_image_metadata
from uniffy.workers.tasks.mail import send_email
from uniffy.workers.tasks.multipart_reaper import reap_expired_multipart_uploads
from uniffy.workers.tasks.notifications import (
    deliver_push_notification,
    process_notification_event,
    send_email_digest,
)
from uniffy.workers.tasks.permissions_reindex import reindex_org_content_for_defaults
from uniffy.workers.tasks.platform_org_purge import notify_pending_org_purges
from uniffy.workers.tasks.realtime import save_realtime_snapshot
from uniffy.workers.tasks.reminders import check_calendar_reminders
from uniffy.workers.tasks.storage_recalculation import recalculate_all_storage_usage
from uniffy.workers.tasks.support_session_expiry import expire_support_sessions
from uniffy.workers.tasks.tags_reindex import reindex_tag_doc, reindex_tag_urns
from uniffy.workers.tasks.task_reminders import check_task_due_dates
from uniffy.workers.tasks.thumbnails import (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
)
from uniffy.workers.tasks.video_transcode import (
    delete_s3_object,
    transcode_video_to_mp4,
)

CORE_TASKS = (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
    transcode_video_to_mp4,
    delete_s3_object,
    extract_image_metadata,
    extract_audio_metadata,
    extract_document_content,
    process_notification_event,
    deliver_push_notification,
    send_email,
    send_email_digest,
    reindex_tag_urns,
    reindex_tag_doc,
    reap_expired_multipart_uploads,
    reindex_org_content_for_defaults,
    save_realtime_snapshot,
)

EGRESS_TASKS = (
    respond_to_chat_message,
    compact_session,
    analyze_session_for_skills,
    execute_single_agent_cron_task,
    run_agent_session,
    delete_run_stream,
)

__all__ = [
    "CORE_TASKS",
    "EGRESS_TASKS",
    "analyze_session_for_skills",
    "auto_unmute_channels",
    "check_calendar_reminders",
    "check_task_due_dates",
    "cleanup_orphan_call_rooms",
    "compact_session",
    "core_on_shutdown",
    "core_on_startup",
    "delete_run_stream",
    "delete_s3_object",
    "deliver_push_notification",
    "egress_on_shutdown",
    "egress_on_startup",
    "execute_agent_cron_tasks",
    "execute_single_agent_cron_task",
    "expire_support_sessions",
    "extract_audio_metadata",
    "extract_document_content",
    "extract_image_metadata",
    "flush_chat_read_cursors",
    "generate_image_thumbnail",
    "generate_pdf_thumbnail",
    "generate_video_thumbnail",
    "notify_pending_org_purges",
    "on_job_end",
    "on_job_start",
    "process_notification_event",
    "reap_expired_multipart_uploads",
    "recalculate_all_storage_usage",
    "reconcile_calls",
    "reindex_org_content_for_defaults",
    "reindex_tag_doc",
    "reindex_tag_urns",
    "respond_to_chat_message",
    "run_agent_session",
    "save_realtime_snapshot",
    "send_email",
    "send_email_digest",
    "transcode_video_to_mp4",
]
