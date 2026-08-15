from uniffy.workers.tasks import JobName
from uniffy.workers.tasks.registered import CORE_TASKS, EGRESS_TASKS


def test_job_name_catalog_matches_registered_tasks() -> None:
    assert {job.value for job in JobName} == {task.__name__ for task in (*CORE_TASKS, *EGRESS_TASKS)}
