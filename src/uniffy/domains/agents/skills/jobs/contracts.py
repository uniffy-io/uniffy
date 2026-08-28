"""Producer-facing agent skill-analysis background-job contracts."""

from enum import StrEnum

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName


class SkillAnalysisDestination(StrEnum):
    SESSION = "session"
    CHANNEL = "channel"


ANALYZE_SESSION_FOR_SKILLS = JobRef(
    name="analyze_session_for_skills",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)

SKILL_JOB_REFS = (ANALYZE_SESSION_FOR_SKILLS,)
SKILL_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
