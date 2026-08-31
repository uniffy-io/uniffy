"""Pure interval algebra shared by scheduling children."""

from datetime import datetime

Interval = tuple[datetime, datetime]


def merge_intervals(intervals: list[Interval]) -> list[Interval]:
    """Union overlapping or touching intervals into sorted disjoint spans."""
    if not intervals:
        return []
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def intersect_intervals(a: list[Interval], b: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i][0], b[j][0])
        end = min(a[i][1], b[j][1])
        if start < end:
            result.append((start, end))
        if a[i][1] <= b[j][1]:
            i += 1
        else:
            j += 1
    return result


def subtract_intervals(base: list[Interval], remove: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    remove = merge_intervals(remove)
    for start, end in base:
        cursor = start
        for remove_start, remove_end in remove:
            if remove_end <= cursor:
                continue
            if remove_start >= end:
                break
            if remove_start > cursor:
                result.append((cursor, remove_start))
            cursor = max(cursor, remove_end)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return result
