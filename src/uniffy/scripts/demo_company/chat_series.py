"""Expand recurring conversation series into dated messages."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from loguru import logger

from uniffy.scripts.demo_company.loader import MessageSpec, SeriesSpec

logger = logger.bind(component="scripts.demo_company.chat_series")

WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


def expand_series(
    spec: SeriesSpec,
    *,
    now: datetime,
    timezone: str,
    series_key: str,
) -> tuple[MessageSpec, ...]:
    """Render one variant per occurrence, oldest first, values rotating deterministically."""
    tz = ZoneInfo(timezone)
    now_local = now.astimezone(tz)
    hour, _, minute = spec.at.partition(":")

    occurrences: list[datetime] = []
    day_offset = spec.start_days_ago
    while day_offset >= 0 and len(occurrences) < spec.occurrences:
        moment = (now_local - timedelta(days=day_offset)).replace(
            hour=int(hour), minute=int(minute or 0), second=0, microsecond=0
        )
        if not (spec.weekdays_only and moment.weekday() >= 5) and moment < now_local:
            occurrences.append(moment)
        day_offset -= spec.every_days

    if len(occurrences) < spec.occurrences:
        logger.info(
            f"#{spec.channel}: {len(occurrences)} occurrences fit in the requested window, "
            f"asked for {spec.occurrences}"
        )

    messages: list[MessageSpec] = []
    for index, moment in enumerate(occurrences):
        variant = spec.variants[index % len(spec.variants)]
        base_minutes = int((now_local - moment).total_seconds() // 60)
        message_count = spec.messages_per_occurrence or len(variant.messages)

        for position in range(message_count):
            sender, text = variant.messages[position % len(variant.messages)]
            values = _values_for(spec, index * message_count + position, moment)
            messages.append(
                MessageSpec(
                    sender=sender,
                    text=_render(text, values),
                    minutes_ago=max(0, base_minutes - position * spec.gap_minutes),
                    replies=(),
                    key=f"{series_key}:{index}:{position}",
                )
            )

    return tuple(messages)


def _values_for(spec: SeriesSpec, index: int, moment: datetime) -> dict[str, str]:
    values = {
        "date": moment.strftime("%d.%m.%Y"),
        "short_date": moment.strftime("%d.%m"),
        "weekday": WEEKDAY_NAMES[moment.weekday()],
        "time": moment.strftime("%H:%M"),
    }
    # Each variable advances on its own stride so two pools of the same length
    # do not stay locked together across occurrences.
    for stride, name in enumerate(sorted(spec.variables), start=1):
        pool = spec.variables[name]
        values[name] = pool[(index * stride + stride) % len(pool)]
    return values


def _render(text: str, values: dict[str, str]) -> str:
    for name, value in values.items():
        text = text.replace("{" + name + "}", value)
    return text
