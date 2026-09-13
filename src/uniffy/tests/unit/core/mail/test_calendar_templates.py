"""Event mail templates render under strict undefined, with and without the
optional fields."""

import pytest
from jinja2 import UndefinedError

from uniffy.core.mail.rendering import render_template
from uniffy.core.mail.templates import get_template

CALENDAR_TEMPLATES = ("calendar/invitation", "calendar/change", "calendar/cancellation")

# Every key the three templates can reference. The environment uses
# StrictUndefined, so an omitted key raises at send time rather than rendering
# an empty string - whatever composes this mail has to supply all of them.
FULL_CONTEXT: dict = {
    "organization_name": "Acme",
    "title": "Quarterly review",
    "organizer_name": "Ada Lovelace",
    "when": "Wednesday 18 March 2026, 09:00 - 09:30",
    "when_short": "18 Mar 09:00",
    "recurrence": "Repeats weekly on Wednesday",
    "location": "Room 3",
    "attendee_summary": "Ada Lovelace, Grace Hopper and 2 others",
    "join_url": "https://meet.example.com/abc",
    "description": "Bring the deck",
    "respond_accept_url": "https://example.com/r?a",
    "respond_tentative_url": "https://example.com/r?t",
    "respond_decline_url": "https://example.com/r?d",
    "action_url": "https://example.com/event",
    "preferences_url": "https://example.com/preferences",
    "timezone_label": "Europe/Berlin",
    "changes": ["Time moved to 09:00", "Now in Room 3"],
    "occurrence_only": False,
}

EMPTY_OPTIONAL = {
    **FULL_CONTEXT,
    "organizer_name": "",
    "recurrence": "",
    "location": "",
    "attendee_summary": "",
    "join_url": "",
    "description": "",
    "respond_accept_url": "",
    "respond_tentative_url": "",
    "respond_decline_url": "",
    "changes": [],
}


@pytest.mark.parametrize("name", CALENDAR_TEMPLATES)
class TestRendering:
    async def test_renders_with_everything_supplied(self, name: str) -> None:
        rendered = await render_template(name, FULL_CONTEXT)

        assert rendered.subject.strip()
        assert "Quarterly review" in rendered.html
        assert "Quarterly review" in rendered.text

    async def test_renders_with_every_optional_field_empty(self, name: str) -> None:
        """A meeting with no location, no link and nobody else invited is
        ordinary, and must not produce a broken message."""
        rendered = await render_template(name, EMPTY_OPTIONAL)

        assert rendered.subject.strip()
        assert rendered.html.strip()
        assert rendered.text.strip()

    async def test_is_registered(self, name: str) -> None:
        assert get_template(name).description

    async def test_always_states_the_timezone_and_the_off_switch(self, name: str) -> None:
        rendered = await render_template(name, FULL_CONTEXT)

        assert "Europe/Berlin" in rendered.html
        assert FULL_CONTEXT["preferences_url"] in rendered.html

    async def test_a_missing_key_fails_loudly(self, name: str) -> None:
        """Documents the contract: strict undefined means a context that drifts
        from the template raises instead of silently dropping the detail."""
        incomplete = {key: value for key, value in FULL_CONTEXT.items() if key != "title"}

        with pytest.raises(UndefinedError):
            await render_template(name, incomplete)


class TestInvitationContent:
    async def test_it_states_when_where_and_how_to_join(self) -> None:
        """The acceptance criterion #168 exists for."""
        rendered = await render_template("calendar/invitation", FULL_CONTEXT)

        assert FULL_CONTEXT["when"] in rendered.text
        assert FULL_CONTEXT["location"] in rendered.text
        assert FULL_CONTEXT["join_url"] in rendered.text

    async def test_it_offers_a_way_to_respond(self) -> None:
        rendered = await render_template("calendar/invitation", FULL_CONTEXT)

        assert FULL_CONTEXT["respond_accept_url"] in rendered.html
        assert FULL_CONTEXT["respond_decline_url"] in rendered.html

    async def test_a_series_says_so(self) -> None:
        rendered = await render_template("calendar/invitation", FULL_CONTEXT)

        assert "Repeats weekly on Wednesday" in rendered.text


class TestChangeContent:
    async def test_it_lists_what_actually_changed(self) -> None:
        rendered = await render_template("calendar/change", FULL_CONTEXT)

        assert "Time moved to 09:00" in rendered.text
        assert "Now in Room 3" in rendered.text


class TestCancellationContent:
    async def test_a_whole_series_reads_as_the_meeting(self) -> None:
        rendered = await render_template(
            "calendar/cancellation", {**FULL_CONTEXT, "occurrence_only": False}
        )

        assert "This meeting has been cancelled" in rendered.text

    async def test_one_occurrence_says_so_instead(self) -> None:
        rendered = await render_template(
            "calendar/cancellation", {**FULL_CONTEXT, "occurrence_only": True}
        )

        assert "This occurrence has been cancelled" in rendered.text
