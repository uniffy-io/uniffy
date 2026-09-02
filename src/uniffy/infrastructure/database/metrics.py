from typing import Any

from prometheus_client import Counter, Gauge

DB_POOL_SIZE = Gauge(
    "uniffy_db_pool_size",
    "Configured size of the database connection pool",
    multiprocess_mode="livesum",
)

DB_POOL_CHECKED_OUT = Gauge(
    "uniffy_db_pool_checked_out",
    "Number of connections currently checked out from the pool",
    multiprocess_mode="livesum",
)

DB_POOL_OVERFLOW = Gauge(
    "uniffy_db_pool_overflow",
    "Number of overflow connections currently in use",
    multiprocess_mode="livesum",
)

DB_POOL_CHECKED_IN = Gauge(
    "uniffy_db_pool_checked_in",
    "Number of connections currently idle in the pool",
    multiprocess_mode="livesum",
)

DB_POOL_TIMEOUT_TOTAL = Counter(
    "uniffy_db_pool_timeout_total",
    "SQLAlchemy pool checkout timeouts (request waited past DB_POOL_TIMEOUT)",
)

_db_pool: Any = None


def register_db_pool(pool: Any) -> None:
    global _db_pool
    _db_pool = pool


def update_pool_metrics() -> None:
    if _db_pool is None:
        return
    DB_POOL_SIZE.set(_db_pool.size())
    DB_POOL_CHECKED_OUT.set(_db_pool.checkedout())
    DB_POOL_OVERFLOW.set(_db_pool.overflow())
    DB_POOL_CHECKED_IN.set(_db_pool.checkedin())
