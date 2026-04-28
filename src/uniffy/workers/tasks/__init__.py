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
from uniffy.workers.tasks.base import (
    core_on_shutdown,
    core_on_startup,
    egress_on_shutdown,
    egress_on_startup,
    on_job_end,
    on_job_start,
)
from uniffy.workers.tasks.chat_mute import auto_unmute_channels
from uniffy.workers.tasks.content_extraction import extract_document_content
from uniffy.workers.tasks.extraction import extract_audio_metadata, extract_image_metadata
from uniffy.workers.tasks.notifications import (
    deliver_email_notification,
    deliver_push_notification,
    process_notification_event,
    send_email_digest,
)
from uniffy.workers.tasks.reminders import check_calendar_reminders
from uniffy.workers.tasks.storage_recalculation import recalculate_all_storage_usage
from uniffy.workers.tasks.task_reminders import check_task_due_dates
from uniffy.workers.tasks.thumbnails import (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
)

CORE_TASKS = (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
    extract_image_metadata,
    extract_audio_metadata,
    extract_document_content,
    process_notification_event,
    deliver_push_notification,
    deliver_email_notification,
    send_email_digest,
)

EGRESS_TASKS = (
    respond_to_chat_message,
    compact_session,
    execute_single_agent_cron_task,
    run_agent_session,
    delete_run_stream,
)

__all__ = [
    "CORE_TASKS",
    "EGRESS_TASKS",
    "auto_unmute_channels",
    "check_calendar_reminders",
    "check_task_due_dates",
    "compact_session",
    "core_on_shutdown",
    "core_on_startup",
    "delete_run_stream",
    "deliver_email_notification",
    "deliver_push_notification",
    "egress_on_shutdown",
    "egress_on_startup",
    "execute_agent_cron_tasks",
    "execute_single_agent_cron_task",
    "extract_audio_metadata",
    "extract_document_content",
    "extract_image_metadata",
    "flush_chat_read_cursors",
    "generate_image_thumbnail",
    "generate_pdf_thumbnail",
    "generate_video_thumbnail",
    "on_job_end",
    "on_job_start",
    "process_notification_event",
    "recalculate_all_storage_usage",
    "respond_to_chat_message",
    "run_agent_session",
    "send_email_digest",
]
