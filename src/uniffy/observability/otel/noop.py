from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.trace import NonRecordingSpan


@contextmanager
def noop_span_context():
    """Context manager that yields a non-recording span"""
    yield NonRecordingSpan(trace.INVALID_SPAN_CONTEXT)
