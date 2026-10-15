"""Isolated empty databases exercise the migration chain from scratch."""

from collections.abc import Iterator

import psycopg2
import pytest

from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import _build_sync_db_url, get_database_url


def _maintenance_connection():
    """Connect to the configured database purely to issue CREATE/DROP DATABASE."""
    conn = psycopg2.connect(_build_sync_db_url())
    conn.autocommit = True
    return conn


@pytest.fixture(scope="session")
def database_reachable() -> None:
    try:
        _maintenance_connection().close()
    except psycopg2.Error as exc:
        pytest.skip(f"no database at {get_database_url()}: {exc}")


@pytest.fixture
def scratch_database(database_reachable, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Use the application's database configuration for each isolated migration run."""
    name = f"uniffy_migtest_{generate_id().hex}"
    conn = _maintenance_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f'CREATE DATABASE "{name}"')
    finally:
        conn.close()

    monkeypatch.setenv("POSTGRES_DB", name)
    try:
        yield name
    finally:
        monkeypatch.undo()
        conn = _maintenance_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        finally:
            conn.close()
