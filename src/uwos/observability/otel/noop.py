from opentelemetry import trace
from opentelemetry.trace import NonRecordingSpan
from contextlib import contextmanager

@contextmanager
def noop_span_context():
    """Context manager that yields a non-recording span"""
    yield NonRecordingSpan(trace.INVALID_SPAN_CONTEXT)
